import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertCorpusDestination,
  fetchClonedConflicts,
  fetchConflictFiles,
  writeConflictFiles,
} from "./corpus.js";

const usage =
  "Usage: tsx packages/git/src/corpus-main.ts (--repo <path> | --clone <url>) --out <dir> [--limit <n>] [--name <label>]";

try {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);
  const repository = args.name ?? labelFrom(args.source);
  const sourceRoot =
    args.kind === "repo" || (await isDirectory(args.source)) ? resolve(args.source) : null;
  await assertCorpusDestination(sourceRoot, outDir);
  const conflicts =
    args.kind === "clone"
      ? await fetchClonedConflicts(args.source, repository, args.limit)
      : await fetchConflictFiles({ repoRoot: resolve(args.source), repository, limit: args.limit });
  const file = await writeConflictFiles(outDir, conflicts, sourceRoot);
  process.stderr.write(
    `Wrote ${String(conflicts.length)} conflicted files to ${file}. No calibration error was scored.\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "The corpus fetch failed.";
  process.stderr.write(`${message}\n${usage}\n`);
  process.exitCode = 2;
}

interface FetchArgs {
  kind: "repo" | "clone";
  source: string;
  out: string;
  limit: number;
  name?: string;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function labelFrom(source: string): string {
  const trimmed = source.replace(/\.git\/?$/, "");
  return (
    trimmed
      .split(/[\\/]/)
      .filter((part) => part.length > 0)
      .at(-1) ?? "repository"
  );
}

function parseArgs(argv: readonly string[]): FetchArgs {
  let repo = "";
  let clone = "";
  let out = "";
  let limit = 30;
  let name: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--repo" && value !== undefined && !value.startsWith("--")) {
      repo = value;
      index += 1;
    } else if (flag === "--clone" && value !== undefined && !value.startsWith("--")) {
      clone = value;
      index += 1;
    } else if (flag === "--out" && value !== undefined && !value.startsWith("--")) {
      out = value;
      index += 1;
    } else if (flag === "--limit" && value !== undefined && !value.startsWith("--")) {
      limit = Number(value);
      index += 1;
    } else if (flag === "--name" && value !== undefined && !value.startsWith("--")) {
      name = value;
      index += 1;
    } else {
      throw new Error("Unrecognized corpus fetch arguments.");
    }
  }
  if (
    out.length === 0 ||
    (repo.length === 0 && clone.length === 0) ||
    (repo.length > 0 && clone.length > 0)
  ) {
    throw new Error("Pass either a local repository or a clone source, and an output directory.");
  }
  if (!Number.isInteger(limit))
    throw new Error("The merge limit must be an integer from 1 to 500.");
  const kind = clone.length > 0 ? "clone" : "repo";
  const source = clone.length > 0 ? clone : repo;
  return name === undefined ? { kind, source, out, limit } : { kind, source, out, limit, name };
}
