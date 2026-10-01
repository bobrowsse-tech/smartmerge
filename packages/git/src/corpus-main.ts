import { resolve } from "node:path";
import { assertCorpusDestination, fetchConflictFiles, writeConflictFiles } from "./corpus.js";

const usage = "Usage: tsx packages/git/src/corpus-main.ts --repo <path> --out <dir> [--limit <n>] [--name <label>]";

try {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(args.repo);
  const outDir = resolve(args.out);
  assertCorpusDestination(repoRoot, outDir);
  const conflicts = await fetchConflictFiles({
    repoRoot,
    repository: args.name ?? repoRoot.split(/[\\/]/).filter((part) => part.length > 0).at(-1) ?? "repository",
    limit: args.limit,
  });
  const file = await writeConflictFiles(outDir, conflicts);
  process.stderr.write(
    `Wrote ${String(conflicts.length)} conflicted files to ${file}. No calibration error was scored.\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "The corpus fetch failed.";
  process.stderr.write(`${message}\n${usage}\n`);
  process.exitCode = 2;
}

interface FetchArgs {
  repo: string;
  out: string;
  limit: number;
  name?: string;
}

function parseArgs(argv: readonly string[]): FetchArgs {
  let repo = "";
  let out = "";
  let limit = 30;
  let name: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--repo" && value !== undefined && !value.startsWith("--")) {
      repo = value;
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
  if (repo.length === 0 || out.length === 0) throw new Error("A repository and an output directory are required.");
  if (!Number.isInteger(limit)) throw new Error("The merge limit must be an integer from 1 to 500.");
  return name === undefined ? { repo, out, limit } : { repo, out, limit, name };
}
