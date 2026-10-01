import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { replayConflicts, type ReplayConflict } from "@smartmerge/core";
import { assertCorpusDestination, writeCorpusJson } from "./corpus.js";

const usage = "Usage: tsx packages/git/src/replay-main.ts <conflicts.json> --out <dir>";

try {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);
  await assertCorpusDestination(null, outDir);
  const parsed: unknown = JSON.parse(await readFile(resolve(args.file), "utf8"));
  const report = await replayConflicts(parseConflicts(parsed));
  const file = await writeCorpusJson(outDir, "outcomes.json", report.rows, null);
  process.stderr.write(
    `Wrote ${String(report.predicted)} predictions to ${file}. ${String(report.unresolved)} files had no recommendation. ${String(report.unparsed)} files had no conflict markers. Confidence is the fixed proposal score, not a fitted model. No calibration error was scored.\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "The replay failed.";
  process.stderr.write(`${message}\n${usage}\n`);
  process.exitCode = 2;
}

interface ReplayArgs {
  file: string;
  out: string;
}

function parseArgs(argv: readonly string[]): ReplayArgs {
  let file = "";
  let out = "";
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--out" && value !== undefined && !value.startsWith("--")) {
      out = value;
      index += 1;
    } else if (flag !== undefined && !flag.startsWith("--") && file.length === 0) {
      file = flag;
    } else {
      throw new Error("Unrecognized replay arguments.");
    }
  }
  if (file.length === 0 || out.length === 0) {
    throw new Error("A conflicts file and an output directory are required.");
  }
  return { file, out };
}

function parseConflicts(input: unknown): ReplayConflict[] {
  if (!Array.isArray(input)) throw new Error("Conflicts must be an array.");
  return input.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("Each conflict must be an object.");
    }
    const record = item as Record<string, unknown>;
    const repository = typeof record.repository === "string" ? record.repository : "";
    const path = typeof record.path === "string" ? record.path : "";
    if (typeof record.conflicted !== "string")
      throw new Error("Each conflict needs conflicted text.");
    if (record.humanResult !== null && typeof record.humanResult !== "string") {
      throw new Error("humanResult must be a string or null.");
    }
    return { repository, path, conflicted: record.conflicted, humanResult: record.humanResult };
  });
}
