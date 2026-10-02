import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertCorpusDestination, writeCorpusJson } from "./corpus.js";
import {
  collectMeasuredConflicts,
  isCloneSource,
  parseMeasureSources,
  replayMeasuredConflicts,
} from "./measure.js";

const usage = "Usage: tsx packages/git/src/measure-main.ts sources.json --out <dir> [--limit <n>]";

try {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);
  const parsed: unknown = JSON.parse(await readFile(resolve(args.file), "utf8"));
  const sources = parseMeasureSources(parsed);
  for (const source of sources) {
    if (!isCloneSource(source.source))
      await assertCorpusDestination(resolve(source.source), outDir);
  }
  await assertCorpusDestination(null, outDir, "conflicts.json");
  await assertCorpusDestination(null, outDir, "outcomes.json");
  const conflicts = await collectMeasuredConflicts(sources, args.limit);
  const replay = await replayMeasuredConflicts(conflicts);
  const conflictFile = await writeCorpusJson(outDir, "conflicts.json", conflicts, null);
  const outcomeFile = await writeCorpusJson(outDir, "outcomes.json", replay.rows, null);
  process.stderr.write(
    `Wrote ${String(conflicts.length)} conflicted files to ${conflictFile}. Wrote ${String(replay.predicted)} predictions to ${outcomeFile}. ${String(replay.unresolved)} files had no recommendation. Confidence is the fixed proposal score, not a fitted model. No calibration error was scored.\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "The measurement fetch failed.";
  process.stderr.write(`${message}\n${usage}\n`);
  process.exitCode = 2;
}

interface MeasureArgs {
  file: string;
  out: string;
  limit: number;
}

function parseArgs(argv: readonly string[]): MeasureArgs {
  let file = "";
  let out = "";
  let limit = 30;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--out" && value !== undefined && !value.startsWith("--")) {
      out = value;
      index += 1;
    } else if (flag === "--limit" && value !== undefined && !value.startsWith("--")) {
      limit = Number(value);
      index += 1;
    } else if (flag !== undefined && !flag.startsWith("--") && file.length === 0) {
      file = flag;
    } else {
      throw new Error("Unrecognized measurement arguments.");
    }
  }
  if (file.length === 0 || out.length === 0) {
    throw new Error("A source list and an output directory are required.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("The merge limit must be an integer from 1 to 500.");
  }
  return { file, out, limit };
}
