import type { Check, CheckKind, Diagnostic } from "@smartmerge/protocol";

/** One diagnostic before it is compared with the two sides. */
export interface TextDiagnostic {
  code: string;
  message: string;
  line: number;
}

/**
 * Compare a candidate's diagnostics with the two sides.
 * A problem that already appears on either side is pre-existing and does not fail the candidate.
 */
export function compareBaseline(
  kind: CheckKind,
  path: string,
  result: readonly TextDiagnostic[],
  current: readonly TextDiagnostic[],
  incoming: readonly TextDiagnostic[],
  durationMs: number,
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
    durationMs,
  };
}

function counts(issues: readonly TextDiagnostic[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const issue of issues) {
    const key = `${issue.code}\0${issue.message}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}
