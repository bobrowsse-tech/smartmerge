/**
 * Synthetic TypeScript and JavaScript replay cases shared by the corpus benchmark and the agent gates.
 * Real repository history is fetched by script and is not stored here.
 * `expected` is null when both sides edit the same declaration and no safe auto-apply exists.
 */
export interface ReplayCase {
  languageId: "typescript" | "javascript";
  base: string;
  current: string;
  incoming: string;
  expected: string | null;
}

/** Replay cases used to score auto-apply precision and the agent workflow gate. */
export const REPLAY_CASES: readonly ReplayCase[] = [
  {
    languageId: "typescript",
    base: "function alpha() {\n  return 1;\n}\n\nfunction beta() {\n  return 1;\n}\n",
    current: "function alpha() {\n  return 2;\n}\n\nfunction beta() {\n  return 1;\n}\n",
    incoming: "function alpha() {\n  return 1;\n}\n\nfunction beta() {\n  return 3;\n}\n",
    expected: "function alpha() {\n  return 2;\n}\n\nfunction beta() {\n  return 3;\n}\n",
  },
  {
    languageId: "typescript",
    base: 'import { a } from "./m";\n',
    current: 'import { a, b } from "./m";\n',
    incoming: 'import { a, c } from "./m";\n',
    expected: 'import { a, b, c } from "./m";\n',
  },
  {
    languageId: "javascript",
    base: "function load() {\n  return 1;\n}\n",
    current: "function fetch() {\n  return 1;\n}\n",
    incoming: "function load() {\n  return 2;\n}\n",
    expected: "function fetch() {\n  return 2;\n}\n",
  },
  {
    languageId: "typescript",
    base: "export function kept() {\n  return 1;\n}\n\nexport function other() {\n  return 1;\n}\n",
    current:
      "export function kept() {\n  return 4;\n}\n\nexport function other() {\n  return 1;\n}\n",
    incoming:
      "export function kept() {\n  return 1;\n}\n\nexport function other() {\n  return 5;\n}\n",
    expected:
      "export function kept() {\n  return 4;\n}\n\nexport function other() {\n  return 5;\n}\n",
  },
  {
    languageId: "typescript",
    base: "function alpha() {\n  return 1;\n}\n",
    current: "function alpha() {\n  return 2;\n}\n",
    incoming: "function alpha() {\n  return 3;\n}\n",
    expected: null,
  },
];

/** Working-tree path for one replay case. */
export function replayPath(item: ReplayCase): string {
  return item.languageId === "javascript" ? "file.js" : "file.ts";
}
