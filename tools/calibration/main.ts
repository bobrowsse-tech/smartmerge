/**
 * Score held-out calibration outcomes.
 * Usage: tsx tools/calibration/main.ts outcomes.json
 * The file is an array of `{ confidence, correct }`. No outcomes exits 1 and records no error.
 */
import { readFileSync } from "node:fs";
import { scoreCalibration } from "./score.js";

const path = process.argv[2];
if (path === undefined) {
  process.stderr.write("Usage: tsx tools/calibration/main.ts outcomes.json\n");
  process.exit(2);
}

try {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const report = scoreCalibration(parsed);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.passes ? 0 : 1);
} catch (error) {
  const message = error instanceof Error ? error.message : "Calibration input could not be read.";
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
