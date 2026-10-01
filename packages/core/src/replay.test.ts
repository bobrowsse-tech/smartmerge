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

  it("returns an empty report for no conflicts", async () => {
    const report = await replayConflicts([], { structural: false });
    expect(report).toEqual({ rows: [], predicted: 0, unresolved: 0, unparsed: 0 });
  });
});
