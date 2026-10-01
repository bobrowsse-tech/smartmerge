/**
 * Logistic scoring model from the engine spec.
 * Coefficients exist only after a fit on labeled examples. Nothing in this module invents them,
 * and proposal confidence stays on the existing fixed values until a caller loads a fitted model.
 */
import type { CheckKind, CheckStatus, ConfidenceBand, StrategyId } from "@smartmerge/protocol";

/** L2 penalty on every coefficient except the intercept. Keeps a separable fit finite. */
export const SCORING_L2 = 0.01;

/** Newton steps for the fit. Fixed so the same examples always yield the same coefficients. */
const FIT_STEPS = 25;

/** Change classes from the engine spec. The pair of the two sides is one model feature. */
export const CHANGE_CLASSES = [
  "rename",
  "formatting",
  "add",
  "delete",
  "move",
  "logic",
  "dependency-bump",
  "comment",
] as const;

/** One side's change class. */
export type ChangeClass = (typeof CHANGE_CLASSES)[number];

const CHECK_LAYERS = ["syntax", "symbols", "types", "lint"] as const;
const CHECK_STATUSES = ["pass", "fail", "unknown"] as const;

/**
 * Strategy ids in protocol order.
 * A new strategy id fails this assignment until it is added here, so the feature vector cannot drift.
 */
function strategies<const T extends readonly StrategyId[]>(
  list: [Exclude<StrategyId, T[number]>] extends [never] ? T : never,
): T {
  return list;
}

const STRATEGIES = strategies([
  "identical",
  "one-side-unchanged",
  "whitespace-format",
  "structural-3way",
  "rename-aware",
  "list-union",
  "lockfile-regenerate",
  "llm-assisted",
  "manual-current",
  "manual-incoming",
  "manual-both-current-first",
  "manual-both-incoming-first",
]);

/** Feature names in coefficient order. The intercept is stored separately and is not in this list. */
export const FEATURE_NAMES: readonly string[] = featureNames();

const FEATURE_INDEX = new Map(FEATURE_NAMES.map((name, index) => [name, index]));

/** Inputs to the logistic model, plus the hard caps that are not regression features. */
export interface ScoreFeatures {
  strategy: StrategyId;
  checks: readonly ScoreCheck[];
  currentClass: ChangeClass;
  incomingClass: ChangeClass;
  /** Lines inside the conflict region. Non-negative. */
  conflictLines: number;
  /** Hunks in the file. Non-negative. */
  hunkCount: number;
  sameAstNodeType: boolean;
  testCoverageHint: boolean;
  /** Share of model samples that agreed, from 0 to 1. Zero when no model was used. */
  llmAgreement: number;
  /** Hours between the two sides. Non-negative. */
  recencyDeltaHours: number;
  /** False caps confidence at 0.70. This is not a regression feature. */
  languageSupported: boolean;
}

/** One verification layer as the model sees it. */
export interface ScoreCheck {
  kind: CheckKind;
  status: CheckStatus;
}

/** A labeled example. `correct` means the candidate matched the human result. */
export interface TrainingExample {
  features: ScoreFeatures;
  correct: boolean;
}

/** Platt scaling fit on validation logits. Absent until a validation file is supplied. */
export interface PlattScale {
  a: number;
  b: number;
}

/**
 * Versioned coefficient file.
 * `platt` is null when no validation examples were supplied. This object never carries an error score.
 */
export interface ScoringModel {
  version: 1;
  lambda: number;
  featureNames: readonly string[];
  intercept: number;
  coefficients: readonly number[];
  platt: PlattScale | null;
}

/** A probability after caps, and the band a person would see. */
export interface ScoredConfidence {
  confidence: number;
  band: ConfidenceBand;
  /** True when a spec cap lowered the model probability. */
  capped: boolean;
}

/**
 * Fit logistic regression on train examples.
 * An empty train set throws. Platt scaling is fit only when validation has at least one example.
 */
export function fitScoringModel(input: {
  train: readonly TrainingExample[];
  validation?: readonly TrainingExample[];
}): ScoringModel {
  if (input.train.length === 0) {
    throw new Error("Scoring model needs at least one labeled example.");
  }
  const rows = input.train.map((example) => designRow(example.features));
  const labels = input.train.map((example) => (example.correct ? 1 : 0));
  const weights = fitLogistic(rows, labels, SCORING_L2);
  const intercept = weights[0] ?? 0;
  const coefficients = weights.slice(1);
  const validation = input.validation ?? [];
  const platt = validation.length === 0 ? null : fitPlatt(validation, weights);
  return {
    version: 1,
    lambda: SCORING_L2,
    featureNames: FEATURE_NAMES,
    intercept,
    coefficients,
    platt,
  };
}

