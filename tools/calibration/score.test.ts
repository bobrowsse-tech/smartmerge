import { describe, expect, it } from "vitest";
import { expectedCalibrationError, scoreCalibration } from "./score.js";

describe("expected calibration error", () => {
  it("is zero when every bin's accuracy matches its confidence", () => {
    const outcomes = Array.from({ length: 10 }, () => ({ confidence: 1, correct: true }));
    expect(expectedCalibrationError(outcomes)).toBe(0);
    const report = scoreCalibration(outcomes);
    expect(report.measured).toBe(true);
    if (report.measured) expect(report.passes).toBe(true);
  });

  it("weights each bin by how many outcomes it holds", () => {
    const low = Array.from({ length: 5 }, () => ({ confidence: 0.1, correct: false }));
    const high = Array.from({ length: 5 }, () => ({ confidence: 0.9, correct: true }));
    expect(expectedCalibrationError([...low, ...high])).toBeCloseTo(0.1);
  });

  it("fails the gate at 0.03 and leaves an empty set unmeasured", () => {
    const over = Array.from({ length: 10 }, () => ({ confidence: 0.95, correct: false }));
    const failed = scoreCalibration(over);
    expect(failed.measured).toBe(true);
    if (failed.measured) {
      expect(failed.ece).toBeCloseTo(0.95);
      expect(failed.passes).toBe(false);
    }
    expect(scoreCalibration([])).toEqual({
      measured: false,
      outcomes: 0,
      ece: null,
      passes: false,
    });
  });

  it("rejects a confidence outside 0 to 1", () => {
    expect(() => expectedCalibrationError([{ confidence: 1.1, correct: true }])).toThrow(/0 to 1/);
    expect(() => scoreCalibration([{ confidence: 0.5 }])).toThrow(/boolean/);
  });
});
