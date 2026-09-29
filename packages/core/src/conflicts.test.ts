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
      current: "alpha",
      incoming: "beta",
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
    expect(hunks[0]?.current).toBe("alpha");
    expect(hunks[1]?.range.startLine).toBe(9);
    expect(hunks[1]?.incoming).toBe("two");
  });

  it("drops an unfinished marker block", () => {
    expect(parseConflictHunks("<<<<<<< HEAD\nalpha\n")).toEqual([]);
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
