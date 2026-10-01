/**
 * Fit a scoring model from labeled examples.
 * Usage: tsx packages/core/src/scoring-main.ts train.json [validation.json]
 * The file is an array of feature rows with `correct`. An empty train file does not produce a model.
 * This command does not score calibration error and does not write a coefficient file into the repo.
 */
import { readFileSync } from "node:fs";
import { fitScoringModel, parseTrainingExamples } from "./logistic.js";

const trainPath = process.argv[2];
if (trainPath === undefined) {
  process.stderr.write(
    "Usage: tsx packages/core/src/scoring-main.ts train.json [validation.json]\n",
  );
  process.exit(2);
}

try {
  const train = parseTrainingExamples(JSON.parse(readFileSync(trainPath, "utf8")));
  const validationPath = process.argv[3];
  const validation =
    validationPath === undefined
      ? []
      : parseTrainingExamples(JSON.parse(readFileSync(validationPath, "utf8")));
  const model = fitScoringModel({ train, validation });
  process.stdout.write(`${JSON.stringify(model, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Training input could not be read.";
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
