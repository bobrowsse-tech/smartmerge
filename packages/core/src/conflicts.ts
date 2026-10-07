import { createHash } from "node:crypto";
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

export interface StageText {
  /** Stage 1. Null when that stage is absent. */
  base: string | null;
  /** Stage 2, git's ours. */
  ours: string | null;
  /** Stage 3, git's theirs. */
  theirs: string | null;
}

export interface ConflictSource {
  path: string;
  text: string | null;
  binary: boolean;
  missing: boolean;
  /** When set, overrides marker-only classification. */
  kind?: ConflictKind;
  stages?: StageText;
}

export interface BuiltConflict {
  file: ConflictFile;
  /** Hunks whose base text is known, including a known empty base. */
  knownBaseHunkIds: string[];
}

const START = /^<{7} (.*)$/;
const BASE = /^\|{7}(?: .*)?$/;
const SEPARATOR = /^={7}$/;
const END = /^>{7}(?: .*)?$/;

interface ParsedHunk {
  id: string;
  range: Range;
  base: string;
  /** True when a diff3 `|||||||` section was present, even if that section was empty. */
  baseFromMarker: boolean;
  /** Text under `<<<<<<<`. This is git's ours side. */
  ours: string;
  /** Text under `>>>>>>>`. This is git's theirs side. */
  theirs: string;
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
  let ours: string[] = [];
  let base: string[] = [];
  let theirs: string[] = [];
  let baseFromMarker = false;

  const close = (endLine: number): void => {
    hunks.push({
      id: `hunk:${String(startLine)}`,
      range: { startLine, endLine },
      base: base.join("\n"),
      baseFromMarker,
      ours: ours.join("\n"),
      theirs: theirs.join("\n"),
    });
    state = "outside";
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (state === "outside") {
      if (START.test(line)) {
        startLine = lineNumber;
        ours = [];
        base = [];
        theirs = [];
        baseFromMarker = false;
        state = "current";
      }
      return;
    }
    if (state === "current" && BASE.test(line)) {
      baseFromMarker = true;
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
    if (state === "current") ours.push(line);
    else if (state === "base") base.push(line);
    else theirs.push(line);
  });

  return hunks;
}

/**
 * Build a protocol conflict file.
 * During a rebase, git calls the replayed commit "theirs"; that side is `current` here.
 */
export function buildConflict(file: ConflictSource, operation: OperationContext): BuiltConflict {
  const knownBaseHunkIds: string[] = [];
  const hunks: ConflictHunk[] =
    file.text === null
      ? []
      : parseConflictHunks(file.text).map((hunk) => {
          const resolved = resolveBase(file, hunk);
          // A digest keeps two files distinct without putting the file name in the id.
          const id = `${pathDigest(file.path)}:${hunk.id}`;
          if (resolved.known) knownBaseHunkIds.push(id);
          const swapped = operation.operation === "rebase";
          return {
            id,
            range: hunk.range,
            base: resolved.base,
            current: swapped ? hunk.theirs : hunk.ours,
            incoming: swapped ? hunk.ours : hunk.theirs,
            temporal: emptyTemporal(),
            semanticChanges: [],
          };
        });
  return {
    file: {
      path: file.path,
      kind: file.kind ?? conflictKind(file),
      languageId: languageIdFor(file.path),
      hunks,
      operation,
    },
    knownBaseHunkIds,
  };
}

/** Build a protocol conflict file from a git unmerged path. */
export function toConflictFile(file: ConflictSource, operation: OperationContext): ConflictFile {
  return buildConflict(file, operation).file;
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

function pathDigest(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
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

function resolveBase(file: ConflictSource, hunk: ParsedHunk): { base: string; known: boolean } {
  if (hunk.baseFromMarker) return { base: hunk.base, known: true };
  const stageBase = file.stages?.base;
  if (stageBase == null || file.text === null) return { base: "", known: false };
  const recovered = recoverHunkBase(file.text, hunk.range, stageBase);
  if (recovered === null) return { base: "", known: false };
  return { base: recovered, known: true };
}

/**
 * Recover the base slice of a hunk from the stage-1 blob.
 * Returns null when the clean lines around the markers do not match that blob.
 */
export function recoverHunkBase(fileText: string, range: Range, baseText: string): string | null {
  const fileLines = splitLines(fileText);
  const baseLines = splitLines(baseText);
  const prefix = fileLines.slice(0, range.startLine - 1);
  const suffix = fileLines.slice(range.endLine);
  if (baseLines.length < prefix.length + suffix.length) return null;
  for (let index = 0; index < prefix.length; index += 1) {
    if (baseLines[index] !== prefix[index]) return null;
  }
  const suffixStart = baseLines.length - suffix.length;
  for (let index = 0; index < suffix.length; index += 1) {
    if (baseLines[suffixStart + index] !== suffix[index]) return null;
  }
  return baseLines.slice(prefix.length, suffixStart).join("\n");
}

/** Split on LF or CRLF, keeping a trailing empty line when the text ends with a newline. */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
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
    case "yaml":
    case "yml":
      return "yaml";
    case "md":
      return "markdown";
    case "py":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "c":
    case "h":
      return "c";
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "hh":
    case "hxx":
      return "cpp";
    case "php":
      return "php";
    case "rb":
      return "ruby";
    case "swift":
      return "swift";
    case "sql":
      return "sql";
    case "java":
      return "java";
    case "kt":
    case "kts":
      return "kotlin";
    case "cs":
      return "csharp";
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
