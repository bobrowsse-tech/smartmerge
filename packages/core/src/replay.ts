import type { OperationContext, ResolutionProposal } from "@smartmerge/protocol";
import { replaceHunk } from "./apply.js";
import { buildConflict } from "./conflicts.js";
import { initParsers } from "./parse.js";
import { proposeForFile } from "./strategies.js";

const operation: OperationContext = {
  operation: "merge",
  current: { label: "first parent", role: "ours", commitSha: "0".repeat(40) },
  incoming: { label: "second parent", role: "theirs", commitSha: "1".repeat(40) },
  mergeBaseSha: null,
};

/**
 * One fetched conflict at file grain.
 * `conflicted` still contains the merge markers. `humanResult` is the committed file.
 */
export interface ReplayConflict {
  repository: string;
  path: string;
  conflicted: string;
  humanResult: string | null;
}

/**
 * One prediction.
 * `confidence` is the fixed proposal score. It is not a fitted model probability.
 */
export interface ReplayOutcome {
  repository: string;
  confidence: number;
  correct: boolean;
  confidenceSource: "fixed-proposal";
}

/**
 * Replay result.
 * Files without a recommendation for every hunk are counted and omitted. No calibration error is computed.
 */
export interface ReplayReport {
  rows: ReplayOutcome[];
  predicted: number;
  unresolved: number;
  unparsed: number;
}

/**
 * Apply the current proposal to each conflicted file and compare it with the committed result.
 * A file is a row only when every hunk has a recommendation. Confidence is the lowest of those scores.
 */
export async function replayConflicts(
  conflicts: readonly ReplayConflict[],
  options?: { structural?: boolean },
): Promise<ReplayReport> {
  for (const conflict of conflicts) assertConflict(conflict);
  if (options?.structural !== false) await initParsers();
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
    { path: conflict.path, text: conflict.conflicted, binary: false, missing: false },
    operation,
  );
  if (built.file.hunks.length === 0) return "unparsed";
  const proposals = proposeForFile(built.file, new Set(built.knownBaseHunkIds));
  const pieces: { startLine: number; endLine: number; result: string; confidence: number }[] = [];
  for (const hunk of built.file.hunks) {
    const proposal = proposals.find((item) => item.hunkId === hunk.id);
    const chosen = proposal === undefined ? null : recommended(proposal);
    if (chosen === null) return "unresolved";
    pieces.push({
      startLine: hunk.range.startLine,
      endLine: hunk.range.endLine,
      result: chosen.result,
      confidence: chosen.confidence,
    });
  }
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
  if (conflict.humanResult !== null && typeof conflict.humanResult !== "string") {
    throw new Error("humanResult must be a string or null.");
  }
}
