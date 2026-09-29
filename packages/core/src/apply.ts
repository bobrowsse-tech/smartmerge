import type { Range } from "@smartmerge/protocol";
import { splitLines } from "./conflicts.js";

/**
 * Replace the inclusive marker range with `result`.
 * Line numbers outside the range stay aligned. The file's newline style and a trailing newline stay as they were.
 * Throws when the range does not fall inside the file.
 */
export function replaceHunk(text: string, range: Range, result: string): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = splitLines(text);
  if (
    range.startLine < 1 ||
    range.endLine < range.startLine ||
    range.endLine > lines.length ||
    !Number.isInteger(range.startLine) ||
    !Number.isInteger(range.endLine)
  ) {
    throw new RangeError(
      `Hunk range ${String(range.startLine)}-${String(range.endLine)} is outside a file of ${String(lines.length)} lines`,
    );
  }
  const before = lines.slice(0, range.startLine - 1);
  const after = lines.slice(range.endLine);
  const inserted = result.length === 0 ? [] : result.split(/\r?\n/);
  return [...before, ...inserted, ...after].join(newline);
}
