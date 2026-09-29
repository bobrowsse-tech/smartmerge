import type {
  Candidate,
  ConflictFile,
  ConflictHunk,
  ConflictKind,
  Range,
  ResolutionProposal,
  SideContext,
  SmartMergeConfig,
  OperationContext,
  StrategyId,
  TemporalContext,
} from "@smartmerge/protocol";

export interface ConflictSource {
  path: string;
  text: string | null;
  binary: boolean;
  missing: boolean;
}

const START = /^<{7} (.*)$/;
const BASE = /^\|{7}(?: .*)?$/;
const SEPARATOR = /^={7}$/;
const END = /^>{7}(?: .*)?$/;

interface ParsedHunk {
  id: string;
  range: Range;
  base: string;
  current: string;
  incoming: string;
}

/**
 * Parse standard and diff3 conflict markers.
 * An unfinished marker block is dropped.
 */
export function parseConflictHunks(text: string): ParsedHunk[] {
  const lines = text.split(/\r?\n/);
  const hunks: ParsedHunk[] = [];
  let state: "outside" | "current" | "base" | "incoming" = "outside";
  let startLine = 0;
  let current: string[] = [];
  let base: string[] = [];
  let incoming: string[] = [];

  const close = (endLine: number): void => {
    hunks.push({
      id: `hunk:${String(startLine)}`,
      range: { startLine, endLine },
      base: base.join("\n"),
      current: current.join("\n"),
      incoming: incoming.join("\n"),
    });
    state = "outside";
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (state === "outside") {
      if (START.test(line)) {
        startLine = lineNumber;
        current = [];
        base = [];
        incoming = [];
        state = "current";
      }
      return;
    }
    if (state === "current" && BASE.test(line)) {
      state = "base";
      return;
    }
    if ((state === "current" || state === "base") && SEPARATOR.test(line)) {
      state = "incoming";
      return;
    }
    if (state === "incoming" && END.test(line)) {
      close(lineNumber);
      return;
    }
    if (state === "current") current.push(line);
    else if (state === "base") base.push(line);
    else incoming.push(line);
  });

  return hunks;
}

/** Build a protocol conflict file from a git unmerged path. */
export function toConflictFile(file: ConflictSource, operation: OperationContext): ConflictFile {
  const hunks: ConflictHunk[] =
    file.text === null
      ? []
      : parseConflictHunks(file.text).map((hunk) => ({
          ...hunk,
          temporal: emptyTemporal(),
          semanticChanges: [],
        }));
  return {
    path: file.path,
    kind: conflictKind(file),
    languageId: languageIdFor(file.path),
    hunks,
    operation,
  };
}

/** Stub proposals: both sides are visible, and nothing is recommended. */
export function stubProposals(file: ConflictFile): ResolutionProposal[] {
  return file.hunks.map((hunk) => ({
    hunkId: hunk.id,
    recommended: null,
    candidates: [
      stubCandidate(hunk, "manual-current", hunk.current),
      stubCandidate(hunk, "manual-incoming", hunk.incoming),
    ],
    explanation: {
      headline: "No recommendation yet",
      bullets: ["This build lists the conflict and does not choose a side."],
      verificationSummary: "Checks have not run.",
      temporalSummary: "Commit history is not attached yet.",
    },
    autoApplyEligible: false,
  }));
}

/** Defaults from the product rules: nothing is applied or sent off the machine. */
export function defaultConfig(): SmartMergeConfig {
  return {
    autoApply: { enabled: false, minBand: "certain" },
    checks: { enabled: [], timeoutMs: {} },
    llm: { enabled: false },
    context: { providers: [], offline: true },
    agent: {
      mode: "propose-and-verify",
      minBand: "certain",
      requireVerification: true,
      allowLlm: false,
      maxFilesPerRun: 20,
      protectedPaths: [],
    },
    backups: { retentionDays: 30 },
    telemetry: { enabled: false },
  };
}

function stubCandidate(hunk: ConflictHunk, strategy: StrategyId, result: string): Candidate {
  return {
    id: `${hunk.id}:${strategy}`,
    hunkId: hunk.id,
    strategy,
    result,
    checks: [],
    hazardous: false,
    confidence: 0,
    band: "low",
    evidence: [{ code: "stub", text: "No strategy has run yet." }],
  };
}

function conflictKind(file: ConflictSource): ConflictKind {
  if (file.binary) return "binary";
  if (file.missing) return "modify-delete";
  return "content";
}

function languageIdFor(path: string): string | null {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (extension) {
    case "ts":
      return "typescript";
    case "tsx":
      return "typescriptreact";
    case "js":
      return "javascript";
    case "jsx":
      return "javascriptreact";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "py":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "java":
      return "java";
    default:
      return null;
  }
}

function emptySide(side: SideContext["side"]): SideContext {
  return { side, commits: [], changeClasses: [], ageMs: null };
}

function emptyTemporal(): TemporalContext {
  return {
    current: emptySide("current"),
    incoming: emptySide("incoming"),
    base: emptySide("base"),
    incomingNewerByMs: null,
  };
}
