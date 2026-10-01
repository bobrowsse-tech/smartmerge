#!/usr/bin/env node
import { installAgentKit } from "@smartmerge/agent-kit";
import { defaultConfig } from "@smartmerge/core";
import { startStdioMcp } from "@smartmerge/mcp";
import type { AgentPolicy, VerifyResult } from "@smartmerge/protocol";
import { applyFile, undoApply } from "./act.js";
import { requireGitRoot, runCi } from "./ci.js";
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
  "       smart-merge undo [--json] [--repo <path>]\n" +
  "       smart-merge mcp [--policy <mode>] [--actor <name>] [--repo <path>]\n" +
  "       smart-merge ci [--json] [--policy <mode>] [--dry-run] [--repo <path>]\n" +
  "       smart-merge agents install [--json] [--repo <path>]\n";

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
  command !== "ui" &&
  command !== "mcp" &&
  command !== "ci" &&
  command !== "agents"
) {
  if (wantsJson) writeError(new CommandFailure(2, "INVALID_INPUT", "Unknown command."));
  else process.stderr.write(usage);
  process.exit(2);
}

try {
  if (command === "mcp") {
    const parsed = parseMcpArgs(args.slice(1));
    await startStdioMcp({
      repoRoot: parsed.repo,
      ...(parsed.actor !== undefined ? { actorName: parsed.actor } : {}),
      ...(parsed.policy !== undefined ? { userPolicy: parsed.policy } : {}),
    });
    process.exit(0);
  }
  if (command === "ci") {
    const parsed = parseCiArgs(args.slice(1));
    const result = await runCi(parsed.repo, {
      dryRun: parsed.dryRun,
      ...(parsed.policy !== undefined ? { userPolicy: parsed.policy } : {}),
    });
    if (parsed.json) writeResult(result.result);
    else {
      const summary = result.result.wrote
        ? `Applied ${String(result.result.applied)} resolution(s). ${String(result.result.remaining)} conflict(s) remain.\n`
        : `Reported ${String(result.result.conflicts)} conflict(s). Nothing was written.\n`;
      process.stdout.write(summary);
    }
    process.exit(result.code);
  }
  if (command === "agents") {
    const parsed = parseAgentsArgs(args.slice(1));
    const repo = await requireGitRoot(parsed.repo);
    const installed = await installAgentKit(repo);
    if (parsed.json) writeResult(installed);
    else process.stdout.write("Installed agent instructions in AGENTS.md and the skill file.\n");
    process.exit(0);
  }
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
        : passedSummary(checked.result);
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

function parseMcpArgs(args: string[]): {
  repo: string;
  actor?: string;
  policy?: AgentPolicy;
} {
  let repo = process.cwd();
  let actor: string | undefined;
  let mode: AgentPolicy["mode"] | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo" || arg === "--actor" || arg === "--policy") {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Missing value after ${arg}`);
      }
      if (arg === "--repo") repo = next;
      else if (arg === "--actor") actor = next;
      else {
        if (
          next !== "read-only" &&
          next !== "propose-and-verify" &&
          next !== "apply-safe" &&
          next !== "apply-any"
        ) {
          throw new Error(
            "Policy must be read-only, propose-and-verify, apply-safe, or apply-any.",
          );
        }
        mode = next;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }
  const parsed: { repo: string; actor?: string; policy?: AgentPolicy } = { repo };
  if (actor !== undefined) parsed.actor = actor;
  if (mode !== undefined) {
    parsed.policy = { ...defaultConfig().agent, mode };
  }
  return parsed;
}

function parseCiArgs(args: string[]): {
  repo: string;
  policy?: AgentPolicy;
  dryRun: boolean;
  json: boolean;
} {
  let repo = process.cwd();
  let mode: AgentPolicy["mode"] | undefined;
  let dryRun = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--repo" || arg === "--policy") {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new CommandFailure(2, "INVALID_INPUT", `Missing value after ${arg}`);
      }
      if (arg === "--repo") repo = next;
      else mode = parseMode(next);
      index += 1;
      continue;
    }
    throw new CommandFailure(2, "INVALID_INPUT", `Unknown argument: ${arg ?? ""}`);
  }
  const parsed: { repo: string; policy?: AgentPolicy; dryRun: boolean; json: boolean } = {
    repo,
    dryRun,
    json,
  };
  if (mode !== undefined) parsed.policy = { ...defaultConfig().agent, mode };
  return parsed;
}

function parseAgentsArgs(args: string[]): { repo: string; json: boolean } {
  if (args[0] !== "install") {
    throw new CommandFailure(2, "INVALID_INPUT", "Use smart-merge agents install.");
  }
  let repo = process.cwd();
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--repo") {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new CommandFailure(2, "INVALID_INPUT", "Missing value after --repo");
      }
      repo = next;
      index += 1;
      continue;
    }
    throw new CommandFailure(2, "INVALID_INPUT", `Unknown argument: ${arg ?? ""}`);
  }
  return { repo, json };
}

function parseMode(value: string): AgentPolicy["mode"] {
  if (
    value === "read-only" ||
    value === "propose-and-verify" ||
    value === "apply-safe" ||
    value === "apply-any"
  ) {
    return value;
  }
  throw new CommandFailure(
    2,
    "INVALID_INPUT",
    "Policy must be read-only, propose-and-verify, apply-safe, or apply-any.",
  );
}

function passedSummary(result: VerifyResult): string {
  const types = result.checks.find((check) => check.kind === "types")?.status;
  const lint = result.checks.find((check) => check.kind === "lint")?.status;
  const typeSentence =
    types === "pass" ? "Types passed." : types === "fail" ? "Types failed." : "Types have not run.";
  const lintSentence =
    lint === "pass" ? "Lint passed." : lint === "fail" ? "Lint failed." : "Lint has not run.";
  return `Syntax and symbols did not fail. ${typeSentence} ${lintSentence} Nothing was written.\n`;
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
