/**
 * Score calibration only on repositories held out from training.
 * Train and validation rows never enter the error. An empty held-out split records no error.
 */
import { scoreCalibration, type BandCalibration } from "./score.js";

/** Share of repositories, in percent. 70 + 15 + 15. */
const TRAIN_PERCENT = 70;
const VALIDATION_PERCENT = 15;
const HELD_OUT_PERCENT = 15;

/** One labeled prediction tagged with its source repository. */
export interface RepositoryOutcome {
  repository: string;
  confidence: number;
  correct: boolean;
}

/** Which repositories were kept out of the scored set. */
export interface RepositorySplit {
  train: readonly string[];
  validation: readonly string[];
  heldOut: readonly string[];
}

/**
 * A held-out report.
 * `ece` stays null until at least one held-out repository has a row.
 */
export type HeldOutReport = {
  repositories: number;
  trainRows: number;
  validationRows: number;
  heldOutRows: number;
  split: RepositorySplit;
} & (
  | { measured: false; ece: null; passes: false; bands: [] }
  | { measured: true; ece: number; passes: boolean; bands: BandCalibration[] }
);

/**
 * Assign repositories to train, validation, and held-out.
 * Names are sorted first so the split does not depend on input order.
 * Counts use the 70/15/15 shares. A leftover repository goes to the share with the largest remainder.
 * A tie goes to held-out, then validation, then train. One repository stays in train.
 */
export function splitRepositories(names: readonly string[]): RepositorySplit {
  const unique = [...new Set(names)].sort();
  const quotas = repositoryQuotas(unique.length);
  return {
    train: unique.slice(0, quotas.train),
    validation: unique.slice(quotas.train, quotas.train + quotas.validation),
    heldOut: unique.slice(quotas.train + quotas.validation),
  };
}

/**
 * Score only the held-out repositories.
 * Rows from train and validation are counted and then ignored. No held-out rows means the gate is unmeasured.
 */
export function scoreHeldOut(input: unknown): HeldOutReport {
  const rows = parseRows(input);
  const split = splitRepositories(rows.map((row) => row.repository));
  const train = new Set(split.train);
  const validation = new Set(split.validation);
  const heldOut = new Set(split.heldOut);
  const heldOutRows = rows.filter((row) => heldOut.has(row.repository));
  const base = {
    repositories: split.train.length + split.validation.length + split.heldOut.length,
    trainRows: rows.filter((row) => train.has(row.repository)).length,
    validationRows: rows.filter((row) => validation.has(row.repository)).length,
    heldOutRows: heldOutRows.length,
    split,
  };
  if (heldOutRows.length === 0) {
    return { ...base, measured: false, ece: null, passes: false, bands: [] };
  }
  const scored = scoreCalibration(
    heldOutRows.map(({ confidence, correct }) => ({ confidence, correct })),
  );
  if (!scored.measured) return { ...base, measured: false, ece: null, passes: false, bands: [] };
  return {
    ...base,
    measured: true,
    ece: scored.ece,
    passes: scored.passes,
    bands: scored.bands,
  };
}

function repositoryQuotas(count: number): { train: number; validation: number; heldOut: number } {
  const parts = [
    { key: "train" as const, percent: TRAIN_PERCENT, tie: 2 },
    { key: "validation" as const, percent: VALIDATION_PERCENT, tie: 1 },
    { key: "heldOut" as const, percent: HELD_OUT_PERCENT, tie: 0 },
  ].map((part) => ({
    ...part,
    seats: Math.floor((count * part.percent) / 100),
    remainder: (count * part.percent) % 100,
  }));
  let leftover = count - parts.reduce((sum, part) => sum + part.seats, 0);
  const order = [...parts].sort(
    (left, right) => right.remainder - left.remainder || left.tie - right.tie,
  );
  for (const part of order) {
    if (leftover === 0) break;
    part.seats += 1;
    leftover -= 1;
  }
  return {
    train: parts.find((part) => part.key === "train")?.seats ?? 0,
    validation: parts.find((part) => part.key === "validation")?.seats ?? 0,
    heldOut: parts.find((part) => part.key === "heldOut")?.seats ?? 0,
  };
}

function parseRows(input: unknown): RepositoryOutcome[] {
  if (!Array.isArray(input)) throw new Error("Held-out input must be an array of rows.");
  return input.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("Each held-out row must be an object.");
    }
    const record = item as Record<string, unknown>;
    if (typeof record.repository !== "string" || record.repository.trim().length === 0) {
      throw new Error("repository must be a non-empty string.");
    }
    if (record.repository.length > 200)
      throw new Error("repository must be at most 200 characters.");
    if (typeof record.correct !== "boolean") throw new Error("correct must be a boolean.");
    if (
      typeof record.confidence !== "number" ||
      !Number.isFinite(record.confidence) ||
      record.confidence < 0 ||
      record.confidence > 1
    ) {
      throw new Error("Confidence must be a number from 0 to 1.");
    }
    return {
      repository: record.repository,
      confidence: record.confidence,
      correct: record.correct,
    };
  });
}
