import type { OperationContext } from "@smartmerge/protocol";
import { describe, expect, it } from "vitest";
import { parseConflictHunks, stubProposals, toConflictFile } from "./conflicts.js";

const operation: OperationContext = {
  operation: "merge",
  current: { label: "main", role: "ours", commitSha: "a" },
  incoming: { label: "incoming", role: "theirs", commitSha: "b" },
  mergeBaseSha: "c",
};

describe("parseConflictHunks", () => {
  it("reads a standard marker block", () => {
    const hunks = parseConflictHunks("<<<<<<< HEAD\nalpha\n=======\nbeta\n>>>>>>> incoming\n");
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      id: "hunk:1",
      range: { startLine: 1, endLine: 5 },
      base: "",
      baseFromMarker: false,
      ours: "alpha",
      theirs: "beta",
    });
  });

  it("reads a diff3 base section and a second hunk", () => {
    const text = [
      "<<<<<<< HEAD",
      "alpha",
      "||||||| base",
      "old",
      "=======",
      "beta",
      ">>>>>>> incoming",
      "middle",
      "<<<<<<< HEAD",
      "one",
      "=======",
      "two",
      ">>>>>>> incoming",
    ].join("\n");
    const hunks = parseConflictHunks(text);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.base).toBe("old");
    expect(hunks[0]?.baseFromMarker).toBe(true);
    expect(hunks[0]?.ours).toBe("alpha");
    expect(hunks[1]?.range.startLine).toBe(9);
    expect(hunks[1]?.theirs).toBe("two");
  });

  it("drops an unfinished marker block", () => {
    expect(parseConflictHunks("<<<<<<< HEAD\nalpha\n")).toEqual([]);
  });
});

describe("buildConflict", () => {
  it("labels the replayed commit as current during a rebase", () => {
    const file = toConflictFile(
      {
        path: "file.txt",
        text: "<<<<<<< HEAD\nonto\n=======\nreplayed\n>>>>>>> feature\n",
        binary: false,
        missing: false,
      },
      { ...operation, operation: "rebase" },
    );
    expect(file.hunks[0]?.current).toBe("replayed");
    expect(file.hunks[0]?.incoming).toBe("onto");
  });
});

describe("language ids", () => {
  it("maps C++ extensions and leaves a C header as C", () => {
    const source = {
      text: "<<<<<<< HEAD\nalpha\n=======\nbeta\n>>>>>>> incoming\n",
      binary: false,
      missing: false,
    };
    for (const path of ["file.cpp", "file.cc", "file.cxx", "file.hpp", "file.hh", "file.hxx"]) {
      expect(toConflictFile({ ...source, path }, operation).languageId).toBe("cpp");
    }
    expect(toConflictFile({ ...source, path: "file.h" }, operation).languageId).toBe("c");
    expect(toConflictFile({ ...source, path: "file.c" }, operation).languageId).toBe("c");
    expect(toConflictFile({ ...source, path: "file.php" }, operation).languageId).toBe("php");
    expect(toConflictFile({ ...source, path: "file.rb" }, operation).languageId).toBe("ruby");
    expect(toConflictFile({ ...source, path: "file.swift" }, operation).languageId).toBe("swift");
    expect(toConflictFile({ ...source, path: "file.sql" }, operation).languageId).toBe("sql");
    expect(toConflictFile({ ...source, path: "file.toml" }, operation).languageId).toBe("toml");
    expect(toConflictFile({ ...source, path: "file.xml" }, operation).languageId).toBe("xml");
    expect(toConflictFile({ ...source, path: "file.jsonc" }, operation).languageId).toBe("jsonc");
  });
});

describe("stubProposals", () => {
  it("offers both sides and recommends neither", () => {
    const file = toConflictFile(
      {
        path: "src/app.ts",
        text: "<<<<<<< HEAD\nalpha\n=======\nbeta\n>>>>>>> incoming\n",
        binary: false,
        missing: false,
      },
      operation,
    );
    expect(file.languageId).toBe("typescript");
    expect(file.kind).toBe("content");
    const proposals = stubProposals(file);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.recommended).toBeNull();
    expect(proposals[0]?.autoApplyEligible).toBe(false);
    expect(proposals[0]?.candidates.map((candidate) => candidate.strategy)).toEqual([
      "manual-current",
      "manual-incoming",
    ]);
  });
});
