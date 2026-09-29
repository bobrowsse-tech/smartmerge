import type { Check, Diagnostic } from "@smartmerge/protocol";
import type { ParseIssue, ParsedSource } from "./parse.js";

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

function counts(issues: readonly ParseIssue[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const issue of issues) {
    const key = `${issue.code}\0${issue.message}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}