/**
 * Score one feature row with a fitted model.
 * The probability is capped, then the band is assigned. Certain requires every layer to pass.
 */
export function scoreFeatures(features: ScoreFeatures, model: ScoringModel): ScoredConfidence {
  assertCurrentModel(model);
  const row = designRow(features);
  const logit = model.intercept + dot(model.coefficients, row);
  const platt = model.platt;
  const probability = platt === null ? sigmoid(logit) : sigmoid(platt.a * logit + platt.b);
  const cap = confidenceCap(features);
  const confidence = Math.min(probability, cap);
  return {
    confidence,
    band: candidateBand(confidence, features.checks),
    capped: probability > cap,
  };
}

/**
 * Lowest cap that applies to these features.
 * Unknown syntax or symbols cap at 0.80. An unsupported language caps at 0.70.
 * A model-only candidate caps at 0.85 unless syntax and symbols both pass.
 */
export function confidenceCap(features: ScoreFeatures): number {
  assertFeatures(features);
  let cap = 1;
  if (!features.languageSupported) cap = Math.min(cap, 0.7);
  const syntax = layerStatus(features.checks, "syntax");
  const symbols = layerStatus(features.checks, "symbols");
  if (syntax === "unknown" || symbols === "unknown") cap = Math.min(cap, 0.8);
  if (features.strategy === "llm-assisted" && !(syntax === "pass" && symbols === "pass")) {
    cap = Math.min(cap, 0.85);
  }
  return cap;
}

/**
 * Band for a capped probability.
 * The numeric cuts match the engine spec. Certain also requires syntax, symbols, types, and lint to pass,
 * so an unrun type or lint check cannot become auto-apply eligible.
 */
export function candidateBand(confidence: number, checks: readonly ScoreCheck[]): ConfidenceBand {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("Confidence must be a number from 0 to 1.");
  }
  const passed =
    layerStatus(checks, "syntax") === "pass" &&
    layerStatus(checks, "symbols") === "pass" &&
    layerStatus(checks, "types") === "pass" &&
    layerStatus(checks, "lint") === "pass";
  if (passed && confidence >= 0.98) return "certain";
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

/**
 * Read a coefficient file.
 * The feature list must match this build. A mismatch throws instead of scoring the wrong columns.
 */
export function parseScoringModel(input: unknown): ScoringModel {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Scoring model must be an object.");
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = ["coefficients", "featureNames", "intercept", "lambda", "platt", "version"];
  if (keys.join() !== expected.join()) throw new Error("Scoring model has unexpected fields.");
  if (record.version !== 1) throw new Error("Scoring model version must be 1.");
  if (typeof record.lambda !== "number" || !Number.isFinite(record.lambda) || record.lambda <= 0) {
    throw new Error("Scoring model lambda must be a positive number.");
  }
  if (!Array.isArray(record.featureNames) || !sameNames(record.featureNames, FEATURE_NAMES)) {
    throw new Error("Scoring model features do not match this version.");
  }
  if (typeof record.intercept !== "number" || !Number.isFinite(record.intercept)) {
    throw new Error("Scoring model intercept must be a finite number.");
  }
  if (!Array.isArray(record.coefficients) || record.coefficients.length !== FEATURE_NAMES.length) {
    throw new Error("Scoring model coefficients do not match the feature list.");
  }
  const coefficients = record.coefficients.map((value) => finiteNumber(value, "coefficient"));
  return {
    version: 1,
    lambda: record.lambda,
    featureNames: FEATURE_NAMES,
    intercept: record.intercept,
    coefficients,
    platt: parsePlatt(record.platt),
  };
}

/**
 * Read labeled examples.
 * An empty array is valid here. Fitting it still fails, so an empty file cannot become a model.
 */
export function parseTrainingExamples(input: unknown): TrainingExample[] {
  if (!Array.isArray(input)) throw new Error("Training input must be an array of examples.");
  return input.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("Each training example must be an object.");
    }
    const record = item as Record<string, unknown>;
    if (typeof record.correct !== "boolean") throw new Error("correct must be a boolean.");
    const features = parseFeatures(record);
    return { features, correct: record.correct };
  });
}

