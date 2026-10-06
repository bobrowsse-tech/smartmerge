import type { ConflictFile, ConflictHunk, OperationContext } from "@smartmerge/protocol";
import { beforeAll, describe, expect, it } from "vitest";
import { STRUCTURAL_LANGUAGES, initParsers, isStructuralLanguage, parseSource } from "./parse.js";
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
  return proposalForLanguage("typescript", "file.ts", base, current, incoming);
}

function proposalForLanguage(
  languageId: string,
  path: string,
  base: string,
  current: string,
  incoming: string,
) {
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
    path,
    kind: "content",
    languageId,
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

  it("merges JSON object keys that each side adds", () => {
    const chosen = proposalForLanguage(
      "json",
      "data.json",
      '{\n  "shared": 1\n}\n',
      '{\n  "shared": 1,\n  "a": 1\n}\n',
      '{\n  "shared": 1,\n  "b": 2\n}\n',
    );
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]).toMatchObject({
      result: '{\n  "shared": 1,\n  "a": 1,\n  "b": 2\n}\n',
      band: "high",
      confidence: 0.95,
      hazardous: false,
      evidence: [
        {
          code: "json-keys",
          text: "Each side edited different object keys. Untouched text is copied from the base.",
        },
      ],
    });
    expect(chosen?.autoApplyEligible).toBe(false);
  });

  it("merges keys added inside the same nested JSON object", () => {
    const chosen = proposalForLanguage(
      "json",
      "data.json",
      '{\n  "user": {\n    "name": "a"\n  }\n}\n',
      '{\n  "user": {\n    "name": "a",\n    "age": 2\n  }\n}\n',
      '{\n  "user": {\n    "name": "a",\n    "role": "b"\n  }\n}\n',
    );
    expect(chosen?.candidates[0]?.result).toBe(
      '{\n  "user": {\n    "name": "a",\n    "age": 2,\n    "role": "b"\n  }\n}\n',
    );
    expect(chosen?.candidates[0]?.band).toBe("high");
  });

  it("does not merge a JSON key that both sides change", () => {
    const chosen = proposalForLanguage(
      "json",
      "data.json",
      '{ "n": 1 }\n',
      '{ "n": 2 }\n',
      '{ "n": 3 }\n',
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("merges keys added to an empty JSON object", () => {
    const chosen = proposalForLanguage("json", "data.json", "{}\n", '{ "a": 1 }\n', '{ "b": 2 }\n');
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]?.result).toBe('{ "a": 1, "b": 2 }\n');
    expect(chosen?.candidates[0]?.band).toBe("high");
  });

  it("drops the comma of a deleted first JSON key", () => {
    const chosen = proposalForLanguage(
      "json",
      "data.json",
      '{\n  "a": 1,\n  "b": 2\n}\n',
      '{\n  "b": 2\n}\n',
      '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}\n',
    );
    expect(chosen?.candidates[0]?.result).toBe('{\n  "b": 2,\n  "c": 3\n}\n');
    expect(chosen?.candidates[0]?.band).toBe("high");
  });

  it("treats an escaped JSON key as the same key", () => {
    const chosen = proposalForLanguage(
      "json",
      "data.json",
      '{ "a": 1 }\n',
      '{ "a": 2 }\n',
      '{ "\\u0061": 3 }\n',
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("does not merge JSON arrays by position when both sides change length", () => {
    const chosen = proposalForLanguage("json", "data.json", "[1]\n", "[1, 2]\n", "[1, 3]\n");
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("merges YAML mapping keys that each side adds", () => {
    const chosen = proposalForLanguage(
      "yaml",
      "data.yaml",
      "shared: 1\n",
      "shared: 1\na: 1\n",
      "shared: 1\nb: 2\n",
    );
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]).toMatchObject({
      result: "shared: 1\na: 1\nb: 2\n",
      band: "high",
      confidence: 0.95,
      hazardous: false,
      evidence: [
        {
          code: "yaml-keys",
          text: "Each side edited different mapping keys. Untouched text is copied from the base.",
        },
      ],
    });
    expect(chosen?.autoApplyEligible).toBe(false);
  });

  it("merges keys added inside the same nested YAML mapping", () => {
    const chosen = proposalForLanguage(
      "yaml",
      "data.yaml",
      "user:\n  name: a\n",
      "user:\n  name: a\n  age: 2\n",
      "user:\n  name: a\n  role: b\n",
    );
    expect(chosen?.candidates[0]?.result).toBe("user:\n  name: a\n  age: 2\n  role: b\n");
    expect(chosen?.candidates[0]?.band).toBe("high");
  });

  it("merges keys added to an empty YAML flow mapping", () => {
    const chosen = proposalForLanguage("yaml", "data.yaml", "{}\n", "{ a: 1 }\n", "{ b: 2 }\n");
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]?.result).toBe("{ a: 1, b: 2 }\n");
  });

  it("does not merge a YAML key that both sides change", () => {
    const chosen = proposalForLanguage("yaml", "data.yaml", "n: 1\n", "n: 2\n", "n: 3\n");
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("keeps an added YAML flow key before a trailing comment", () => {
    const chosen = proposalForLanguage(
      "yaml",
      "data.yaml",
      "{ shared: 1 # note\n}\n",
      "{ shared: 1, a: 1 # note\n}\n",
      "{ shared: 1, b: 2 # note\n}\n",
    );
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]?.result).toBe("{ shared: 1, a: 1, b: 2 # note\n}\n");
    expect(chosen?.candidates[0]?.band).toBe("high");
  });

  it("treats a YAML hex escape as the same key", () => {
    const chosen = proposalForLanguage(
      "yaml",
      "data.yaml",
      "{}\n",
      "{ a: 1 }\n",
      '{ "\\x61": 1 }\n',
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("treats a quoted YAML key as the same key", () => {
    const chosen = proposalForLanguage("yaml", "data.yaml", "a: 1\n", "a: 2\n", '"a": 3\n');
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("does not merge YAML sequences when both sides change them", () => {
    const chosen = proposalForLanguage(
      "yaml",
      "data.yaml",
      "items:\n  - 1\n",
      "items:\n  - 1\n  - 2\n",
      "items:\n  - 1\n  - 3\n",
    );
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("merges Python functions that each side edits", () => {
    const chosen = proposalForLanguage(
      "python",
      "mod.py",
      "def alpha():\n    return 1\n\ndef beta():\n    return 1\n",
      "def alpha():\n    return 2\n\ndef beta():\n    return 1\n",
      "def alpha():\n    return 1\n\ndef beta():\n    return 3\n",
    );
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]).toMatchObject({
      result: "def alpha():\n    return 2\n\ndef beta():\n    return 3\n",
      band: "high",
      confidence: 0.95,
      hazardous: false,
      evidence: [
        {
          code: "python-defs",
          text: "Each side edited different functions or classes. Untouched text is copied from the base.",
        },
      ],
    });
    expect(chosen?.autoApplyEligible).toBe(false);
  });

  it("keeps methods added on each side of a Python class", () => {
    const chosen = proposalForLanguage(
      "python",
      "mod.py",
      "class Box:\n    def left(self):\n        return 1\n",
      "class Box:\n    def left(self):\n        return 1\n    def right(self):\n        return 2\n",
      "class Box:\n    def left(self):\n        return 1\n    def top(self):\n        return 3\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "class Box:\n    def left(self):\n        return 1\n    def right(self):\n        return 2\n    def top(self):\n        return 3\n",
    );
    expect(chosen?.candidates[0]?.band).toBe("high");
  });

  it("does not merge Python assignments by position", () => {
    const chosen = proposalForLanguage(
      "python",
      "mod.py",
      "x = 1\ny = 1\n",
      "x = 2\ny = 1\n",
      "x = 1\ny = 3\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("does not merge different statements inside one Python function", () => {
    const chosen = proposalForLanguage(
      "python",
      "mod.py",
      "def alpha():\n    x = 1\n    y = 1\n",
      "def alpha():\n    x = 2\n    y = 1\n",
      "def alpha():\n    x = 1\n    y = 3\n",
    );
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("merges Go functions that each side edits", () => {
    const chosen = proposalForLanguage(
      "go",
      "mod.go",
      "package p\n\nfunc Alpha() int {\n\treturn 1\n}\n\nfunc Beta() int {\n\treturn 1\n}\n",
      "package p\n\nfunc Alpha() int {\n\treturn 2\n}\n\nfunc Beta() int {\n\treturn 1\n}\n",
      "package p\n\nfunc Alpha() int {\n\treturn 1\n}\n\nfunc Beta() int {\n\treturn 3\n}\n",
    );
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]).toMatchObject({
      result:
        "package p\n\nfunc Alpha() int {\n\treturn 2\n}\n\nfunc Beta() int {\n\treturn 3\n}\n",
      band: "high",
      confidence: 0.95,
      hazardous: false,
      evidence: [
        {
          code: "go-funcs",
          text: "Each side edited different functions or methods. Untouched text is copied from the base.",
        },
      ],
    });
    expect(chosen?.autoApplyEligible).toBe(false);
  });

  it("keeps methods added on each side of the same Go type", () => {
    const chosen = proposalForLanguage(
      "go",
      "mod.go",
      "package p\n\nfunc (b *Box) Left() int {\n\treturn 1\n}\n",
      "package p\n\nfunc (b *Box) Left() int {\n\treturn 1\n}\n\nfunc (b *Box) Right() int {\n\treturn 2\n}\n",
      "package p\n\nfunc (b *Box) Left() int {\n\treturn 1\n}\n\nfunc (b *Box) Top() int {\n\treturn 3\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "package p\n\nfunc (b *Box) Left() int {\n\treturn 1\n}\n\nfunc (b *Box) Right() int {\n\treturn 2\n}\n\nfunc (b *Box) Top() int {\n\treturn 3\n}\n",
    );
    expect(chosen?.candidates[0]?.band).toBe("high");
  });

  it("keeps methods with the same name on different Go types", () => {
    const chosen = proposalForLanguage(
      "go",
      "mod.go",
      "package p\n",
      "package p\n\nfunc (b *Box) Left() int {\n\treturn 1\n}\n",
      "package p\n\nfunc (b *Bag) Left() int {\n\treturn 2\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "package p\n\nfunc (b *Box) Left() int {\n\treturn 1\n}\n\nfunc (b *Bag) Left() int {\n\treturn 2\n}\n",
    );
  });

  it("does not merge Go declarations by position", () => {
    const chosen = proposalForLanguage(
      "go",
      "mod.go",
      "package p\n\nvar x = 1\nvar y = 1\n",
      "package p\n\nvar x = 2\nvar y = 1\n",
      "package p\n\nvar x = 1\nvar y = 3\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("does not merge a Go function that both sides change", () => {
    const chosen = proposalForLanguage(
      "go",
      "mod.go",
      "package p\n\nfunc Alpha() int {\n\treturn 1\n}\n",
      "package p\n\nfunc Alpha() int {\n\treturn 2\n}\n",
      "package p\n\nfunc Alpha() int {\n\treturn 3\n}\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("merges Java methods that each side edits", () => {
    const chosen = proposalForLanguage(
      "java",
      "Box.java",
      "class Box {\n  int left() { return 1; }\n  int right() { return 1; }\n}\n",
      "class Box {\n  int left() { return 2; }\n  int right() { return 1; }\n}\n",
      "class Box {\n  int left() { return 1; }\n  int right() { return 3; }\n}\n",
    );
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]).toMatchObject({
      result: "class Box {\n  int left() { return 2; }\n  int right() { return 3; }\n}\n",
      band: "high",
      confidence: 0.95,
      hazardous: false,
      evidence: [
        {
          code: "java-types",
          text: "Each side edited different types or methods. Untouched text is copied from the base.",
        },
      ],
    });
    expect(chosen?.autoApplyEligible).toBe(false);
  });

  it("keeps a Java constructor and a method edited on the other side", () => {
    const chosen = proposalForLanguage(
      "java",
      "Box.java",
      "class Box {\n  int left() { return 1; }\n}\n",
      "class Box {\n  Box() { }\n  int left() { return 1; }\n}\n",
      "class Box {\n  int left() { return 2; }\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "class Box {\n  Box() { }\n  int left() { return 2; }\n}\n",
    );
    expect(chosen?.candidates[0]?.band).toBe("high");
  });

  it("merges a Java class, interface, and enum when each side edits a different member", () => {
    const chosen = proposalForLanguage(
      "java",
      "Types.java",
      "class Box {\n  int left() { return 1; }\n}\ninterface Bag {\n  int size();\n}\nenum Hue { RED }\n",
      "class Box {\n  int left() { return 2; }\n}\ninterface Bag {\n  int size();\n}\nenum Hue { RED }\n",
      "class Box {\n  int left() { return 1; }\n}\ninterface Bag {\n  int size();\n  int other();\n}\nenum Hue { RED }\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "class Box {\n  int left() { return 2; }\n}\ninterface Bag {\n  int size();\n  int other();\n}\nenum Hue { RED }\n",
    );
  });

  it("keeps methods with the same name on different Java types", () => {
    const chosen = proposalForLanguage(
      "java",
      "Types.java",
      "class Box {\n  int left() { return 1; }\n}\nclass Bag {\n  int left() { return 1; }\n}\n",
      "class Box {\n  int left() { return 2; }\n}\nclass Bag {\n  int left() { return 1; }\n}\n",
      "class Box {\n  int left() { return 1; }\n}\nclass Bag {\n  int left() { return 3; }\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "class Box {\n  int left() { return 2; }\n}\nclass Bag {\n  int left() { return 3; }\n}\n",
    );
  });

  it("does not merge Java fields by position", () => {
    const chosen = proposalForLanguage(
      "java",
      "Box.java",
      "class Box {\n  int x = 1;\n  int y = 1;\n}\n",
      "class Box {\n  int x = 2;\n  int y = 1;\n}\n",
      "class Box {\n  int x = 1;\n  int y = 3;\n}\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("does not merge a Java method that both sides change", () => {
    const chosen = proposalForLanguage(
      "java",
      "Box.java",
      "class Box {\n  int left() { return 1; }\n}\n",
      "class Box {\n  int left() { return 2; }\n}\n",
      "class Box {\n  int left() { return 3; }\n}\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("does not merge a Python function that both sides change", () => {
    const chosen = proposalForLanguage(
      "python",
      "mod.py",
      "def alpha():\n    return 1\n",
      "def alpha():\n    return 2\n",
      "def alpha():\n    return 3\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
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

describe("structural languages", () => {
  it("advertises every language the parser can load", () => {
    expect(STRUCTURAL_LANGUAGES).toContain("python");
    expect(STRUCTURAL_LANGUAGES).toContain("json");
    expect(STRUCTURAL_LANGUAGES).toContain("yaml");
    expect(STRUCTURAL_LANGUAGES).toContain("go");
    expect(STRUCTURAL_LANGUAGES).toContain("java");
    for (const languageId of STRUCTURAL_LANGUAGES) {
      expect(isStructuralLanguage(languageId)).toBe(true);
    }
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

  it("flags a repeated JSON object key", () => {
    const clean = parseSource("json", '{ "a": 1, "b": 2 }\n');
    const duplicated = parseSource("json", '{ "a": 1, "a": 2 }\n');
    const escaped = parseSource("json", '{ "a": 1, "\\u0061": 2 }\n');
    if (!clean || !duplicated || !escaped) throw new Error("parser unavailable");
    expect(duplicated.hasErrors).toBe(false);
    expect(duplicated.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(true);
    expect(escaped.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(true);
    expect(verifyParsed("data.json", duplicated, clean, clean).hazardous).toBe(true);
  });

  it("flags a repeated YAML mapping key", () => {
    const clean = parseSource("yaml", "a: 1\nb: 2\n");
    const duplicated = parseSource("yaml", "a: 1\na: 2\n");
    const quoted = parseSource("yaml", 'a: 1\n"a": 2\n');
    const hex = parseSource("yaml", 'a: 1\n"\\x61": 2\n');
    if (!clean || !duplicated || !quoted || !hex) throw new Error("parser unavailable");
    expect(duplicated.hasErrors).toBe(false);
    expect(duplicated.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(true);
    expect(quoted.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(true);
    expect(hex.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(true);
    expect(verifyParsed("data.yaml", duplicated, clean, clean).hazardous).toBe(true);
  });

  it("flags a repeated Java method and ignores an undeclared call", () => {
    const clean = parseSource("java", "class Box {\n  int left() { return 1; }\n}\n");
    const duplicated = parseSource(
      "java",
      "class Box {\n  int left() { return 1; }\n  int left() { return 2; }\n}\n",
    );
    const differentType = parseSource(
      "java",
      "class Box {\n  int left() { return 1; }\n}\nclass Bag {\n  int left() { return 2; }\n}\n",
    );
    const called = parseSource("java", "class Box {\n  int left() { return missing(); }\n}\n");
    if (!clean || !duplicated || !differentType || !called) throw new Error("parser unavailable");
    expect(duplicated.hasErrors).toBe(false);
    expect(duplicated.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(true);
    expect(differentType.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(false);
    expect(called.symbolIssues.some((issue) => issue.code === "undeclared")).toBe(false);
    expect(verifyParsed("Box.java", duplicated, clean, clean).hazardous).toBe(true);
  });

  it("flags a repeated Go function or method name", () => {
    const clean = parseSource("go", "package p\n\nfunc Alpha() int {\n\treturn 1\n}\n");
    const duplicated = parseSource(
      "go",
      "package p\n\nfunc Alpha() int {\n\treturn 1\n}\n\nfunc Alpha() int {\n\treturn 2\n}\n",
    );
    const sameType = parseSource(
      "go",
      "package p\n\nfunc (b *Box) Left() int {\n\treturn 1\n}\n\nfunc (b *Box) Left() int {\n\treturn 2\n}\n",
    );
    const differentType = parseSource(
      "go",
      "package p\n\nfunc (b *Box) Left() int {\n\treturn 1\n}\n\nfunc (b *Bag) Left() int {\n\treturn 2\n}\n",
    );
    if (!clean || !duplicated || !sameType || !differentType) throw new Error("parser unavailable");
    expect(duplicated.hasErrors).toBe(false);
    expect(duplicated.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(true);
    expect(sameType.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(true);
    expect(differentType.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(false);
    expect(verifyParsed("mod.go", duplicated, clean, clean).hazardous).toBe(true);
  });

  it("flags a repeated Python function name", () => {
    const clean = parseSource("python", "def alpha():\n    return 1\n");
    const duplicated = parseSource(
      "python",
      "def alpha():\n    return 1\n\ndef alpha():\n    return 2\n",
    );
    if (!clean || !duplicated) throw new Error("parser unavailable");
    expect(duplicated.hasErrors).toBe(false);
    expect(duplicated.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(true);
    expect(verifyParsed("mod.py", duplicated, clean, clean).hazardous).toBe(true);
  });

  it("allows a repeated key in a JavaScript object literal", () => {
    const parsed = parseSource("javascript", "const value = { a: 1, a: 2 };\n");
    expect(parsed?.hasErrors).toBe(false);
    expect(parsed?.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(false);
  });
});
