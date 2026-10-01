import type {
  Check,
  CheckKind,
  CheckStatus,
  Diagnostic,
  Range,
  VerifyResult,
} from "@smartmerge/protocol";
import { replaceHunk } from "./apply.js";
import { parseSource, type ParseIssue, type ParsedSource } from "./parse.js";

/** Same cap the proposal strategies use when checks have not all run. */
const UNCHECKED_CONFIDENCE = 0.8;
/** Same confidence a checked candidate gets when syntax or symbols fail. */
const FAILED_CONFIDENCE = 0.2;

/**
 * Syntax and symbol checks for a candidate, compared with the two sides.
 * A problem that already exists on either side is pre-existing and does not fail the candidate.
 */
export function verifyParsed(
  path: string,
  result: ParsedSource,
  current: ParsedSource,
  incoming: ParsedSource,
): { checks: Check[]; hazardous: boolean } {
  const started = Date.now();
  const syntax = layer(
    "syntax",
    path,
    result.syntaxIssues,
    current.syntaxIssues,
    incoming.syntaxIssues,
  );
  const symbols = layer(
    "symbols",
    path,
    result.symbolIssues,
    current.symbolIssues,
    incoming.symbolIssues,
  );
  const elapsed = Date.now() - started;
  syntax.durationMs = elapsed;
  symbols.durationMs = elapsed;
  return {
    checks: [syntax, symbols],
    hazardous: syntax.status === "fail" || symbols.status === "fail",
  };
}

function layer(
  kind: "syntax" | "symbols",
  path: string,
  result: readonly ParseIssue[],
  current: readonly ParseIssue[],
  incoming: readonly ParseIssue[],
): Check {
  const currentCounts = counts(current);
  const incomingCounts = counts(incoming);
  const seen = new Map<string, number>();
  const diagnostics: Diagnostic[] = [];
  let failed = false;
  for (const issue of result) {
    const key = `${issue.code}\0${issue.message}`;
    const used = (seen.get(key) ?? 0) + 1;
    seen.set(key, used);
    const baseline = Math.max(currentCounts.get(key) ?? 0, incomingCounts.get(key) ?? 0);
    const preExisting = used <= baseline;
    if (!preExisting) failed = true;
    diagnostics.push({
      severity: "error",
      message: issue.message,
      path,
      range: { startLine: issue.line, endLine: issue.line },
      code: issue.code,
      source: "smartmerge",
      preExisting,
    });
  }
  return {
    kind,
    status: failed ? "fail" : "pass",
    diagnostics,
    durationMs: 0,
  };
}

/**
 * Check a resolution someone else wrote. This does not write the file.
 * Types use the bundled compiler. Project lint runs only when `trusted` is set.
 * Confidence stays on the fixed checked values, so a passing type check is not a certain result.
 */
export async function verifyResolution(input: {
  path: string;
  languageId: string | null;
  result: string;
  current: string;
  incoming: string;
  /** Conflicted working file. With `hunkRange`, checks see the whole file with the hunk replaced. */
  fileText?: string;
  hunkRange?: Range;
  trusted?: boolean;
  projectRoot?: string;
}): Promise<VerifyResult> {
  const languageId = input.languageId ?? "";
  const variants = variantsFor(input);
  const checked = variants ?? {
    result: input.result,
    current: input.current,
    incoming: input.incoming,
  };
  // Loaded only for a verify call, so daemon startup and proposals do not pay for the compiler.
  const { checkTypes } = await import("./types.js");
  const types =
    variants === null
      ? notRun("types", "The hunk range does not match the file.")
      : checkTypes({ ...input, ...checked });
  const lint =
    input.trusted === true
      ? await (
          await import("./lint.js")
        ).checkLint({
          path: input.path,
          result: checked.result,
          current: checked.current,
          incoming: checked.incoming,
          trusted: true,
          ...(input.projectRoot === undefined ? {} : { projectRoot: input.projectRoot }),
        })
      : notRun("lint", "Project lint runs only in a trusted workspace.");
  const result = parseSource(languageId, checked.result);
  const current = parseSource(languageId, checked.current);
  const incoming = parseSource(languageId, checked.incoming);
  if (!result || !current || !incoming) {
    return summarize([
      notRun("syntax", "This language uses line comparison only."),
      notRun("symbols", "This language uses line comparison only."),
      types,
      lint,
    ]);
  }
  const verified = verifyParsed(input.path, result, current, incoming);
  return summarize([...verified.checks, types, lint]);
}

function variantsFor(input: {
  result: string;
  current: string;
  incoming: string;
  fileText?: string;
  hunkRange?: Range;
}): { result: string; current: string; incoming: string } | null | undefined {
  if (input.fileText === undefined || input.hunkRange === undefined) return undefined;
  try {
    return {
      result: replaceHunk(input.fileText, input.hunkRange, input.result),
      current: replaceHunk(input.fileText, input.hunkRange, input.current),
      incoming: replaceHunk(input.fileText, input.hunkRange, input.incoming),
    };
  } catch {
    return null;
  }
}

function summarize(checks: Check[]): VerifyResult {
  const overall = overallOf(checks);
  const hazardous = checks.some(
    (check) =>
      (check.kind === "syntax" || check.kind === "symbols" || check.kind === "types") &&
      check.status === "fail",
  );
  return {
    checks,
    hazardous,
    overall,
    confidence: hazardous ? FAILED_CONFIDENCE : UNCHECKED_CONFIDENCE,
    band: hazardous ? "low" : "medium",
  };
}

function overallOf(checks: readonly Check[]): CheckStatus {
  const decisive = checks.filter(
    (check) => check.kind === "syntax" || check.kind === "symbols" || check.kind === "types",
  );
  if (decisive.some((check) => check.status === "fail")) return "fail";
  if (decisive.length > 0 && decisive.every((check) => check.status === "pass")) return "pass";
  return "unknown";
}

function notRun(kind: CheckKind, reason: string): Check {
  return { kind, status: "unknown", diagnostics: [], durationMs: 0, reason };
}

function counts(issues: readonly ParseIssue[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const issue of issues) {
    const key = `${issue.code}\0${issue.message}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}
