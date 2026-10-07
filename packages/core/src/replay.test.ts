import { describe, expect, it } from "vitest";
import { replayConflicts } from "./replay.js";

describe("replayConflicts", () => {
  it("records a fixed score when both sides match the committed file", async () => {
    const report = await replayConflicts(
      [
        {
          repository: "sample",
          path: "file.ts",
          conflicted: "keep\n<<<<<<< current\nsame\n=======\nsame\n>>>>>>> incoming\n",
          base: null,
          current: null,
          incoming: null,
          humanResult: "keep\nsame\n",
        },
      ],
      { structural: false },
    );
    expect(report.predicted).toBe(1);
    expect(report.unresolved).toBe(0);
    expect(report.rows).toEqual([
      {
        repository: "sample",
        confidence: 0.8,
        correct: true,
        confidenceSource: "fixed-proposal",
      },
    ]);
    expect(Object.keys(report)).not.toContain("ece");
  });

  it("marks a matching recommendation wrong when the committed file differs", async () => {
    const report = await replayConflicts(
      [
        {
          repository: "sample",
          path: "file.ts",
          conflicted: "<<<<<<< current\nsame\n=======\nsame\n>>>>>>> incoming\n",
          base: null,
          current: null,
          incoming: null,
          humanResult: "other\n",
        },
      ],
      { structural: false },
    );
    expect(report.rows[0]?.correct).toBe(false);
    expect(report.rows[0]?.confidenceSource).toBe("fixed-proposal");
  });

  it("omits a file when the sides disagree and no recommendation exists", async () => {
    const report = await replayConflicts(
      [
        {
          repository: "sample",
          path: "file.ts",
          conflicted: "<<<<<<< current\nleft\n=======\nright\n>>>>>>> incoming\n",
          base: null,
          current: null,
          incoming: null,
          humanResult: "left\n",
        },
      ],
      { structural: false },
    );
    expect(report.rows).toEqual([]);
    expect(report.unresolved).toBe(1);
    expect(report.predicted).toBe(0);
  });

  it("uses the stored merge base when the markers have no base section", async () => {
    const report = await replayConflicts(
      [
        {
          repository: "sample",
          path: "file.ts",
          conflicted: "keep\n<<<<<<< current\nkeep-line\n=======\nchanged\n>>>>>>> incoming\n",
          base: "keep\nkeep-line\n",
          current: null,
          incoming: null,
          humanResult: "keep\nchanged\n",
        },
      ],
      { structural: false },
    );
    expect(report.rows).toEqual([
      {
        repository: "sample",
        confidence: 0.8,
        correct: true,
        confidenceSource: "fixed-proposal",
      },
    ]);
  });

  it("keeps a line prediction when the structural parser fails to load", async () => {
    const report = await replayConflicts(
      [
        {
          repository: "sample",
          path: "file.ts",
          conflicted: "<<<<<<< current\nsame\n=======\nsame\n>>>>>>> incoming\n",
          base: null,
          current: null,
          incoming: null,
          humanResult: "same\n",
        },
      ],
      {
        loadStructural: () => Promise.reject(new Error("parser missing")),
      },
    );
    expect(report.predicted).toBe(1);
    expect(report.rows[0]?.correct).toBe(true);
  });

  it("merges the stored parent files when a hunk is only part of a program", async () => {
    const base =
      "export function score(value: number) {\n  const total = value + 1;\n  const extra = value + 2;\n  return total + extra;\n}\n";
    const current =
      "export function score(value: number) {\n  const total = value + 10;\n  const extra = value + 2;\n  return total + extra;\n}\n";
    const incoming =
      "export function score(value: number) {\n  const total = value + 1;\n  const extra = value + 20;\n  return total + extra;\n}\n";
    const humanResult =
      "export function score(value: number) {\n  const total = value + 10;\n  const extra = value + 20;\n  return total + extra;\n}\n";
    const conflicted =
      "prefix\n<<<<<<< current\n    return value + 10;\n  }\n=======\n    return value + 20;\n  }\n>>>>>>> incoming\nsuffix\n";
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "file.ts",
        conflicted,
        base,
        current,
        incoming,
        humanResult,
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.99,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a JSON whole-file merge in the high band", async () => {
    const base = '{\n  "shared": 1\n}\n';
    const current = '{\n  "shared": 1,\n  "a": 1\n}\n';
    const incoming = '{\n  "shared": 1,\n  "b": 2\n}\n';
    const humanResult = '{\n  "shared": 1,\n  "a": 1,\n  "b": 2\n}\n';
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "data.json",
        conflicted:
          'prefix\n<<<<<<< current\n  "a": 1,\n=======\n  "b": 2,\n>>>>>>> incoming\nsuffix\n',
        base,
        current,
        incoming,
        humanResult,
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a YAML whole-file merge in the high band", async () => {
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "data.yaml",
        conflicted:
          "prefix\n<<<<<<< current\n  name: [\n=======\n  age: [\n>>>>>>> incoming\nsuffix\n",
        base: "shared: 1\n",
        current: "shared: 1\na: 1\n",
        incoming: "shared: 1\nb: 2\n",
        humanResult: "shared: 1\na: 1\nb: 2\n",
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a Python whole-file merge in the high band", async () => {
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "mod.py",
        conflicted:
          "prefix\n<<<<<<< current\n    return (\n=======\n    yield (\n>>>>>>> incoming\nsuffix\n",
        base: "def alpha():\n    return 1\n\ndef beta():\n    return 1\n",
        current: "def alpha():\n    return 2\n\ndef beta():\n    return 1\n",
        incoming: "def alpha():\n    return 1\n\ndef beta():\n    return 3\n",
        humanResult: "def alpha():\n    return 2\n\ndef beta():\n    return 3\n",
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a Go whole-file merge in the high band", async () => {
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "mod.go",
        conflicted:
          "prefix\n<<<<<<< current\n\treturn (\n=======\n\treturn [\n>>>>>>> incoming\nsuffix\n",
        base: "package p\n\nfunc Alpha() int {\n\treturn 1\n}\n\nfunc Beta() int {\n\treturn 1\n}\n",
        current:
          "package p\n\nfunc Alpha() int {\n\treturn 2\n}\n\nfunc Beta() int {\n\treturn 1\n}\n",
        incoming:
          "package p\n\nfunc Alpha() int {\n\treturn 1\n}\n\nfunc Beta() int {\n\treturn 3\n}\n",
        humanResult:
          "package p\n\nfunc Alpha() int {\n\treturn 2\n}\n\nfunc Beta() int {\n\treturn 3\n}\n",
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a C# whole-file merge in the high band", async () => {
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "Box.cs",
        conflicted:
          "prefix\n<<<<<<< current\n    return (\n=======\n    return [\n>>>>>>> incoming\nsuffix\n",
        base: "class Box {\n  int Left() { return 1; }\n  int Right() { return 1; }\n}\n",
        current: "class Box {\n  int Left() { return 2; }\n  int Right() { return 1; }\n}\n",
        incoming: "class Box {\n  int Left() { return 1; }\n  int Right() { return 3; }\n}\n",
        humanResult: "class Box {\n  int Left() { return 2; }\n  int Right() { return 3; }\n}\n",
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a Rust whole-file merge in the high band", async () => {
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "lib.rs",
        conflicted:
          "prefix\n<<<<<<< current\n    return (\n=======\n    return [\n>>>>>>> incoming\nsuffix\n",
        base: "fn alpha() -> i32 { 1 }\nfn beta() -> i32 { 1 }\n",
        current: "fn alpha() -> i32 { 2 }\nfn beta() -> i32 { 1 }\n",
        incoming: "fn alpha() -> i32 { 1 }\nfn beta() -> i32 { 3 }\n",
        humanResult: "fn alpha() -> i32 { 2 }\nfn beta() -> i32 { 3 }\n",
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a PHP whole-file merge in the high band", async () => {
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "file.php",
        conflicted:
          "prefix\n<<<<<<< current\n    return (\n=======\n    return [\n>>>>>>> incoming\nsuffix\n",
        base: "<?php\nfunction alpha() { return 1; }\nfunction beta() { return 1; }\n",
        current: "<?php\nfunction alpha() { return 2; }\nfunction beta() { return 1; }\n",
        incoming: "<?php\nfunction alpha() { return 1; }\nfunction beta() { return 3; }\n",
        humanResult: "<?php\nfunction alpha() { return 2; }\nfunction beta() { return 3; }\n",
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a Ruby whole-file merge in the high band", async () => {
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "file.rb",
        conflicted:
          "prefix\n<<<<<<< current\n    return (\n=======\n    return [\n>>>>>>> incoming\nsuffix\n",
        base: "def alpha\n  1\nend\ndef beta\n  1\nend\n",
        current: "def alpha\n  2\nend\ndef beta\n  1\nend\n",
        incoming: "def alpha\n  1\nend\ndef beta\n  3\nend\n",
        humanResult: "def alpha\n  2\nend\ndef beta\n  3\nend\n",
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a Swift whole-file merge in the high band", async () => {
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "file.swift",
        conflicted:
          "prefix\n<<<<<<< current\n    return (\n=======\n    return [\n>>>>>>> incoming\nsuffix\n",
        base: "func alpha() -> Int { return 1 }\nfunc beta() -> Int { return 1 }\n",
        current: "func alpha() -> Int { return 2 }\nfunc beta() -> Int { return 1 }\n",
        incoming: "func alpha() -> Int { return 1 }\nfunc beta() -> Int { return 3 }\n",
        humanResult: "func alpha() -> Int { return 2 }\nfunc beta() -> Int { return 3 }\n",
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a SQL whole-file merge in the high band", async () => {
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "file.sql",
        conflicted:
          "prefix\n<<<<<<< current\n    return (\n=======\n    return [\n>>>>>>> incoming\nsuffix\n",
        base: "CREATE TABLE alpha (id INT);\nCREATE TABLE beta (id INT);\n",
        current: "CREATE TABLE alpha (id TEXT);\nCREATE TABLE beta (id INT);\n",
        incoming: "CREATE TABLE alpha (id INT);\nCREATE TABLE beta (id TEXT);\n",
        humanResult: "CREATE TABLE alpha (id TEXT);\nCREATE TABLE beta (id TEXT);\n",
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a TOML whole-file merge in the high band", async () => {
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "file.toml",
        conflicted:
          "prefix\n<<<<<<< current\n    return (\n=======\n    return [\n>>>>>>> incoming\nsuffix\n",
        base: "alpha = 1\nbeta = 1\n",
        current: "alpha = 2\nbeta = 1\n",
        incoming: "alpha = 1\nbeta = 3\n",
        humanResult: "alpha = 2\nbeta = 3\n",
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a C++ whole-file merge in the high band", async () => {
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "file.cpp",
        conflicted:
          "prefix\n<<<<<<< current\n    return (\n=======\n    return [\n>>>>>>> incoming\nsuffix\n",
        base: "int alpha() { return 1; }\nint beta() { return 1; }\n",
        current: "int alpha() { return 2; }\nint beta() { return 1; }\n",
        incoming: "int alpha() { return 1; }\nint beta() { return 3; }\n",
        humanResult: "int alpha() { return 2; }\nint beta() { return 3; }\n",
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a C whole-file merge in the high band", async () => {
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "file.c",
        conflicted:
          "prefix\n<<<<<<< current\n    return (\n=======\n    return [\n>>>>>>> incoming\nsuffix\n",
        base: "int alpha(void) { return 1; }\nint beta(void) { return 1; }\n",
        current: "int alpha(void) { return 2; }\nint beta(void) { return 1; }\n",
        incoming: "int alpha(void) { return 1; }\nint beta(void) { return 3; }\n",
        humanResult: "int alpha(void) { return 2; }\nint beta(void) { return 3; }\n",
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a Kotlin whole-file merge in the high band", async () => {
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "Box.kt",
        conflicted:
          "prefix\n<<<<<<< current\n    return (\n=======\n    return [\n>>>>>>> incoming\nsuffix\n",
        base: "fun alpha(): Int = 1\n\nfun beta(): Int = 1\n",
        current: "fun alpha(): Int = 2\n\nfun beta(): Int = 1\n",
        incoming: "fun alpha(): Int = 1\n\nfun beta(): Int = 3\n",
        humanResult: "fun alpha(): Int = 2\n\nfun beta(): Int = 3\n",
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("keeps a Java whole-file merge in the high band", async () => {
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "Box.java",
        conflicted:
          "prefix\n<<<<<<< current\n    return (\n=======\n    return [\n>>>>>>> incoming\nsuffix\n",
        base: "class Box {\n  int left() { return 1; }\n  int right() { return 1; }\n}\n",
        current: "class Box {\n  int left() { return 2; }\n  int right() { return 1; }\n}\n",
        incoming: "class Box {\n  int left() { return 1; }\n  int right() { return 3; }\n}\n",
        humanResult: "class Box {\n  int left() { return 2; }\n  int right() { return 3; }\n}\n",
      },
    ]);
    expect(report.predicted).toBe(1);
    expect(report.rows[0]).toEqual({
      repository: "sample",
      confidence: 0.95,
      correct: true,
      confidenceSource: "fixed-proposal",
    });
  });

  it("leaves a fragment unresolved when the parent files were not stored", async () => {
    const conflicted =
      "prefix\n<<<<<<< current\n    return value + 10;\n  }\n=======\n    return value + 20;\n  }\n>>>>>>> incoming\nsuffix\n";
    const report = await replayConflicts([
      {
        repository: "sample",
        path: "file.ts",
        conflicted,
        base: "export function score(value: number) {\n  const total = value + 1;\n  const extra = value + 2;\n  return total + extra;\n}\n",
        current: null,
        incoming: null,
        humanResult: "export function score(value: number) {\n  return 0;\n}\n",
      },
    ]);
    expect(report.rows).toEqual([]);
    expect(report.unresolved).toBe(1);
  });

  it("returns an empty report for no conflicts", async () => {
    const report = await replayConflicts([], { structural: false });
    expect(report).toEqual({ rows: [], predicted: 0, unresolved: 0, unparsed: 0 });
  });
});
