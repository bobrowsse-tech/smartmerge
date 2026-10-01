import { describe, expect, it } from "vitest";
import {
  CHANGE_CLASSES,
  FEATURE_NAMES,
  candidateBand,
  confidenceCap,
  fitScoringModel,
  parseScoringModel,
  parseTrainingExamples,
  scoreFeatures,
  type ScoreFeatures,
  type ScoringModel,
  type TrainingExample,
} from "./logistic.js";

const passed = [
  { kind: "syntax" as const, status: "pass" as const },
  { kind: "symbols" as const, status: "pass" as const },
  { kind: "types" as const, status: "pass" as const },
  { kind: "lint" as const, status: "pass" as const },
];

function features(overrides: Partial<ScoreFeatures> = {}): ScoreFeatures {
  return {
    strategy: "identical",
    checks: passed,
    currentClass: "logic",
    incomingClass: "logic",
    conflictLines: 4,
    hunkCount: 1,
    sameAstNodeType: false,
    testCoverageHint: false,
    llmAgreement: 0,
    recencyDeltaHours: 1,
    languageSupported: true,
    ...overrides,
  };
}

function example(strategy: ScoreFeatures["strategy"], correct: boolean): TrainingExample {
  return { features: features({ strategy }), correct };
}

function saturated(): ScoringModel {
  return {
    version: 1,
    lambda: 0.01,
    featureNames: FEATURE_NAMES,
    intercept: 8,
    coefficients: FEATURE_NAMES.map(() => 0),
    platt: null,
  };
}

describe("logistic scoring model", () => {
  it("keeps a fixed feature list that includes the strategy and the change-class pair", () => {
    expect(FEATURE_NAMES).toContain("strategy:identical");
    expect(FEATURE_NAMES).toContain("class:rename*add");
    expect(FEATURE_NAMES).toHaveLength(12 + 1 + 12 + CHANGE_CLASSES.length ** 2 + 6);
  });

  it("refuses to fit an empty train set", () => {
    expect(() => fitScoringModel({ train: [] })).toThrow(/labeled example/);
  });

  it("ranks a strategy that was always right above one that was always wrong", () => {
    const train = [
      ...Array.from({ length: 12 }, () => example("identical", true)),
      ...Array.from({ length: 12 }, () => example("manual-current", false)),
    ];
    const model = fitScoringModel({ train });
    expect(model.platt).toBeNull();
    const right = scoreFeatures(features({ strategy: "identical" }), model);
    const wrong = scoreFeatures(features({ strategy: "manual-current" }), model);
    expect(right.confidence).toBeGreaterThan(0.9);
    expect(wrong.confidence).toBeLessThan(0.1);
    expect(right.band).toBe("certain");
    expect(wrong.band).toBe("low");
  });

  it("pulls probabilities down when validation disagrees with the train fit", () => {
    const train = Array.from({ length: 16 }, () => example("identical", true));
    const validation = Array.from({ length: 16 }, () => example("identical", false));
    const raw = scoreFeatures(features(), fitScoringModel({ train }));
    const calibrated = scoreFeatures(features(), fitScoringModel({ train, validation }));
    expect(raw.confidence).toBeGreaterThan(0.9);
    expect(calibrated.confidence).toBeLessThan(0.5);
  });

  it("caps unknown syntax, an unsupported language, and an unverified model candidate", () => {
    const model = saturated();
    const unknownSyntax = scoreFeatures(
      features({ checks: [{ kind: "syntax", status: "unknown" }] }),
      model,
    );
    expect(unknownSyntax.confidence).toBeLessThanOrEqual(0.8);
    expect(unknownSyntax.capped).toBe(true);
    expect(unknownSyntax.band).not.toBe("certain");

    const unsupported = scoreFeatures(features({ languageSupported: false }), model);
    expect(unsupported.confidence).toBeCloseTo(0.7);
    expect(unsupported.band).toBe("medium");

    const unverified = scoreFeatures(
      features({
        strategy: "llm-assisted",
        checks: [
          { kind: "syntax", status: "pass" },
          { kind: "symbols", status: "fail" },
        ],
      }),
      model,
    );
    expect(unverified.confidence).toBeLessThanOrEqual(0.85);
    expect(confidenceCap(features({ strategy: "llm-assisted", checks: passed }))).toBe(1);
  });

  it("keeps a high probability out of the certain band while types or lint have not passed", () => {
    const scored = scoreFeatures(
      features({
        checks: [
          { kind: "syntax", status: "pass" },
          { kind: "symbols", status: "pass" },
        ],
      }),
      saturated(),
    );
    expect(scored.confidence).toBeGreaterThan(0.98);
    expect(scored.band).toBe("high");
    expect(scored.capped).toBe(false);
    expect(candidateBand(0.99, passed)).toBe("certain");
  });

  it("round-trips a model and rejects a feature list from another version", () => {
    const model = fitScoringModel({
      train: [example("identical", true), example("manual-current", false)],
    });
    const parsed = parseScoringModel(JSON.parse(JSON.stringify(model)));
    expect(scoreFeatures(features(), parsed).confidence).toBeCloseTo(
      scoreFeatures(features(), model).confidence,
    );
    expect(() => parseScoringModel({ ...model, featureNames: ["other"] })).toThrow(/features/);
    expect(() => parseScoringModel({ ...model, ece: 0 })).toThrow(/unexpected fields/);
  });

  it("rejects a training row with a confidence outside the model inputs", () => {
    expect(() =>
      parseTrainingExamples([{ ...features(), conflictLines: -1, correct: true }]),
    ).toThrow(/conflictLines/);
    expect(() =>
      parseTrainingExamples([{ ...features(), llmAgreement: 0.5, correct: true }]),
    ).toThrow(/llm-assisted/);
    expect(
      parseTrainingExamples([
        { ...features({ strategy: "llm-assisted", llmAgreement: 0.5 }), correct: true },
      ]),
    ).toHaveLength(1);
    expect(parseTrainingExamples([])).toEqual([]);
  });
});
