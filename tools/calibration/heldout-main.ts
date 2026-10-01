/**
 * Score confidence only for repositories held out of training.
 * Usage: tsx tools/calibration/heldout-main.ts rows.json
 * Each row is `{ repository, confidence, correct }`. Train and validation rows are ignored.
 * An empty held-out split exits 1 and records no error. This command does not fetch repositories.
 */
import { readFileSync } from "node:fs";
import { scoreHeldOut } from "./heldout.js";

const path = process.argv[2];
if (path === undefined) {
  process.stderr.write("Usage: tsx tools/calibration/heldout-main.ts rows.json\n");
  process.exit(2);
}

try {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const report = scoreHeldOut(parsed);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.passes ? 0 : 1);
} catch (error) {
  const message = error instanceof Error ? error.message : "Held-out input could not be read.";
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
