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

  it("merges Kotlin functions that each side edits", () => {
    const chosen = proposalForLanguage(
      "kotlin",
      "Funs.kt",
      "fun alpha(): Int = 1\n\nfun beta(): Int = 1\n",
      "fun alpha(): Int = 2\n\nfun beta(): Int = 1\n",
      "fun alpha(): Int = 1\n\nfun beta(): Int = 3\n",
    );
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]).toMatchObject({
      result: "fun alpha(): Int = 2\n\nfun beta(): Int = 3\n",
      band: "high",
      confidence: 0.95,
      hazardous: false,
      evidence: [
        {
          code: "kotlin-defs",
          text: "Each side edited different types or functions. Untouched text is copied from the base.",
        },
      ],
    });
    expect(chosen?.autoApplyEligible).toBe(false);
  });

  it("keeps functions added on each side of the same Kotlin class", () => {
    const chosen = proposalForLanguage(
      "kotlin",
      "Box.kt",
      "class Box {\n  fun left(): Int = 1\n}\n",
      "class Box {\n  fun left(): Int = 1\n  fun right(): Int = 2\n}\n",
      "class Box {\n  fun left(): Int = 1\n  fun top(): Int = 3\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "class Box {\n  fun left(): Int = 1\n  fun right(): Int = 2\n  fun top(): Int = 3\n}\n",
    );
    expect(chosen?.candidates[0]?.band).toBe("high");
  });

  it("merges a Kotlin class, interface, and object when each side edits a different member", () => {
    const chosen = proposalForLanguage(
      "kotlin",
      "Types.kt",
      'class Box {\n  fun left(): Int = 1\n}\ninterface Bag {\n  fun size(): Int\n}\nobject Hue {\n  fun name(): String = "red"\n}\n',
      'class Box {\n  fun left(): Int = 2\n}\ninterface Bag {\n  fun size(): Int\n}\nobject Hue {\n  fun name(): String = "red"\n}\n',
      'class Box {\n  fun left(): Int = 1\n}\ninterface Bag {\n  fun size(): Int\n}\nobject Hue {\n  fun name(): String = "blue"\n}\n',
    );
    expect(chosen?.candidates[0]?.result).toBe(
      'class Box {\n  fun left(): Int = 2\n}\ninterface Bag {\n  fun size(): Int\n}\nobject Hue {\n  fun name(): String = "blue"\n}\n',
    );
  });

  it("keeps functions with the same name on different Kotlin types", () => {
    const chosen = proposalForLanguage(
      "kotlin",
      "Types.kt",
      "class Box {\n  fun left(): Int = 1\n}\nclass Bag {\n  fun left(): Int = 1\n}\n",
      "class Box {\n  fun left(): Int = 2\n}\nclass Bag {\n  fun left(): Int = 1\n}\n",
      "class Box {\n  fun left(): Int = 1\n}\nclass Bag {\n  fun left(): Int = 3\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "class Box {\n  fun left(): Int = 2\n}\nclass Bag {\n  fun left(): Int = 3\n}\n",
    );
  });

  it("does not merge Kotlin properties by position", () => {
    const chosen = proposalForLanguage(
      "kotlin",
      "Box.kt",
      "class Box {\n  val x = 1\n  val y = 1\n}\n",
      "class Box {\n  val x = 2\n  val y = 1\n}\n",
      "class Box {\n  val x = 1\n  val y = 3\n}\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("does not merge a Kotlin function that both sides change", () => {
    const chosen = proposalForLanguage(
      "kotlin",
      "Box.kt",
      "class Box {\n  fun left(): Int = 1\n}\n",
      "class Box {\n  fun left(): Int = 2\n}\n",
      "class Box {\n  fun left(): Int = 3\n}\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("merges C# methods that each side edits", () => {
    const chosen = proposalForLanguage(
      "csharp",
      "Box.cs",
      "class Box {\n  int Left() { return 1; }\n  int Right() { return 1; }\n}\n",
      "class Box {\n  int Left() { return 2; }\n  int Right() { return 1; }\n}\n",
      "class Box {\n  int Left() { return 1; }\n  int Right() { return 3; }\n}\n",
    );
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]).toMatchObject({
      result: "class Box {\n  int Left() { return 2; }\n  int Right() { return 3; }\n}\n",
      band: "high",
      confidence: 0.95,
      hazardous: false,
      evidence: [
        {
          code: "csharp-types",
          text: "Each side edited different types or methods. Untouched text is copied from the base.",
        },
      ],
    });
    expect(chosen?.autoApplyEligible).toBe(false);
  });

  it("keeps a C# constructor and a method edited on the other side", () => {
    const chosen = proposalForLanguage(
      "csharp",
      "Box.cs",
      "class Box {\n  int Left() { return 1; }\n}\n",
      "class Box {\n  public Box() { }\n  int Left() { return 1; }\n}\n",
      "class Box {\n  int Left() { return 2; }\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "class Box {\n  public Box() { }\n  int Left() { return 2; }\n}\n",
    );
    expect(chosen?.candidates[0]?.band).toBe("high");
  });

  it("merges a C# class, interface, struct, and enum when each side edits a different member", () => {
    const chosen = proposalForLanguage(
      "csharp",
      "Types.cs",
      "class Box {\n  int Left() { return 1; }\n}\ninterface Bag {\n  int Size();\n}\nstruct Point {\n  int X;\n}\nenum Hue { Red }\n",
      "class Box {\n  int Left() { return 2; }\n}\ninterface Bag {\n  int Size();\n}\nstruct Point {\n  int X;\n}\nenum Hue { Red }\n",
      "class Box {\n  int Left() { return 1; }\n}\ninterface Bag {\n  int Size();\n  int Other();\n}\nstruct Point {\n  int X;\n}\nenum Hue { Red }\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "class Box {\n  int Left() { return 2; }\n}\ninterface Bag {\n  int Size();\n  int Other();\n}\nstruct Point {\n  int X;\n}\nenum Hue { Red }\n",
    );
  });

  it("keeps methods with the same name on different C# types", () => {
    const chosen = proposalForLanguage(
      "csharp",
      "Types.cs",
      "class Box {\n  int Left() { return 1; }\n}\nclass Bag {\n  int Left() { return 1; }\n}\n",
      "class Box {\n  int Left() { return 2; }\n}\nclass Bag {\n  int Left() { return 1; }\n}\n",
      "class Box {\n  int Left() { return 1; }\n}\nclass Bag {\n  int Left() { return 3; }\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "class Box {\n  int Left() { return 2; }\n}\nclass Bag {\n  int Left() { return 3; }\n}\n",
    );
  });

  it("merges C# classes inside one namespace", () => {
    const chosen = proposalForLanguage(
      "csharp",
      "App.cs",
      "namespace App {\n  class Box { int Left() { return 1; } }\n  class Bag { int Left() { return 1; } }\n}\n",
      "namespace App {\n  class Box { int Left() { return 2; } }\n  class Bag { int Left() { return 1; } }\n}\n",
      "namespace App {\n  class Box { int Left() { return 1; } }\n  class Bag { int Left() { return 3; } }\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "namespace App {\n  class Box { int Left() { return 2; } }\n  class Bag { int Left() { return 3; } }\n}\n",
    );
  });

  it("does not merge C# fields by position", () => {
    const chosen = proposalForLanguage(
      "csharp",
      "Box.cs",
      "class Box {\n  int x = 1;\n  int y = 1;\n}\n",
      "class Box {\n  int x = 2;\n  int y = 1;\n}\n",
      "class Box {\n  int x = 1;\n  int y = 3;\n}\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("does not merge a C# method that both sides change", () => {
    const chosen = proposalForLanguage(
      "csharp",
      "Box.cs",
      "class Box {\n  int Left() { return 1; }\n}\n",
      "class Box {\n  int Left() { return 2; }\n}\n",
      "class Box {\n  int Left() { return 3; }\n}\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("merges Rust functions that each side edits", () => {
    const chosen = proposalForLanguage(
      "rust",
      "lib.rs",
      "fn alpha() -> i32 { 1 }\nfn beta() -> i32 { 1 }\n",
      "fn alpha() -> i32 { 2 }\nfn beta() -> i32 { 1 }\n",
      "fn alpha() -> i32 { 1 }\nfn beta() -> i32 { 3 }\n",
    );
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]).toMatchObject({
      result: "fn alpha() -> i32 { 2 }\nfn beta() -> i32 { 3 }\n",
      band: "high",
      confidence: 0.95,
      hazardous: false,
      evidence: [
        {
          code: "rust-items",
          text: "Each side edited different items. Untouched text is copied from the base.",
        },
      ],
    });
    expect(chosen?.autoApplyEligible).toBe(false);
  });

  it("merges methods on a Rust impl when each side edits a different one", () => {
    const chosen = proposalForLanguage(
      "rust",
      "lib.rs",
      "impl Box {\n  fn left(&self) -> i32 { 1 }\n  fn right(&self) -> i32 { 1 }\n}\n",
      "impl Box {\n  fn left(&self) -> i32 { 2 }\n  fn right(&self) -> i32 { 1 }\n}\n",
      "impl Box {\n  fn left(&self) -> i32 { 1 }\n  fn right(&self) -> i32 { 3 }\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "impl Box {\n  fn left(&self) -> i32 { 2 }\n  fn right(&self) -> i32 { 3 }\n}\n",
    );
    expect(chosen?.candidates[0]?.band).toBe("high");
  });

  it("keeps a Rust trait method distinct from an inherent method", () => {
    const chosen = proposalForLanguage(
      "rust",
      "lib.rs",
      "impl Box {\n  fn left(&self) -> i32 { 1 }\n}\nimpl Display for Box {\n  fn fmt(&self) -> i32 { 1 }\n}\n",
      "impl Box {\n  fn left(&self) -> i32 { 2 }\n}\nimpl Display for Box {\n  fn fmt(&self) -> i32 { 1 }\n}\n",
      "impl Box {\n  fn left(&self) -> i32 { 1 }\n}\nimpl Display for Box {\n  fn fmt(&self) -> i32 { 3 }\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "impl Box {\n  fn left(&self) -> i32 { 2 }\n}\nimpl Display for Box {\n  fn fmt(&self) -> i32 { 3 }\n}\n",
    );
  });

  it("keeps methods with the same name on different Rust types", () => {
    const chosen = proposalForLanguage(
      "rust",
      "lib.rs",
      "impl Box {\n  fn left(&self) -> i32 { 1 }\n}\nimpl Bag {\n  fn left(&self) -> i32 { 1 }\n}\n",
      "impl Box {\n  fn left(&self) -> i32 { 2 }\n}\nimpl Bag {\n  fn left(&self) -> i32 { 1 }\n}\n",
      "impl Box {\n  fn left(&self) -> i32 { 1 }\n}\nimpl Bag {\n  fn left(&self) -> i32 { 3 }\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "impl Box {\n  fn left(&self) -> i32 { 2 }\n}\nimpl Bag {\n  fn left(&self) -> i32 { 3 }\n}\n",
    );
  });

  it("merges Rust enum variants that each side edits", () => {
    const chosen = proposalForLanguage(
      "rust",
      "lib.rs",
      "enum Hue {\n  Red = 1,\n  Blue = 1,\n}\n",
      "enum Hue {\n  Red = 2,\n  Blue = 1,\n}\n",
      "enum Hue {\n  Red = 1,\n  Blue = 3,\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe("enum Hue {\n  Red = 2,\n  Blue = 3,\n}\n");
  });

  it("merges a Rust struct and a union when each side edits a different one", () => {
    const chosen = proposalForLanguage(
      "rust",
      "lib.rs",
      "struct Box {\n  x: i32,\n}\nunion Word {\n  x: u32,\n}\n",
      "struct Box {\n  x: u32,\n}\nunion Word {\n  x: u32,\n}\n",
      "struct Box {\n  x: i32,\n}\nunion Word {\n  x: i32,\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "struct Box {\n  x: u32,\n}\nunion Word {\n  x: i32,\n}\n",
    );
  });

  it("merges Rust functions in different modules", () => {
    const chosen = proposalForLanguage(
      "rust",
      "lib.rs",
      "mod app {\n  fn alpha() -> i32 { 1 }\n}\nmod bag {\n  fn alpha() -> i32 { 1 }\n}\n",
      "mod app {\n  fn alpha() -> i32 { 2 }\n}\nmod bag {\n  fn alpha() -> i32 { 1 }\n}\n",
      "mod app {\n  fn alpha() -> i32 { 1 }\n}\nmod bag {\n  fn alpha() -> i32 { 3 }\n}\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "mod app {\n  fn alpha() -> i32 { 2 }\n}\nmod bag {\n  fn alpha() -> i32 { 3 }\n}\n",
    );
  });

  it("does not merge Rust fields by position", () => {
    const chosen = proposalForLanguage(
      "rust",
      "lib.rs",
      "struct Box {\n  x: i32,\n  y: i32,\n}\n",
      "struct Box {\n  x: u32,\n  y: i32,\n}\n",
      "struct Box {\n  x: i32,\n  y: u32,\n}\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("does not merge Rust let bindings by position", () => {
    const chosen = proposalForLanguage(
      "rust",
      "lib.rs",
      "fn alpha() {\n  let x = 1;\n  let y = 1;\n}\n",
      "fn alpha() {\n  let x = 2;\n  let y = 1;\n}\n",
      "fn alpha() {\n  let x = 1;\n  let y = 3;\n}\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("does not merge Rust use declarations by position", () => {
    const chosen = proposalForLanguage(
      "rust",
      "lib.rs",
      "use crate::left;\nuse crate::right;\n",
      "use crate::alpha;\nuse crate::beta;\n",
      "use other::left;\nuse crate::extra;\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("does not merge a Rust function that both sides change", () => {
    const chosen = proposalForLanguage(
      "rust",
      "lib.rs",
      "fn alpha() -> i32 { 1 }\n",
      "fn alpha() -> i32 { 2 }\n",
      "fn alpha() -> i32 { 3 }\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("merges C functions that each side edits", () => {
    const chosen = proposalForLanguage(
      "c",
      "file.c",
      "int alpha(void) { return 1; }\nint beta(void) { return 1; }\n",
      "int alpha(void) { return 2; }\nint beta(void) { return 1; }\n",
      "int alpha(void) { return 1; }\nint beta(void) { return 3; }\n",
    );
    expect(chosen?.recommended).toBe("hunk:1:structural-3way");
    expect(chosen?.candidates[0]).toMatchObject({
      result: "int alpha(void) { return 2; }\nint beta(void) { return 3; }\n",
      band: "high",
      confidence: 0.95,
      hazardous: false,
      evidence: [
        {
          code: "c-items",
          text: "Each side edited different functions, types, or macros. Untouched text is copied from the base.",
        },
      ],
    });
    expect(chosen?.autoApplyEligible).toBe(false);
  });

  it("merges a C function that returns a pointer", () => {
    const chosen = proposalForLanguage(
      "c",
      "file.c",
      "int *alpha(void) { return 0; }\nint *beta(void) { return 0; }\n",
      "int *alpha(void) { return 1; }\nint *beta(void) { return 0; }\n",
      "int *alpha(void) { return 0; }\nint *beta(void) { return 1; }\n",
    );
    expect(chosen?.candidates[0]?.result).toBe(
      "int *alpha(void) { return 1; }\nint *beta(void) { return 1; }\n",
    );
  });

  it("merges C prototypes that each side edits", () => {
    const chosen = proposalForLanguage(
      "c",
      "file.h",
      "void left(void);\nvoid right(void);\n",
      "void left(int x);\nvoid right(void);\n",
      "void left(void);\nvoid right(int y);\n",
    );
    expect(chosen?.candidates[0]?.result).toBe("void left(int x);\nvoid right(int y);\n");
  });

  it("merges a C struct and an enum when each side edits a different one", () => {
    const chosen = proposalForLanguage(
      "c",
      "file.c",
      "struct Box { int x; };\nenum Hue { Red = 1 };\n",
      "struct Box { int y; };\nenum Hue { Red = 1 };\n",
      "struct Box { int x; };\nenum Hue { Red = 2 };\n",
    );
    expect(chosen?.candidates[0]?.result).toBe("struct Box { int y; };\nenum Hue { Red = 2 };\n");
  });

  it("merges C enumerators that each side edits", () => {
    const chosen = proposalForLanguage(
      "c",
      "file.c",
      "enum Hue { Red = 1, Blue = 1 };\n",
      "enum Hue { Red = 2, Blue = 1 };\n",
      "enum Hue { Red = 1, Blue = 3 };\n",
    );
    expect(chosen?.candidates[0]?.result).toBe("enum Hue { Red = 2, Blue = 3 };\n");
  });

  it("merges C macros that each side edits", () => {
    const chosen = proposalForLanguage(
      "c",
      "file.c",
      "#define MAX 1\n#define MIN 2\n",
      "#define MAX 3\n#define MIN 2\n",
      "#define MAX 1\n#define MIN 4\n",
    );
    expect(chosen?.candidates[0]?.result).toBe("#define MAX 3\n#define MIN 4\n");
  });

  it("does not merge C fields by position", () => {
    const chosen = proposalForLanguage(
      "c",
      "file.c",
      "struct Box { int x; int y; };\n",
      "struct Box { int a; int y; };\n",
      "struct Box { int x; int b; };\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("does not merge C statements by position", () => {
    const chosen = proposalForLanguage(
      "c",
      "file.c",
      "int alpha(void) {\n  int x = 1;\n  int y = 1;\n  return x;\n}\n",
      "int alpha(void) {\n  int x = 2;\n  int y = 1;\n  return x;\n}\n",
      "int alpha(void) {\n  int x = 1;\n  int y = 3;\n  return x;\n}\n",
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
  });

  it("does not merge C includes by position", () => {
    const chosen = proposalForLanguage(
      "c",
      "file.c",
      '#include "left.h"\n#include "right.h"\n',
      '#include "alpha.h"\n#include "beta.h"\n',
      '#include "other.h"\n#include "extra.h"\n',
    );
    expect(chosen?.recommended).toBeNull();
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "structural-3way")).toBe(
      false,
    );
    expect(chosen?.candidates.some((candidate) => candidate.strategy === "rename-aware")).toBe(
      false,
    );
  });

  it("does not merge a C function that both sides change", () => {
    const chosen = proposalForLanguage(
      "c",
      "file.c",
      "int alpha(void) { return 1; }\n",
      "int alpha(void) { return 2; }\n",
      "int alpha(void) { return 3; }\n",
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
    expect(STRUCTURAL_LANGUAGES).toContain("kotlin");
    expect(STRUCTURAL_LANGUAGES).toContain("csharp");
    expect(STRUCTURAL_LANGUAGES).toContain("rust");
    expect(STRUCTURAL_LANGUAGES).toContain("c");
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

  it("flags a repeated C# method and ignores an undeclared call", () => {
    const clean = parseSource("csharp", "class Box {\n  int Left() { return 1; }\n}\n");
    const duplicated = parseSource(
      "csharp",
      "class Box {\n  int Left() { return 1; }\n  int Left() { return 2; }\n}\n",
    );
    const differentType = parseSource(
      "csharp",
      "class Box {\n  int Left() { return 1; }\n}\nclass Bag {\n  int Left() { return 2; }\n}\n",
    );
    const called = parseSource("csharp", "class Box {\n  int Left() { return missing(); }\n}\n");
    if (!clean || !duplicated || !differentType || !called) throw new Error("parser unavailable");
    expect(duplicated.hasErrors).toBe(false);
    expect(duplicated.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(true);
    expect(differentType.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(false);
    expect(called.symbolIssues.some((issue) => issue.code === "undeclared")).toBe(false);
    expect(verifyParsed("Box.cs", duplicated, clean, clean).hazardous).toBe(true);
  });

  it("flags a repeated Rust function and ignores an undeclared call", () => {
    const clean = parseSource("rust", "fn alpha() -> i32 { 1 }\n");
    const duplicated = parseSource("rust", "fn alpha() -> i32 { 1 }\nfn alpha() -> i32 { 2 }\n");
    const twoImpls = parseSource(
      "rust",
      "impl Box {\n  fn left(&self) -> i32 { 1 }\n}\nimpl Box {\n  fn right(&self) -> i32 { 1 }\n}\n",
    );
    const externs = parseSource(
      "rust",
      'extern "C" {\n  fn alpha();\n}\nextern "C" {\n  fn beta();\n}\n',
    );
    const modules = parseSource(
      "rust",
      "mod app {\n  fn alpha() -> i32 { 1 }\n}\nmod bag {\n  fn alpha() -> i32 { 1 }\n}\n",
    );
    const called = parseSource("rust", "fn alpha() {\n  missing();\n}\n");
    if (!clean || !duplicated || !twoImpls || !externs || !modules || !called) {
      throw new Error("parser unavailable");
    }
    expect(duplicated.hasErrors).toBe(false);
    expect(duplicated.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(true);
    expect(twoImpls.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(false);
    expect(externs.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(false);
    expect(modules.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(false);
    expect(called.symbolIssues.some((issue) => issue.code === "undeclared")).toBe(false);
    expect(verifyParsed("lib.rs", duplicated, clean, clean).hazardous).toBe(true);
  });

  it("flags a repeated C function and ignores an undeclared call", () => {
    const clean = parseSource("c", "int alpha(void) { return 1; }\n");
    const duplicated = parseSource(
      "c",
      "int alpha(void) { return 1; }\nint alpha(void) { return 2; }\n",
    );
    const prototype = parseSource("c", "int alpha(void);\nint alpha(void) { return 1; }\n");
    const repeatedPrototype = parseSource("c", "void alpha(void);\nvoid alpha(void);\n");
    const forwardStruct = parseSource("c", "struct Box;\nstruct Box { int x; };\n");
    const called = parseSource("c", "int alpha(void) { return missing(); }\n");
    if (!clean || !duplicated || !prototype || !repeatedPrototype || !forwardStruct || !called) {
      throw new Error("parser unavailable");
    }
    expect(duplicated.hasErrors).toBe(false);
    expect(duplicated.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(true);
    expect(prototype.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(false);
    expect(repeatedPrototype.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(false);
    expect(forwardStruct.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(false);
    expect(called.symbolIssues.some((issue) => issue.code === "undeclared")).toBe(false);
    expect(verifyParsed("file.c", duplicated, clean, clean).hazardous).toBe(true);
  });

  it("flags a repeated Kotlin function and ignores an undeclared call", () => {
    const clean = parseSource("kotlin", "fun alpha(): Int = 1\n");
    const duplicated = parseSource(
      "kotlin",
      "class Box {\n  fun left(): Int = 1\n  fun left(): Int = 2\n}\n",
    );
    const differentType = parseSource(
      "kotlin",
      "class Box {\n  fun left(): Int = 1\n}\nclass Bag {\n  fun left(): Int = 2\n}\n",
    );
    const called = parseSource("kotlin", "class Box {\n  fun left(): Int = missing()\n}\n");
    if (!clean || !duplicated || !differentType || !called) throw new Error("parser unavailable");
    expect(duplicated.hasErrors).toBe(false);
    expect(duplicated.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(true);
    expect(differentType.symbolIssues.some((issue) => issue.code === "duplicate")).toBe(false);
    expect(called.symbolIssues.some((issue) => issue.code === "undeclared")).toBe(false);
    expect(verifyParsed("Box.kt", duplicated, clean, clean).hazardous).toBe(true);
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
