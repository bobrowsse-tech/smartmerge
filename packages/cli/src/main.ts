#!/usr/bin/env node
import { statusReport } from "./status.js";

const args = process.argv.slice(2);
const command = args[0];
if (command !== "status") {
  process.stderr.write("Usage: smart-merge status [--repo <path>]\n");
  process.exit(2);
}

let repo = process.cwd();
for (let index = 1; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--repo") {
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      process.stderr.write("Missing path after --repo\n");
      process.exit(2);
    }
    repo = next;
    index += 1;
    continue;
  }
  process.stderr.write(`Unknown argument: ${arg ?? ""}\n`);
  process.exit(2);
}

try {
  const report = await statusReport(repo);
  process.stdout.write(report.text);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown failure";
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
