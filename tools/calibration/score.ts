/**
 * Expected calibration error for confidence scores.
 * An empty held-out set is not a measurement and does not pass the gate in docs/08.
 */

/** The held-out gate from the engine spec: expected calibration error under 0.03. */
export const ECE_LIMIT = 0.03;

/** Equal-width bins on confidence from 0 to 1. */
export const CALIBRATION_BINS = 10;

/** Canonical confidence bands from the engine spec. */
export const CONFIDENCE_BANDS = ["certain", "high", "medium", "low"] as const;

/** One canonical confidence band. */
export type ConfidenceBandName = (typeof CONFIDENCE_BANDS)[number];

/** One held-out prediction. `confidence` is the probability the resolution was right. */
export interface CalibrationOutcome {
  confidence: number;
  correct: boolean;
}

/** Calibration of one band. An empty band is not a measurement and does not fail the gate. */
export interface BandCalibration {
  band: ConfidenceBandName;
  outcomes: number;
  ece: number | null;
  passes: boolean;
}

/** A calibration report. `ece` stays null until held-out outcomes exist. */
export type CalibrationReport =
  | { measured: false; outcomes: 0; ece: null; passes: false; bands: [] }
  | { measured: true; outcomes: number; ece: number; passes: boolean; bands: BandCalibration[] };

/**
 * Expected calibration error.
 * Each outcome falls in an equal-width confidence bin. The error is the
 * weighted mean of the absolute gap between each bin's accuracy and its mean confidence.
 */
export function expectedCalibrationError(
  outcomes: readonly CalibrationOutcome[],
  bins = CALIBRATION_BINS,
): number {
  if (outcomes.length === 0) throw new Error("Calibration needs at least one outcome.");
  if (!Number.isInteger(bins) || bins < 1) throw new Error("Bin count must be a positive integer.");
  const counts = new Array<number>(bins).fill(0);
  const confidenceSums = new Array<number>(bins).fill(0);
  const correctCounts = new Array<number>(bins).fill(0);
  for (const outcome of outcomes) {
    assertOutcome(outcome);
    const index = Math.min(bins - 1, Math.floor(outcome.confidence * bins));
    counts[index] = (counts[index] ?? 0) + 1;
    confidenceSums[index] = (confidenceSums[index] ?? 0) + outcome.confidence;
    if (outcome.correct) correctCounts[index] = (correctCounts[index] ?? 0) + 1;
  }
  let error = 0;
  for (let index = 0; index < bins; index += 1) {
    const count = counts[index] ?? 0;
    if (count === 0) continue;
    const meanConfidence = (confidenceSums[index] ?? 0) / count;
    const accuracy = (correctCounts[index] ?? 0) / count;
    error += (count / outcomes.length) * Math.abs(accuracy - meanConfidence);
  }
  return error;
}

/**
 * Map a confidence onto the canonical band.
 * `certain` is at least 0.98, `high` is at least 0.90, `medium` is at least 0.60, and the rest is `low`.
 */
export function confidenceBand(confidence: number): ConfidenceBandName {
  if (confidence >= 0.98) return "certain";
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

/**
 * Score held-out outcomes.
 * No outcomes means the gate is unmeasured. Every populated band must stay under 0.03.
 * A large calibrated band does not hide a failing one.
 */
export function scoreCalibration(input: unknown): CalibrationReport {
  const outcomes = parseOutcomes(input);
  if (outcomes.length === 0) {
    return { measured: false, outcomes: 0, ece: null, passes: false, bands: [] };
  }
  const bands = CONFIDENCE_BANDS.map((band) => {
    const group = outcomes.filter((item) => confidenceBand(item.confidence) === band);
    if (group.length === 0) return { band, outcomes: 0, ece: null, passes: true };
    const ece = expectedCalibrationError(group);
    return { band, outcomes: group.length, ece, passes: ece < ECE_LIMIT };
  });
  return {
    measured: true,
    outcomes: outcomes.length,
    ece: expectedCalibrationError(outcomes),
    passes: bands.every((band) => band.passes),
    bands,
  };
}

function parseOutcomes(input: unknown): CalibrationOutcome[] {
  if (!Array.isArray(input)) throw new Error("Calibration input must be an array of outcomes.");
  return input.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new Error("Each outcome must be an object.");
    }
    const record = item as Record<string, unknown>;
    const outcome = { confidence: record.confidence, correct: record.correct };
    assertOutcome(outcome);
    return outcome;
  });
}

function assertOutcome(outcome: {
  confidence: unknown;
  correct: unknown;
}): asserts outcome is CalibrationOutcome {
  if (typeof outcome.correct !== "boolean") throw new Error("correct must be a boolean.");
  if (
    typeof outcome.confidence !== "number" ||
    !Number.isFinite(outcome.confidence) ||
    outcome.confidence < 0 ||
    outcome.confidence > 1
  ) {
    throw new Error("Confidence must be a number from 0 to 1.");
  }
}