function featureNames(): string[] {
  const names: string[] = [];
  for (const strategy of STRATEGIES) names.push(`strategy:${strategy}`);
  names.push("tier:llm");
  for (const layer of CHECK_LAYERS) {
    for (const status of CHECK_STATUSES) names.push(`${layer}:${status}`);
  }
  for (const current of CHANGE_CLASSES) {
    for (const incoming of CHANGE_CLASSES) names.push(`class:${current}*${incoming}`);
  }
  names.push(
    "logConflictLines",
    "logHunkCount",
    "sameAstNodeType",
    "testCoverageHint",
    "llmAgreement",
    "logRecencyHours",
  );
  return names;
}

function designRow(features: ScoreFeatures): number[] {
  assertFeatures(features);
  const row = new Array<number>(FEATURE_NAMES.length).fill(0);
  activate(row, `strategy:${features.strategy}`);
  if (features.strategy === "llm-assisted") activate(row, "tier:llm");
  for (const layer of CHECK_LAYERS)
    activate(row, `${layer}:${layerStatus(features.checks, layer)}`);
  activate(row, `class:${features.currentClass}*${features.incomingClass}`);
  setValue(row, "logConflictLines", Math.log1p(features.conflictLines));
  setValue(row, "logHunkCount", Math.log1p(features.hunkCount));
  setValue(row, "sameAstNodeType", features.sameAstNodeType ? 1 : 0);
  setValue(row, "testCoverageHint", features.testCoverageHint ? 1 : 0);
  setValue(row, "llmAgreement", features.llmAgreement);
  setValue(row, "logRecencyHours", Math.log1p(features.recencyDeltaHours));
  return row;
}

function fitLogistic(
  rows: readonly (readonly number[])[],
  labels: readonly number[],
  lambda: number,
): number[] {
  const width = FEATURE_NAMES.length + 1;
  let weights = new Array<number>(width).fill(0);
  for (let step = 0; step < FIT_STEPS; step += 1) {
    const matrix = Array.from({ length: width }, () => new Array<number>(width).fill(0));
    const rhs = new Array<number>(width).fill(0);
    for (let index = 0; index < rows.length; index += 1) {
      const row = withIntercept(rows[index] ?? []);
      const eta = dot(weights, row);
      const probability = sigmoid(eta);
      const weight = Math.max(probability * (1 - probability), 1e-6);
      const response = eta + ((labels[index] ?? 0) - probability) / weight;
      for (let column = 0; column < width; column += 1) {
        const columnValue = row[column] ?? 0;
        rhs[column] = (rhs[column] ?? 0) + weight * columnValue * response;
        const matrixRow = matrix[column];
        if (!matrixRow) continue;
        for (let other = 0; other < width; other += 1) {
          matrixRow[other] = (matrixRow[other] ?? 0) + weight * columnValue * (row[other] ?? 0);
        }
      }
    }
    const interceptRow = matrix[0];
    if (interceptRow) interceptRow[0] = (interceptRow[0] ?? 0) + 1e-8;
    for (let column = 1; column < width; column += 1) {
      const matrixRow = matrix[column];
      if (matrixRow) matrixRow[column] = (matrixRow[column] ?? 0) + lambda;
    }
    weights = solve(matrix, rhs);
  }
  return weights;
}

function fitPlatt(validation: readonly TrainingExample[], weights: readonly number[]): PlattScale {
  const rows = validation.map((example) => {
    const logit = dot(weights, withIntercept(designRow(example.features)));
    return [logit];
  });
  const labels = validation.map((example) => (example.correct ? 1 : 0));
  const fitted = fitTwo(rows, labels);
  return { a: fitted[0] ?? 0, b: fitted[1] ?? 0 };
}

