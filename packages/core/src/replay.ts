import type {
  OperationContext,
  ReplayConflict,
  ReplayOutcome,
  ReplayReport,
  ResolutionProposal,
} from "@smartmerge/protocol";
import { replaceHunk } from "./apply.js";
import { buildConflict } from "./conflicts.js";
import { initParsers, isStructuralLanguage, parseSource, parsersReady } from "./parse.js";
import { proposeForFile, structuralScore } from "./strategies.js";
import { mergeRegions } from "./structure.js";
import { verifyParsed } from "./verify.js";

export type { ReplayConflict, ReplayOutcome, ReplayReport };

const operation: OperationContext = {
  operation: "merge",
  current: { label: "first parent", role: "ours", commitSha: "0".repeat(40) },
  incoming: { label: "second parent", role: "theirs", commitSha: "1".repeat(40) },
  mergeBaseSha: null,
};

/**
 * Apply the current proposal to each conflicted file and compare the exact text with the committed file.
 * A file is a row when every hunk has a recommendation, or when the three stored files merge as a whole.
 * Confidence is the lowest hunk score, or the fixed structural score for a whole-file merge.
 * A JSON, YAML, Python, Go, Java, Kotlin, or C# whole-file merge stays in the high band until a replay corpus exists.
 * The merge-base file is passed through when it was stored, so a one-side change does not need diff3 markers.
 * A parser that fails to load leaves structural recommendations unavailable. Line strategies still run.
 */
export async function replayConflicts(
  conflicts: readonly ReplayConflict[],
  options?: { structural?: boolean; loadStructural?: () => Promise<void> },
): Promise<ReplayReport> {
  for (const conflict of conflicts) assertConflict(conflict);
  if (options?.structural !== false) {
    try {
      await (options?.loadStructural ?? initParsers)();
    } catch {
      // Line strategies do not need the parser.
    }
  }
  const rows: ReplayOutcome[] = [];
  let unresolved = 0;
  let unparsed = 0;
  for (const conflict of conflicts) {
    const row = predict(conflict);
    if (row === "unparsed") unparsed += 1;
    else if (row === "unresolved") unresolved += 1;
    else rows.push(row);
  }
  return { rows, predicted: rows.length, unresolved, unparsed };
}

function predict(conflict: ReplayConflict): ReplayOutcome | "unparsed" | "unresolved" {
  const built = buildConflict(
    {
      path: conflict.path,
      text: conflict.conflicted,
      binary: false,
      missing: false,
      ...(conflict.base === null
        ? {}
        : { stages: { base: conflict.base, ours: null, theirs: null } }),
    },
    operation,
  );
  if (built.file.hunks.length === 0) return "unparsed";
  const proposals = proposeForFile(built.file, new Set(built.knownBaseHunkIds));
  const pieces: { startLine: number; endLine: number; result: string; confidence: number }[] = [];
  let covered = true;
  for (const hunk of built.file.hunks) {
    const proposal = proposals.find((item) => item.hunkId === hunk.id);
    const chosen = proposal === undefined ? null : recommended(proposal);
    if (chosen === null) {
      covered = false;
      break;
    }
    pieces.push({
      startLine: hunk.range.startLine,
      endLine: hunk.range.endLine,
      result: chosen.result,
      confidence: chosen.confidence,
    });
  }
  if (!covered) return wholeFileMerge(conflict, built.file.languageId) ?? "unresolved";
  const ordered = [...pieces].sort((left, right) => right.startLine - left.startLine);
  let text = conflict.conflicted;
  for (const piece of ordered) {
    text = replaceHunk(text, { startLine: piece.startLine, endLine: piece.endLine }, piece.result);
  }
  const confidence = Math.min(...pieces.map((piece) => piece.confidence));
  return {
    repository: conflict.repository.trim(),
    confidence,
    correct: text === conflict.humanResult,
    confidenceSource: "fixed-proposal",
  };
}

/**
 * Merge the stored parent files when a hunk is only a fragment of a program.
 * The score stays the fixed structural score. A fitted model is not involved.
 */
function wholeFileMerge(conflict: ReplayConflict, languageId: string | null): ReplayOutcome | null {
  if (
    conflict.base === null ||
    conflict.current === null ||
    conflict.incoming === null ||
    languageId === null ||
    !parsersReady() ||
    !isStructuralLanguage(languageId)
  ) {
    return null;
  }
  const base = parseSource(languageId, conflict.base);
  const current = parseSource(languageId, conflict.current);
  const incoming = parseSource(languageId, conflict.incoming);
  if (!base || !current || !incoming || base.hasErrors || current.hasErrors || incoming.hasErrors) {
    return null;
  }
  const merged = mergeRegions(base.region, current.region, incoming.region);
  if (merged === null || merged === conflict.current || merged === conflict.incoming) return null;
  const parsed = parseSource(languageId, merged);
  if (!parsed) return null;
  const verified = verifyParsed(conflict.path, parsed, current, incoming);
  if (verified.hazardous) return null;
  return {
    repository: conflict.repository.trim(),
    confidence: structuralScore(languageId, false).confidence,
    correct: merged === conflict.humanResult,
    confidenceSource: "fixed-proposal",
  };
}

function recommended(proposal: ResolutionProposal): { result: string; confidence: number } | null {
  if (proposal.recommended === null) return null;
  const candidate = proposal.candidates.find((item) => item.id === proposal.recommended);
  if (candidate === undefined || candidate.band === "low") return null;
  return { result: candidate.result, confidence: candidate.confidence };
}

function assertConflict(conflict: ReplayConflict): void {
  const repository = conflict.repository.trim();
  if (repository.length === 0 || repository.length > 200) {
    throw new Error("The repository name must be 1 to 200 characters.");
  }
  if (conflict.path.trim().length === 0) throw new Error("Each conflict needs a path.");
  if (typeof conflict.conflicted !== "string")
    throw new Error("Each conflict needs conflicted text.");
  if (conflict.base !== null && typeof conflict.base !== "string") {
    throw new Error("base must be a string or null.");
  }
  if (conflict.current !== null && typeof conflict.current !== "string") {
    throw new Error("current must be a string or null.");
  }
  if (conflict.incoming !== null && typeof conflict.incoming !== "string") {
    throw new Error("incoming must be a string or null.");
  }
  if (conflict.humanResult !== null && typeof conflict.humanResult !== "string") {
    throw new Error("humanResult must be a string or null.");
  }
}
