/**
 * Compare texts after trailing whitespace and newline differences are removed.
 * Leading whitespace stays, because indentation is meaningful in some languages.
 * This does not run a project formatter.
 */
export function normalizeWhitespace(text: string): string {
  const lines = text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
