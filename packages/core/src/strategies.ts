import type {
  Candidate,
  Check,
  ConflictFile,
  ConflictHunk,
  Explanation,
  ResolutionProposal,
  StrategyId,
} from "@smartmerge/protocol";
import { normalizeWhitespace } from "./whitespace.js";

/**
 * Confidence cap while syntax and symbol checks have not run.
 * The engine spec caps any unknown syntax or symbol check at 0.80,
 * which is the medium band and is not eligible for automatic apply.
 */
const UNCHECKED_CAP = 0.8;

const NOT_RUN: Check[] = [
  { kind: "syntax", status: "unknown", diagnostics: [], durationMs: 0, reason: "not-run" },
  { kind: "symbols", status: "unknown", diagnostics: [], durationMs: 0, reason: "not-run" },
];

/**
 * Proposals for one conflicted file.
 * Identical, one-side-unchanged, and whitespace-format may be recommended.
 * Manual choices are always included. Nothing is marked eligible for automatic apply.
 *
 * @param knownBaseHunkIds Hunks whose `base` is known, including a known empty base.
 *   A hunk omitted here with an empty base is treated as "base not loaded".
 */
export function proposeForFile(
  file: ConflictFile,
  knownBaseHunkIds: ReadonlySet<string> = new Set(),
): ResolutionProposal[] {
  return file.hunks.map((hunk) => proposeHunk(file, hunk, knownBaseHunkIds.has(hunk.id)));
}

function proposeHunk(
  file: ConflictFile,
  hunk: ConflictHunk,
  baseKnown: boolean,
): ResolutionProposal {
  const deterministic: Candidate[] = [];
  if (hunk.current === hunk.incoming) {
    deterministic.push(
      candidate(hunk, "identical", hunk.current, UNCHECKED_CAP, {
        code: "sides-equal",
        text: `${file.operation.current.label} and ${file.operation.incoming.label} made the same change.`,
      }),
    );
  } else if (baseKnown && hunk.current === hunk.base && hunk.incoming !== hunk.base) {
    deterministic.push(
      candidate(hunk, "one-side-unchanged", hunk.incoming, UNCHECKED_CAP, {
        code: "current-unchanged",
        text: `${file.operation.current.label} matches the base. ${file.operation.incoming.label} is the side that changed.`,
      }),
    );
  } else if (baseKnown && hunk.incoming === hunk.base && hunk.current !== hunk.base) {
    deterministic.push(
      candidate(hunk, "one-side-unchanged", hunk.current, UNCHECKED_CAP, {
        code: "incoming-unchanged",
        text: `${file.operation.incoming.label} matches the base. ${file.operation.current.label} is the side that changed.`,
      }),
    );
  } else if (
    hunk.current !== hunk.incoming &&
    normalizeWhitespace(hunk.current) === normalizeWhitespace(hunk.incoming)
  ) {
    deterministic.push(
      candidate(hunk, "whitespace-format", whitespaceResult(hunk), UNCHECKED_CAP, {
        code: "whitespace-only",
        text: "The sides match once trailing whitespace and line endings are removed. No project formatter was run.",
      }),
    );
  }

  const manuals = [
    manual(hunk, "manual-current", hunk.current, file.operation.current.label),
    manual(hunk, "manual-incoming", hunk.incoming, file.operation.incoming.label),
    manual(
      hunk,
      "manual-both-current-first",
      joinSides(hunk.current, hunk.incoming),
      `${file.operation.current.label}, then ${file.operation.incoming.label}`,
    ),
    manual(
      hunk,
      "manual-both-incoming-first",
      joinSides(hunk.incoming, hunk.current),
      `${file.operation.incoming.label}, then ${file.operation.current.label}`,
    ),
  ];
  const candidates = [...deterministic, ...manuals];
  const recommended = deterministic[0]?.id ?? null;
  return {
    hunkId: hunk.id,
    recommended,
    candidates,
    explanation: explanation(file, deterministic[0] ?? null),
    autoApplyEligible: false,
  };
}

function whitespaceResult(hunk: ConflictHunk): string {
  const normalized = normalizeWhitespace(hunk.current);
  if (hunk.current === normalized) return hunk.current;
  if (hunk.incoming === normalized) return hunk.incoming;
  return normalized;
}

function joinSides(first: string, second: string): string {
  if (first.length === 0) return second;
  if (second.length === 0) return first;
  return `${first}\n${second}`;
}

function candidate(
  hunk: ConflictHunk,
  strategy: StrategyId,
  result: string,
  confidence: number,
  evidence: { code: string; text: string },
): Candidate {
  return {
    id: `${hunk.id}:${strategy}`,
    hunkId: hunk.id,
    strategy,
    result,
    checks: NOT_RUN.map((check) => ({ ...check })),
    hazardous: false,
    confidence,
    band: "medium",
    evidence: [evidence],
  };
}

function manual(
  hunk: ConflictHunk,
  strategy: StrategyId,
  result: string,
  label: string,
): Candidate {
  return {
    id: `${hunk.id}:${strategy}`,
    hunkId: hunk.id,
    strategy,
    result,
    checks: NOT_RUN.map((check) => ({ ...check })),
    hazardous: false,
    confidence: 0,
    band: "low",
    evidence: [{ code: "manual-choice", text: `Keep ${label}.` }],
  };
}

function explanation(file: ConflictFile, chosen: Candidate | null): Explanation {
  if (!chosen) {
    return {
      headline: "No safe automatic choice",
      bullets: [
        `${file.operation.current.label} and ${file.operation.incoming.label} both changed this hunk.`,
      ],
      verificationSummary: "Syntax and symbol checks have not run.",
      temporalSummary: "Commit history is not attached yet.",
    };
  }
  const evidence = chosen.evidence[0];
  return {
    headline: headline(chosen.strategy, file),
    bullets: evidence ? [evidence.text] : [],
    verificationSummary:
      "Syntax and symbol checks have not run, so this stays a recommendation and is not applied automatically.",
    temporalSummary: "Commit history is not attached yet.",
  };
}

function headline(strategy: StrategyId, file: ConflictFile): string {
  switch (strategy) {
    case "identical":
      return "Both sides made the same change";
    case "one-side-unchanged":
      return "Only one side changed";
    case "whitespace-format":
      return "Only trailing whitespace or line endings differ";
    default:
      return `${file.operation.current.label} and ${file.operation.incoming.label} need a choice`;
  }
}