/** Two-parameter logistic fit used for Platt scaling. Index 0 is the slope and index 1 is the intercept. */
function fitTwo(rows: readonly (readonly number[])[], labels: readonly number[]): number[] {
  let weights = [0, 0];
  for (let step = 0; step < FIT_STEPS; step += 1) {
    const matrix = [
      [0, 0],
      [0, 0],
    ];
    const rhs = [0, 0];
    for (let index = 0; index < rows.length; index += 1) {
      const slope = rows[index]?.[0] ?? 0;
      const row = [slope, 1];
      const eta = (weights[0] ?? 0) * slope + (weights[1] ?? 0);
      const probability = sigmoid(eta);
      const weight = Math.max(probability * (1 - probability), 1e-6);
      const response = eta + ((labels[index] ?? 0) - probability) / weight;
      for (let column = 0; column < 2; column += 1) {
        rhs[column] = (rhs[column] ?? 0) + weight * (row[column] ?? 0) * response;
        const matrixRow = matrix[column];
        if (!matrixRow) continue;
        for (let other = 0; other < 2; other += 1) {
          matrixRow[other] =
            (matrixRow[other] ?? 0) + weight * (row[column] ?? 0) * (row[other] ?? 0);
        }
      }
    }
    const penalty = matrix[0];
    if (penalty) penalty[0] = (penalty[0] ?? 0) + SCORING_L2;
    const intercept = matrix[1];
    if (intercept) intercept[1] = (intercept[1] ?? 0) + 1e-8;
    weights = solve(matrix, rhs);
  }
  return weights;
}

function solve(matrix: readonly (readonly number[])[], rhs: readonly number[]): number[] {
  const width = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index] ?? 0]);
  for (let column = 0; column < width; column += 1) {
    let pivot = column;
    let best = Math.abs(augmented[column]?.[column] ?? 0);
    for (let row = column + 1; row < width; row += 1) {
      const value = Math.abs(augmented[row]?.[column] ?? 0);
      if (value > best) {
        best = value;
        pivot = row;
      }
    }
    if (best < 1e-12) throw new Error("Scoring model fit could not be solved.");
    if (pivot !== column) {
      const current = augmented[column] ?? [];
      augmented[column] = augmented[pivot] ?? [];
      augmented[pivot] = current;
    }
    const diagonal = augmented[column]?.[column] ?? 0;
    for (let row = column + 1; row < width; row += 1) {
      const factor = (augmented[row]?.[column] ?? 0) / diagonal;
      const target = augmented[row];
      if (!target) continue;
      for (let other = column; other <= width; other += 1) {
        target[other] = (target[other] ?? 0) - factor * (augmented[column]?.[other] ?? 0);
      }
    }
  }
  const solution = new Array<number>(width).fill(0);
  for (let row = width - 1; row >= 0; row -= 1) {
    let sum = augmented[row]?.[width] ?? 0;
    for (let column = row + 1; column < width; column += 1) {
      sum -= (augmented[row]?.[column] ?? 0) * (solution[column] ?? 0);
    }
    const diagonal = augmented[row]?.[row] ?? 0;
    if (Math.abs(diagonal) < 1e-12) throw new Error("Scoring model fit could not be solved.");
    solution[row] = sum / diagonal;
  }
  return solution;
}

function parseFeatures(record: Record<string, unknown>): ScoreFeatures {
  const features: ScoreFeatures = {
    strategy: parseStrategy(record.strategy),
    checks: parseChecks(record.checks),
    currentClass: parseChangeClass(record.currentClass),
    incomingClass: parseChangeClass(record.incomingClass),
    conflictLines: nonNegative(record.conflictLines, "conflictLines"),
    hunkCount: nonNegative(record.hunkCount, "hunkCount"),
    sameAstNodeType: booleanField(record.sameAstNodeType, "sameAstNodeType"),
    testCoverageHint: booleanField(record.testCoverageHint, "testCoverageHint"),
    llmAgreement: unitInterval(record.llmAgreement, "llmAgreement"),
    recencyDeltaHours: nonNegative(record.recencyDeltaHours, "recencyDeltaHours"),
    languageSupported: booleanField(record.languageSupported, "languageSupported"),
  };
  assertFeatures(features);
  return features;
}

function parsePlatt(input: unknown): PlattScale | null {
  if (input === null) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Platt scaling must be null or an object.");
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== "a,b")
    throw new Error("Platt scaling must contain a and b.");
  return { a: finiteNumber(record.a, "Platt a"), b: finiteNumber(record.b, "Platt b") };
}

function assertCurrentModel(model: ScoringModel): void {
  if (!sameNames(model.featureNames, FEATURE_NAMES)) {
    throw new Error("Scoring model features do not match this version.");
  }
  if (model.coefficients.length !== FEATURE_NAMES.length) {
    throw new Error("Scoring model coefficients do not match the feature list.");
  }
}

