#!/usr/bin/env node
import { applyFile, undoApply } from "./act.js";
import { statusReport } from "./status.js";

const args = process.argv.slice(2);
const command = args[0];
const usage =
  "Usage: smart-merge status [--repo <path>]\n" +
  "       smart-merge apply <file> [--candidate <id>] [--repo <path>]\n" +
  "       smart-merge undo [--repo <path>]\n";

if (command !== "status" && command !== "apply" && command !== "undo") {
  process.stderr.write(usage);
  process.exit(2);
}

try {
  const parsed = parseArgs(command, args.slice(1));
  if (command === "status") {
    const report = await statusReport(parsed.repo);
    process.stdout.write(report.text);
  } else if (command === "undo") {
    process.stdout.write(await undoApply(parsed.repo));
  } else {
    if (parsed.file === undefined) {
      process.stderr.write(usage);
      process.exit(2);
    }
    process.stdout.write(await applyFile(parsed.repo, parsed.file, parsed.candidate));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown failure";
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

interface ParsedArgs {
  repo: string;
  file?: string;
  candidate?: string;
}

function parseArgs(command: string, args: string[]): ParsedArgs {
  let repo = process.cwd();
  let file: string | undefined;
  let candidate: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo" || arg === "--candidate") {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Missing value after ${arg}`);
      }
      if (arg === "--repo") repo = next;
      else candidate = next;
      index += 1;
      continue;
    }
    if (arg === undefined || arg.startsWith("--"))
      throw new Error(`Unknown argument: ${arg ?? ""}`);
    if (command !== "apply" || file !== undefined) throw new Error(`Unknown argument: ${arg}`);
    file = arg;
  }
  const parsed: ParsedArgs = { repo };
  if (file !== undefined) parsed.file = file;
  if (candidate !== undefined) parsed.candidate = candidate;
  return parsed;
}
