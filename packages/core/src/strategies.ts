import type {
  Candidate,
  Check,
  ConfidenceBand,
  ConflictFile,
  ConflictHunk,
  Explanation,
  ResolutionProposal,
  StrategyId,
} from "@smartmerge/protocol";
import { isStructuralLanguage, parseSource, parsersReady } from "./parse.js";
import { mergeRegions, onlyImportChanges, renameMerge } from "./structure.js";
import { verifyParsed } from "./verify.js";
import { normalizeWhitespace } from "./whitespace.js";

/**
 * Confidence cap while syntax and symbol checks have not run.
 * The engine spec caps any unknown syntax or symbol check at 0.80,
 * which is the medium band and is not eligible for automatic apply.
 */
const UNCHECKED_CAP = 0.8;

/**
 * Fixed score for a structural result after syntax and symbol checks.
 * JSON and YAML stay in the high band until a replay corpus exists, so a clean merge is not marked certain.
 */
export function structuralScore(
  languageId: string,
  hazardous: boolean,
): { confidence: number; band: ConfidenceBand } {
  if (hazardous) return { confidence: 0.2, band: "low" };
  if (languageId === "json" || languageId === "yaml") return { confidence: 0.95, band: "high" };
  return { confidence: 0.99, band: "certain" };
}

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

  const structural = structuralCandidates(file, hunk);
  deterministic.push(...structural);

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
  const chosen = deterministic.find((item) => item.band !== "low") ?? null;
  return {
    hunkId: hunk.id,
    recommended: chosen?.id ?? null,
    candidates,
    explanation: explanation(file, hunk, chosen),
    autoApplyEligible: chosen?.band === "certain" && !chosen.hazardous,
  };
}

function structuralCandidates(file: ConflictFile, hunk: ConflictHunk): Candidate[] {
  if (!parsersReady() || !isStructuralLanguage(file.languageId) || file.languageId === null) {
    return [];
  }
  const base = parseSource(file.languageId, hunk.base);
  const current = parseSource(file.languageId, hunk.current);
  const incoming = parseSource(file.languageId, hunk.incoming);
  if (!base || !current || !incoming || base.hasErrors || current.hasErrors || incoming.hasErrors) {
    return [];
  }
  const found: Candidate[] = [];
  const merged = mergeRegions(base.region, current.region, incoming.region);
  if (merged !== null && merged !== hunk.current && merged !== hunk.incoming) {
    const strategy = onlyImportChanges(base.region, current.region, incoming.region)
      ? "list-union"
      : "structural-3way";
    const parsed = parseSource(file.languageId, merged);
    if (parsed) {
      found.push(
        checkedCandidate(
          file,
          hunk,
          strategy,
          merged,
          parsed,
          current,
          incoming,
          strategy === "list-union"
            ? {
                code: "import-union",
                text: "Import names from both sides are kept. Existing order is preserved because no project sort convention was read.",
              }
            : file.languageId === "json"
              ? {
                  code: "json-keys",
                  text: "Each side edited different object keys. Untouched text is copied from the base.",
                }
              : file.languageId === "yaml"
                ? {
                    code: "yaml-keys",
                    text: "Each side edited different mapping keys. Untouched text is copied from the base.",
                  }
                : {
                    code: "disjoint-nodes",
                    text: "Each side edited different declarations. Untouched text is copied from the base.",
                  },
        ),
      );
    }
  }
  const renamed = renameMerge(base, current, incoming, hunk.base, hunk.current, hunk.incoming);
  if (renamed !== null && renamed !== hunk.current && renamed !== hunk.incoming) {
    const parsed = parseSource(file.languageId, renamed);
    if (parsed) {
      found.push(
        checkedCandidate(file, hunk, "rename-aware", renamed, parsed, current, incoming, {
          code: "rename-applied",
          text: "One side renamed an identifier. That rename is applied to the other side's edits.",
        }),
      );
    }
  }
  return found;
}

function checkedCandidate(
  file: ConflictFile,
  hunk: ConflictHunk,
  strategy: StrategyId,
  result: string,
  parsed: NonNullable<ReturnType<typeof parseSource>>,
  current: NonNullable<ReturnType<typeof parseSource>>,
  incoming: NonNullable<ReturnType<typeof parseSource>>,
  evidence: { code: string; text: string },
): Candidate {
  const verified = verifyParsed(file.path, parsed, current, incoming);
  const scored = structuralScore(file.languageId ?? "", verified.hazardous);
  const { confidence, band } = scored;
  return {
    id: `${hunk.id}:${strategy}`,
    hunkId: hunk.id,
    strategy,
    result,
    checks: verified.checks,
    hazardous: verified.hazardous,
    confidence,
    band,
    evidence: [evidence],
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

function explanation(
  file: ConflictFile,
  hunk: ConflictHunk,
  chosen: Candidate | null,
): Explanation {
  if (!chosen) {
    return {
      headline: "No safe automatic choice",
      bullets: [
        `${file.operation.current.label} and ${file.operation.incoming.label} both changed this hunk.`,
      ],
      verificationSummary: "Syntax and symbol checks have not run.",
      temporalSummary: temporalSummary(file, hunk),
    };
  }
  const evidence = chosen.evidence[0];
  return {
    headline: headline(chosen.strategy, file),
    bullets: evidence ? [evidence.text] : [],
    verificationSummary: verificationSummary(chosen),
    temporalSummary: temporalSummary(file, hunk),
  };
}

function verificationSummary(chosen: Candidate): string {
  const syntax = chosen.checks.find((check) => check.kind === "syntax");
  if (!syntax || syntax.status === "unknown") {
    return "Syntax and symbol checks have not run, so this stays a recommendation and is not applied automatically.";
  }
  if (chosen.hazardous)
    return "Syntax or symbol checks failed, so this is not applied automatically.";
  if (chosen.band === "certain") {
    return "Syntax and symbol checks passed. Automatic apply stays off until it is enabled for this repository.";
  }
  return "Syntax and symbol checks passed.";
}

function temporalSummary(file: ConflictFile, hunk: ConflictHunk): string {
  const current = hunk.temporal.current.commits.at(-1);
  const incoming = hunk.temporal.incoming.commits.at(-1);
  if (!current && !incoming) return "Commit history is not attached yet.";
  const parts: string[] = [];
  if (current) parts.push(`${file.operation.current.label}: ${current.subject}`);
  if (incoming) parts.push(`${file.operation.incoming.label}: ${incoming.subject}`);
  return parts.join(" ");
}

function headline(strategy: StrategyId, file: ConflictFile): string {
  switch (strategy) {
    case "identical":
      return "Both sides made the same change";
    case "one-side-unchanged":
      return "Only one side changed";
    case "whitespace-format":
      return "Only trailing whitespace or line endings differ";
    case "structural-3way":
      return "Merge both — different declarations edited";
    case "list-union":
      return "Keep the import names from both sides";
    case "rename-aware":
      return "Apply the rename to the other side's edits";
    default:
      return `${file.operation.current.label} and ${file.operation.incoming.label} need a choice`;
  }
}
