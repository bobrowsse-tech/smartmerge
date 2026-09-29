#!/usr/bin/env node
import { applyFile, undoApply } from "./act.js";
import { runTerminal } from "./run-terminal.js";
import { installMergetool, resolveAuto, resolveInteractive, runMergetool } from "./resolve.js";
import { statusReport } from "./status.js";
import { serveUi } from "./ui-server.js";

const args = process.argv.slice(2);
const command = args[0];
const usage =
  "Usage: smart-merge status [--repo <path>]\n" +
  "       smart-merge resolve [file] [--auto] [--repo <path>]\n" +
  "       smart-merge ui [--repo <path>] [--port <n>] [--no-open]\n" +
  "       smart-merge mergetool <base> <local> <remote> <merged>\n" +
  "       smart-merge install-mergetool [--repo <path>]\n" +
  "       smart-merge apply <file> [--candidate <id>] [--repo <path>]\n" +
  "       smart-merge undo [--repo <path>]\n";

if (
  command !== "status" &&
  command !== "apply" &&
  command !== "undo" &&
  command !== "resolve" &&
  command !== "mergetool" &&
  command !== "install-mergetool" &&
  command !== "ui"
) {
  process.stderr.write(usage);
  process.exit(2);
}

try {
  if (command === "mergetool") {
    const [base, local, remote, merged, extra] = args.slice(1);
    if (
      base === undefined ||
      local === undefined ||
      remote === undefined ||
      merged === undefined ||
      extra !== undefined
    ) {
      process.stderr.write(usage);
      process.exit(2);
    }
    const result = await runMergetool(base, local, remote, merged);
    process.stdout.write(result.text);
    process.exit(result.code);
  }
  if (command === "ui") {
    const parsed = parseUiArgs(args.slice(1));
    await serveUi(parsed.repo, { port: parsed.port, open: parsed.open });
  } else if (command === "install-mergetool") {
    const parsed = parseArgs(command, args.slice(1));
    process.stdout.write(await installMergetool(parsed.repo));
  } else if (command === "resolve") {
    const parsed = parseArgs(command, args.slice(1));
    const result = parsed.auto
      ? await resolveAuto(parsed.repo, parsed.file)
      : process.stdin.isTTY
        ? await runTerminal(parsed.repo, parsed.file)
        : await resolveInteractive(parsed.repo, parsed.file, false);
    process.stdout.write(result.text);
    process.exit(result.code);
  } else if (command === "status") {
    const parsed = parseArgs(command, args.slice(1));
    const report = await statusReport(parsed.repo);
    process.stdout.write(report.text);
  } else if (command === "undo") {
    const parsed = parseArgs(command, args.slice(1));
    process.stdout.write(await undoApply(parsed.repo));
  } else {
    const parsed = parseArgs(command, args.slice(1));
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
  auto?: boolean;
}

function parseArgs(command: string, args: string[]): ParsedArgs {
  let repo = process.cwd();
  let file: string | undefined;
  let candidate: string | undefined;
  let auto = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--auto" && command === "resolve") {
      auto = true;
      continue;
    }
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
    if ((command !== "apply" && command !== "resolve") || file !== undefined) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    file = arg;
  }
  const parsed: ParsedArgs = { repo };
  if (file !== undefined) parsed.file = file;
  if (candidate !== undefined) parsed.candidate = candidate;
  if (auto) parsed.auto = true;
  return parsed;
}

function parseUiArgs(args: string[]): { repo: string; port: number; open: boolean } {
  let repo = process.cwd();
  let port = 4738;
  let open = process.stdin.isTTY;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-open") {
      open = false;
      continue;
    }
    if (arg === "--repo" || arg === "--port") {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--"))
        throw new Error(`Missing value after ${arg}`);
      if (arg === "--repo") repo = next;
      else {
        const value = Number(next);
        if (!Number.isInteger(value) || value < 0 || value > 65535) {
          throw new Error("Port must be an integer from 0 to 65535.");
        }
        port = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }
  return { repo, port, open };
}
