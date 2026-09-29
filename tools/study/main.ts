/**
 * Score a usability-study session file.
 * Usage: tsx tools/study/main.ts sessions.json
 * The file is an array of sessions. An unfinished study exits 1.
 */
import { readFileSync } from "node:fs";
import { scoreStudy } from "./score.js";

const path = process.argv[2];
if (path === undefined) {
  process.stderr.write("Usage: tsx tools/study/main.ts sessions.json\n");
  process.exit(2);
}
const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
const report = scoreStudy(parsed);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.complete && report.passes ? 0 : 1);
