import { describe, expect, it } from "vitest";
import { scoreHeldOut, splitRepositories } from "./heldout.js";

describe("held-out repository split", () => {
  it("keeps a single repository in train", () => {
    expect(splitRepositories(["only"])).toEqual({
      train: ["only"],
      validation: [],
      heldOut: [],
    });
  });

  it("uses the 70/15/15 shares and does not depend on input order", () => {
    const names = ["j", "i", "h", "g", "f", "e", "d", "c", "b", "a"];
    const split = splitRepositories(names);
    expect(split.train).toHaveLength(7);
    expect(split.validation).toHaveLength(1);
    expect(split.heldOut).toHaveLength(2);
    expect(splitRepositories([...names].reverse())).toEqual(split);
    const seen = new Set([...split.train, ...split.validation, ...split.heldOut]);
    expect(seen.size).toBe(10);
  });

  it("does not let a calibrated train set hide a failing held-out repository", () => {
    const split = splitRepositories(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    const rows = [
      ...split.train.flatMap((repository) =>
        Array.from({ length: 20 }, () => ({ repository, confidence: 1, correct: true })),
      ),
      ...split.validation.map((repository) => ({ repository, confidence: 0.5, correct: false })),
      ...split.heldOut.flatMap((repository) =>
        Array.from({ length: 10 }, () => ({ repository, confidence: 0.99, correct: false })),
      ),
    ];
    const report = scoreHeldOut(rows);
    expect(report.measured).toBe(true);
    expect(report.trainRows).toBe(split.train.length * 20);
    expect(report.validationRows).toBe(split.validation.length);
    expect(report.heldOutRows).toBe(split.heldOut.length * 10);
    if (report.measured) {
      expect(report.ece).toBeGreaterThan(0.03);
      expect(report.passes).toBe(false);
    }
  });

  it("ignores a failing train set when the held-out rows are calibrated", () => {
    const split = splitRepositories(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    const rows = [
      ...split.train.map((repository) => ({ repository, confidence: 0.99, correct: false })),
      ...split.validation.map((repository) => ({ repository, confidence: 0.99, correct: false })),
      ...split.heldOut.map((repository) => ({ repository, confidence: 1, correct: true })),
    ];
    const report = scoreHeldOut(rows);
    expect(report.measured).toBe(true);
    if (report.measured) expect(report.passes).toBe(true);
  });

  it("records no error when nothing is held out", () => {
    expect(scoreHeldOut([])).toMatchObject({
      measured: false,
      ece: null,
      passes: false,
      heldOutRows: 0,
    });
    const single = scoreHeldOut([{ repository: "only", confidence: 0.99, correct: false }]);
    expect(single.measured).toBe(false);
    expect(single.ece).toBeNull();
    expect(single.passes).toBe(false);
  });

  it("rejects a row without a repository", () => {
    expect(() => scoreHeldOut([{ confidence: 1, correct: true }])).toThrow(/repository/);
  });

  it("treats surrounding whitespace as the same repository", () => {
    const report = scoreHeldOut([
      { repository: " only ", confidence: 0.99, correct: false },
      { repository: "only", confidence: 1, correct: true },
    ]);
    expect(report.split.train).toEqual(["only"]);
    expect(report.repositories).toBe(1);
    expect(report.trainRows).toBe(2);
    expect(report.measured).toBe(false);
  });
});