function assertFeatures(features: ScoreFeatures): void {
  if (!STRATEGIES.includes(features.strategy)) throw new Error("Unknown strategy.");
  if (!isChangeClass(features.currentClass) || !isChangeClass(features.incomingClass)) {
    throw new Error("Unknown change class.");
  }
  if (!Number.isFinite(features.conflictLines) || features.conflictLines < 0) {
    throw new Error("conflictLines must be a non-negative number.");
  }
  if (!Number.isFinite(features.hunkCount) || features.hunkCount < 0) {
    throw new Error("hunkCount must be a non-negative number.");
  }
  if (
    !Number.isFinite(features.llmAgreement) ||
    features.llmAgreement < 0 ||
    features.llmAgreement > 1
  ) {
    throw new Error("llmAgreement must be a number from 0 to 1.");
  }
  if (!Number.isFinite(features.recencyDeltaHours) || features.recencyDeltaHours < 0) {
    throw new Error("recencyDeltaHours must be a non-negative number.");
  }
  const seen = new Set<CheckKind>();
  for (const check of features.checks) {
    if (seen.has(check.kind)) throw new Error(`More than one ${check.kind} check.`);
    seen.add(check.kind);
    if (!CHECK_STATUSES.includes(check.status) && check.kind !== "tests-hint") {
      throw new Error("Check status must be pass, fail, or unknown.");
    }
  }
}

function layerStatus(
  checks: readonly ScoreCheck[],
  kind: (typeof CHECK_LAYERS)[number],
): CheckStatus {
  const found = checks.filter((check) => check.kind === kind);
  if (found.length > 1) throw new Error(`More than one ${kind} check.`);
  return found[0]?.status ?? "unknown";
}

function activate(row: number[], name: string): void {
  setValue(row, name, 1);
}

function setValue(row: number[], name: string, value: number): void {
  const index = FEATURE_INDEX.get(name);
  if (index === undefined) throw new Error(`Unknown scoring feature ${name}.`);
  row[index] = value;
}

function withIntercept(row: readonly number[]): number[] {
  return [1, ...row];
}

function dot(left: readonly number[], right: readonly number[]): number {
  let sum = 0;
  const width = Math.max(left.length, right.length);
  for (let index = 0; index < width; index += 1) sum += (left[index] ?? 0) * (right[index] ?? 0);
  return sum;
}

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function sameNames(left: readonly unknown[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function parseStrategy(input: unknown): StrategyId {
  if (typeof input !== "string" || !STRATEGIES.includes(input as StrategyId)) {
    throw new Error("Unknown strategy.");
  }
  return input as StrategyId;
}

function parseChangeClass(input: unknown): ChangeClass {
  if (!isChangeClass(input)) throw new Error("Unknown change class.");
  return input;
}

function isChangeClass(input: unknown): input is ChangeClass {
  return typeof input === "string" && (CHANGE_CLASSES as readonly string[]).includes(input);
}

function parseChecks(input: unknown): ScoreCheck[] {
  if (!Array.isArray(input)) throw new Error("checks must be an array.");
  return input.map((item) => {
    if (typeof item !== "object" || item === null) throw new Error("Each check must be an object.");
    const record = item as Record<string, unknown>;
    if (!isCheckKind(record.kind)) throw new Error("Unknown check kind.");
    if (!isCheckStatus(record.status))
      throw new Error("Check status must be pass, fail, or unknown.");
    return { kind: record.kind, status: record.status };
  });
}

function isCheckKind(input: unknown): input is CheckKind {
  return (
    input === "syntax" ||
    input === "symbols" ||
    input === "types" ||
    input === "lint" ||
    input === "tests-hint"
  );
}

function isCheckStatus(input: unknown): input is CheckStatus {
  return input === "pass" || input === "fail" || input === "unknown";
}

function booleanField(input: unknown, name: string): boolean {
  if (typeof input !== "boolean") throw new Error(`${name} must be a boolean.`);
  return input;
}

function nonNegative(input: unknown, name: string): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return input;
}

function unitInterval(input: unknown, name: string): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0 || input > 1) {
    throw new Error(`${name} must be a number from 0 to 1.`);
  }
  return input;
}

function finiteNumber(input: unknown, name: string): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return input;
}
