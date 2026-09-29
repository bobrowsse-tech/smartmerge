import type { ConflictFile, ConflictHunk, OperationContext } from "@smartmerge/protocol";
import { beforeAll, describe, expect, it } from "vitest";
import { initParsers } from "./parse.js";
import { proposeForFile } from "./strategies.js";

/**
 * Synthetic TypeScript and JavaScript replay cases.
 * Real repository history is fetched by script and is not stored here.
 * Auto-apply precision is the share of `certain` results that match the expected text.
 */

const operation: OperationContext = {
  operation: "merge",
  current: { label: "main", role: "ours", commitSha: "aaaaaaaaaa" },
  incoming: { label: "topic", role: "theirs", commitSha: "bbbbbbbbbb" },
  mergeBaseSha: "cccccccccc",
};

const cases: Array<{
  languageId: "typescript" | "javascript";
  base: string;
  current: string;
  incoming: string;
  expected: string | null;
}> = [
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

beforeAll(async () => {
  await initParsers();
});

describe("replay corpus", () => {
  it("keeps auto-apply precision at or above 99 percent on certain results", () => {
    let certain = 0;
    let correct = 0;
    for (const item of cases) {
      const hunk: ConflictHunk = {
        id: "hunk:1",
        range: { startLine: 1, endLine: 8 },
        base: item.base,
        current: item.current,
        incoming: item.incoming,
        temporal: {
          current: { side: "current", commits: [], changeClasses: [], ageMs: null },
          incoming: { side: "incoming", commits: [], changeClasses: [], ageMs: null },
          base: { side: "base", commits: [], changeClasses: [], ageMs: null },
          incomingNewerByMs: null,
        },
        semanticChanges: [],
      };
      const file: ConflictFile = {
        path: item.languageId === "javascript" ? "file.js" : "file.ts",
        kind: "content",
        languageId: item.languageId,
        operation,
        hunks: [hunk],
      };
      const proposal = proposeForFile(file, new Set(["hunk:1"]))[0];
      const chosen = proposal?.candidates.find(
        (candidate) => candidate.id === proposal.recommended,
      );
      if (chosen?.band !== "certain") continue;
      certain += 1;
      if (chosen.result === item.expected) correct += 1;
    }
    expect(certain).toBeGreaterThanOrEqual(4);
    expect(correct / certain).toBeGreaterThanOrEqual(0.99);
  });
});
