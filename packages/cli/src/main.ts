#!/usr/bin/env node
import { applyFile, undoApply } from "./act.js";
import { CommandFailure, failureFromMessage, writeError, writeResult } from "./failure.js";
import { proposeJson, readResultText, resolveJson, statusJson, verifyFile } from "./machine.js";
import { runTerminal } from "./terminal.js";
import { installMergetool, resolveAuto, resolveInteractive, runMergetool } from "./resolve.js";
import { statusReport } from "./status.js";
import { serveUi } from "./ui-server.js";

const args = process.argv.slice(2);
const command = args[0];
const usage =
  "Usage: smart-merge status [--json] [--repo <path>]\n" +
  "       smart-merge propose <file> [--hunk <id>] [--compact] [--json] [--repo <path>]\n" +
  "       smart-merge verify <file> --hunk <id> --result-file <path|-> [--json] [--repo <path>]\n" +
  "       smart-merge resolve [file] [--auto] [--json] [--repo <path>]\n" +
  "       smart-merge ui [--repo <path>] [--port <n>] [--no-open]\n" +
  "       smart-merge mergetool <base> <local> <remote> <merged>\n" +
  "       smart-merge install-mergetool [--repo <path>]\n" +
  "       smart-merge apply <file> [--hunk <id>] [--candidate <id>] [--accept-hazardous] [--json] [--repo <path>]\n" +
  "       smart-merge undo [--json] [--repo <path>]\n";

const wantsJson = args.includes("--json");

if (
  command !== "status" &&
  command !== "propose" &&
  command !== "verify" &&
  command !== "apply" &&
  command !== "undo" &&
  command !== "resolve" &&
  command !== "mergetool" &&
  command !== "install-mergetool" &&
  command !== "ui"
) {
  if (wantsJson) writeError(new CommandFailure(2, "INVALID_INPUT", "Unknown command."));
  else process.stderr.write(usage);
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
    if (parsed.json) {
      const result = await resolveJson(parsed.repo, parsed.file, parsed.auto === true);
      writeResult(result.result);
      process.exit(result.code);
    }
    const result = parsed.auto
      ? await resolveAuto(parsed.repo, parsed.file)
      : process.stdin.isTTY
        ? await runTerminal(parsed.repo, parsed.file)
        : await resolveInteractive(parsed.repo, parsed.file, false);
    process.stdout.write(result.text);
    process.exit(result.code);
  } else if (command === "status") {
    const parsed = parseArgs(command, args.slice(1));
    if (parsed.json) {
      const result = await statusJson(parsed.repo);
      writeResult(result.result);
      process.exit(result.code);
    }
    const report = await statusReport(parsed.repo);
    process.stdout.write(report.text);
  } else if (command === "propose") {
    const parsed = parseArgs(command, args.slice(1));
    if (parsed.file === undefined)
      throw new CommandFailure(2, "INVALID_INPUT", "A file is required.");
    const proposals = await proposeJson(
      parsed.repo,
      parsed.file,
      parsed.hunk,
      parsed.compact === true,
    );
    if (parsed.json) writeResult(proposals);
    else process.stdout.write(`${JSON.stringify(proposals, null, 2)}\n`);
  } else if (command === "verify") {
    const parsed = parseArgs(command, args.slice(1));
    if (parsed.file === undefined || parsed.hunk === undefined || parsed.resultFile === undefined) {
      throw new CommandFailure(
        2,
        "INVALID_INPUT",
        "verify requires a file, --hunk, and --result-file.",
      );
    }
    const checked = await verifyFile(
      parsed.repo,
      parsed.file,
      parsed.hunk,
      await readResultText(parsed.resultFile),
    );
    if (parsed.json) writeResult(checked.result);
    else {
      const summary = checked.result.hazardous
        ? "Verification failed. Nothing was written.\n"
        : "Syntax and symbols did not fail. Types and lint have not run. Nothing was written.\n";
      process.stdout.write(summary);
    }
    process.exit(checked.code);
  } else if (command === "undo") {
    const parsed = parseArgs(command, args.slice(1));
    const text = await undoApply(parsed.repo);
    if (parsed.json) writeResult({ text });
    else process.stdout.write(text);
  } else {
    const parsed = parseArgs(command, args.slice(1));
    if (parsed.file === undefined) {
      throw new CommandFailure(2, "INVALID_INPUT", "A file is required.");
    }
    const text = await applyFile(
      parsed.repo,
      parsed.file,
      parsed.candidate,
      parsed.acceptHazardous === true,
      parsed.hunk,
    );
    if (parsed.json) writeResult({ text });
    else process.stdout.write(text);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown failure";
  if (wantsJson) {
    const failure = error instanceof CommandFailure ? error : failureFromMessage(message);
    writeError(failure);
    process.exit(failure.exitCode);
  }
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

interface ParsedArgs {
  repo: string;
  file?: string;
  candidate?: string;
  auto?: boolean;
  json?: boolean;
  hunk?: string;
  resultFile?: string;
  compact?: boolean;
  acceptHazardous?: boolean;
}

function parseArgs(command: string, args: string[]): ParsedArgs {
  let repo = process.cwd();
  let file: string | undefined;
  let candidate: string | undefined;
  let auto = false;
  let json = false;
  let hunk: string | undefined;
  let resultFile: string | undefined;
  let compact = false;
  let acceptHazardous = false;
  const fileCommands =
    command === "apply" || command === "resolve" || command === "propose" || command === "verify";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--compact" && command === "propose") {
      compact = true;
      continue;
    }
    if (arg === "--accept-hazardous" && command === "apply") {
      acceptHazardous = true;
      continue;
    }
    if (arg === "--auto" && command === "resolve") {
      auto = true;
      continue;
    }
    if (
      arg === "--hunk" &&
      (command === "propose" || command === "verify" || command === "apply")
    ) {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--"))
        throw new Error(`Missing value after ${arg}`);
      hunk = next;
      index += 1;
      continue;
    }
    if (arg === "--result-file" && command === "verify") {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--"))
        throw new Error(`Missing value after ${arg}`);
      resultFile = next;
      index += 1;
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
    if (!fileCommands || file !== undefined) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    file = arg;
  }
  const parsed: ParsedArgs = { repo };
  if (file !== undefined) parsed.file = file;
  if (candidate !== undefined) parsed.candidate = candidate;
  if (auto) parsed.auto = true;
  if (json) parsed.json = true;
  if (hunk !== undefined) parsed.hunk = hunk;
  if (resultFile !== undefined) parsed.resultFile = resultFile;
  if (compact) parsed.compact = true;
  if (acceptHazardous) parsed.acceptHazardous = true;
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
