import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseConflictHunks } from "@smartmerge/core";
import { git } from "./run.js";

/** Characters in one side before a conflicted file is skipped. */
const MAX_SIDE_CHARS = 1_000_000;

/** Conflicted files kept from one repository. */
const MAX_FILES = 100;

/**
 * One conflicted text file from a historical merge.
 * `humanResult` is the file the merge committed, not a sliced hunk.
 */
export interface FetchedConflict {
  repository: string;
  commit: string;
  path: string;
  languageId: "typescript" | "javascript";
  /** File at the merge base, or null when the path did not exist there. */
  base: string | null;
  /** File on the first parent, or null when that parent did not have it. */
  current: string | null;
  /** File on the second parent, or null when that parent did not have it. */
  incoming: string | null;
  /** File committed by the merge, or null when the merge removed it. */
  humanResult: string | null;
  /** Conflict regions in the replayed merge. */
  hunks: number;
}

export interface FetchConflictsOptions {
  /** Local repository to read. Nothing is written here. */
  repoRoot: string;
  /** Label stored on each record. A repository name, not a commit message. */
  repository: string;
  /** How many merge commits to replay, starting at the newest. */
  limit: number;
}

/**
 * Replay merge commits and return conflicted TypeScript and JavaScript files.
 * The repository is only read. No calibration score is computed.
 */
export async function fetchConflictFiles(
  options: FetchConflictsOptions,
): Promise<FetchedConflict[]> {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500) {
    throw new Error("The merge limit must be an integer from 1 to 500.");
  }
  const repository = options.repository.trim();
  if (repository.length === 0 || repository.length > 200) {
    throw new Error("The repository name must be 1 to 200 characters.");
  }
  const repoRoot = (await git(options.repoRoot, ["rev-parse", "--show-toplevel"])).stdout.trim();
  const listed = await git(repoRoot, [
    "rev-list",
    "--merges",
    `--max-count=${String(options.limit)}`,
    "HEAD",
  ]);
  const commits = listed.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const found: FetchedConflict[] = [];
  for (const commit of commits) {
    if (found.length >= MAX_FILES) break;
    const batch = await conflictsInMerge(repoRoot, repository, commit, MAX_FILES - found.length);
    found.push(...batch);
  }
  return found;
}

/**
 * Clone into a temporary directory, read its conflicted files, and delete the clone.
 * The caller supplies the source. This does not score calibration.
 */
export async function fetchClonedConflicts(
  source: string,
  repository: string,
  limit: number,
): Promise<FetchedConflict[]> {
  const parent = await mkdtemp(join(tmpdir(), "smartmerge-corpus-clone-"));
  try {
    const destination = join(parent, "repo");
    await git(parent, ["clone", "--quiet", "--no-local", "--no-tags", source, destination]);
    return await fetchConflictFiles({ repoRoot: destination, repository, limit });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

/**
 * Refuse a destination inside the source repository so fetched history is not written back into it.
 */
export function assertCorpusDestination(repoRoot: string, outDir: string): void {
  const root = resolve(repoRoot);
  const out = resolve(outDir);
  const rel = relative(root, out);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new Error("Write the corpus outside the source repository.");
  }
}

/** Write conflict records as JSON. This is not a calibration report. */
export async function writeConflictFiles(outDir: string, conflicts: readonly FetchedConflict[]): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const file = resolve(outDir, "conflicts.json");
  await writeFile(file, `${JSON.stringify(conflicts, null, 2)}\n`, "utf8");
  return file;
}

async function conflictsInMerge(
  repoRoot: string,
  repository: string,
  commit: string,
  room: number,
): Promise<FetchedConflict[]> {
  const parents = (await git(repoRoot, ["rev-parse", `${commit}^@`])).stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const first = parents[0];
  const second = parents[1];
  if (parents.length !== 2 || first === undefined || second === undefined) return [];
  const replay = await git(
    repoRoot,
    ["merge-tree", "--write-tree", "--name-only", "--messages", first, second],
    { allowFailure: true },
  );
  if (replay.exitCode === 0) return [];
  const parsed = conflictedPaths(replay.stdout);
  if (parsed === null || parsed.paths.length === 0) return [];
  const baseCommit = (await git(repoRoot, ["merge-base", first, second], { allowFailure: true })).stdout.trim();
  const found: FetchedConflict[] = [];
  for (const path of parsed.paths) {
    if (found.length >= room) break;
    const languageId = languageFor(path);
    if (languageId === null || path.includes(":") || path.includes("\0")) continue;
    const conflicted = await showBlob(repoRoot, parsed.tree, path);
    if (conflicted === null || !conflicted.includes("<<<<<<<")) continue;
    const hunks = parseConflictHunks(conflicted).length;
    if (hunks === 0) continue;
    const current = await showBlob(repoRoot, first, path);
    const incoming = await showBlob(repoRoot, second, path);
    if (current === null && incoming === null) continue;
    const base = baseCommit.length > 0 ? await showBlob(repoRoot, baseCommit, path) : null;
    const humanResult = await showBlob(repoRoot, commit, path);
    found.push({
      repository,
      commit,
      path,
      languageId,
      base,
      current,
      incoming,
      humanResult,
      hunks,
    });
  }
  return found;
}

function conflictedPaths(stdout: string): { tree: string; paths: string[] } | null {
  const lines = stdout.split("\n");
  const tree = lines[0]?.trim() ?? "";
  if (!/^[0-9a-f]{40}$/i.test(tree) && !/^[0-9a-f]{64}$/i.test(tree)) return null;
  const paths: string[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.length === 0) break;
    paths.push(line);
  }
  return { tree, paths };
}

async function showBlob(repoRoot: string, rev: string, path: string): Promise<string | null> {
  const shown = await git(repoRoot, ["show", `${rev}:${path}`], { allowFailure: true });
  if (shown.exitCode !== 0) return null;
  if (shown.stdout.includes("\0") || shown.stdout.length > MAX_SIDE_CHARS) return null;
  return shown.stdout;
}

function languageFor(path: string): FetchedConflict["languageId"] | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".mts") || lower.endsWith(".cts")) {
    return "typescript";
  }
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return "javascript";
  }
  return null;
}
