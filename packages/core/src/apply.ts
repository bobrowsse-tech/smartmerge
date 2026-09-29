import type { Range } from "@smartmerge/protocol";
import { splitLines } from "./conflicts.js";

/**
 * Replace the inclusive marker range with `result`.
 * Line numbers outside the range stay aligned, and a trailing newline is preserved.
 */
export function replaceHunk(text: string, range: Range, result: string): string {
  const lines = splitLines(text);
  const before = lines.slice(0, range.startLine - 1);
  const after = lines.slice(range.endLine);
  const inserted = result.length === 0 ? [] : result.split("\n");
  return [...before, ...inserted, ...after].join("\n");
}
