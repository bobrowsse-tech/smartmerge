import type { ConflictFile, ConflictHunk, OperationContext } from "@smartmerge/protocol";
import { beforeAll, describe, expect, it } from "vitest";
import { initParsers, parseSource } from "./parse.js";
import { proposeForFile } from "./strategies.js";
import { verifyParsed } from "./verify.js";

const operation: OperationContext = {
  operation: "merge",
  current: { label: "main", role: "ours", commitSha: "a" },
  incoming: { label: "topic", role: "theirs", commitSha: "b" },
  mergeBaseSha: "c",
};

beforeAll(async () => {
  await initParsers();
});

function proposalFor(base: string, current: string, incoming: string) {
  const hunk: ConflictHunk = {
    id: "hunk:1",
    range: { startLine: 1, endLine: 10 },
    base,
    current,
    incoming,
    temporal: {
      current: { side: "current", commits: [], changeClasses: [], ageMs: null },
      incoming: { side: "incoming", commits: [], changeClasses: [], ageMs: null },
      base: { side: "base", commits: [], changeClasses: [], ageMs: null },
      incomingNewerByMs: null,
    },
    semanticChanges: [],
  };
  const file: ConflictFile = {
    path: "file.ts",
    kind: "content",
    languageId: "typescript",
    operation,
    hunks: [hunk],
  };
  return proposeForFile(file, new Set(["hunk:1"]))[0];
}

describe("structural strategies", () => {
  it("merges edits to different functions and keeps the base formatting", () => {
    const chosen = proposalFor(
      "function alpha() {\n  return 1;\n}\n\nfunction beta() {\n  return 1;\n}\n",
      "function alpha() {\n  return 2;\n}\n\nfunction beta() {\n  return 1;\n}\n",
      "function alpha() {\n  return 1;\n}\n\nfunction beta() {\n  return 3;\n}\n",
    );
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]).toMatchObject({
      result: "function alpha() {\n  return 2;\n}\n\nfunction beta() {\n  return 3;\n}\n",
      band: "certain",
      confidence: 0.99,
      hazardous: false,
    });
    expect(chosen?.autoApplyEligible).toBe(true);
    expect(chosen?.candidates[0]?.checks.map((check) => check.status)).toEqual(["pass", "pass"]);
  });

  it("unions named imports without sorting them", () => {
    const chosen = proposalFor(
      'import { a } from "./m";\n',
      'import { a, b } from "./m";\n',
      'import { a, c } from "./m";\n',
    );
    expect(chosen?.recommended).toBe("hunk:1:list-union");
    expect(chosen?.candidates[0]?.result).toBe('import { a, b, c } from "./m";\n');
  });

  it("keeps methods added on each side of a class", () => {
    const chosen = proposalFor(
      "class Box {\n  left() {\n    return 1;\n  }\n}\n",
      "class Box {\n  left() {\n    return 1;\n  }\n  right() {\n    return 2;\n  }\n}\n",
      "class Box {\n  left() {\n    return 1;\n  }\n  top() {\n    return 3;\n  }\n}\n",
    );
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]?.result).toContain("right()");
    expect(chosen?.candidates[0]?.result).toContain("top()");
    expect(chosen?.candidates[0]?.result).toContain("left()");
  });

  it("applies a rename from one side to the other side's edits", () => {
    const chosen = proposalFor(
      "function load() {\n  return 1;\n}\n",
      "function fetch() {\n  return 1;\n}\n",
      "function load() {\n  return 2;\n}\n",
    );
    expect(chosen?.recommended).toBe("hunk:1:rename-aware");
    expect(chosen?.candidates[0]?.result).toBe("function fetch() {\n  return 2;\n}\n");
  });

  it("merges different components in a TSX file", () => {
    const hunk: ConflictHunk = {
      id: "hunk:1",
      range: { startLine: 1, endLine: 10 },
      base: "function Alpha() {\n  return <b>1</b>;\n}\n\nfunction Beta() {\n  return <b>1</b>;\n}\n",
      current:
        "function Alpha() {\n  return <b>2</b>;\n}\n\nfunction Beta() {\n  return <b>1</b>;\n}\n",
      incoming:
        "function Alpha() {\n  return <b>1</b>;\n}\n\nfunction Beta() {\n  return <b>3</b>;\n}\n",
      temporal: {
        current: { side: "current", commits: [], changeClasses: [], ageMs: null },
        incoming: { side: "incoming", commits: [], changeClasses: [], ageMs: null },
        base: { side: "base", commits: [], changeClasses: [], ageMs: null },
        incomingNewerByMs: null,
      },
      semanticChanges: [],
    };
    const file: ConflictFile = {
      path: "view.tsx",
      kind: "content",
      languageId: "typescriptreact",
      operation,
      hunks: [hunk],
    };
    const chosen = proposeForFile(file, new Set(["hunk:1"]))[0];
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]?.result).toBe(
      "function Alpha() {\n  return <b>2</b>;\n}\n\nfunction Beta() {\n  return <b>3</b>;\n}\n",
    );
    expect(chosen?.autoApplyEligible).toBe(true);
  });

  it("does not recommend a merge when both sides edit the same function", () => {
    const chosen = proposalFor(
      "function alpha() {\n  return 1;\n}\n",
      "function alpha() {\n  return 2;\n}\n",
      "function alpha() {\n  return 3;\n}\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.autoApplyEligible).toBe(false);
  });
});

describe("breakage checks", () => {
  const clean = "function f(a: number) {\n  return a;\n}\n";

  it("flags a dropped brace, an undeclared call, a wrong arity, and a duplicate", () => {
    const base = parseSource("typescript", clean);
    if (!base) throw new Error("parser unavailable");
    const bad = [
      "function f(a: number) {\n  return a;\n",
      "function f(a: number) {\n  return missing(a);\n}\n",
      "function f(a: number) {\n  return a;\n}\nf();\n",
      "function f(a: number) {\n  return a;\n}\nfunction f(a: number) {\n  return a;\n}\n",
      "const x = ;\n",
    ];
    let missed = 0;
    for (const source of bad) {
      const parsed = parseSource("typescript", source);
      if (!parsed) {
        missed += 1;
        continue;
      }
      const verified = verifyParsed("file.ts", parsed, base, base);
      if (!verified.hazardous) missed += 1;
    }
    expect(missed / bad.length).toBeLessThan(0.02);
  });
});
