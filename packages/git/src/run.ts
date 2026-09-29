import { execa } from "execa";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ConflictKind, GitOperation, OperationContext } from "@smartmerge/protocol";
import { classifyConflict, mentionsRenameConflict, type StageText } from "@smartmerge/core";

/** Failure from the system git binary. */
export class GitCommandError extends Error {
  readonly exitCode: number;

  constructor(args: readonly string[], exitCode: number, stderr: string) {
    const detail = stderr.trim();
    super(
      `git ${args.join(" ")} failed (${String(exitCode)})${detail.length > 0 ? `: ${detail}` : ""}`,
    );
    this.name = "GitCommandError";
    this.exitCode = exitCode;
  }
}

export interface UnmergedFile {
  /** Repo-relative path using `/` separators. */
  path: string;
  /** Working-tree text, or null when the file is missing or binary. */
  text: string | null;
  binary: boolean;
  missing: boolean;
  kind: ConflictKind;
  stages: StageText;
}

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run git in `cwd`. Throws {@link GitCommandError} unless `allowFailure` is set.
 */
export async function git(
  cwd: string,
  args: readonly string[],
  options?: { allowFailure?: boolean },
): Promise<GitResult> {
  const result = await execa("git", args, {
    cwd,
    reject: false,
    stdin: "ignore",
    stripFinalNewline: false,
    windowsHide: true,
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const exitCode = result.exitCode ?? 1;
  if (options?.allowFailure !== true && exitCode !== 0) {
    throw new GitCommandError(args, exitCode, stderr);
  }
  return { stdout, stderr, exitCode };
}

/** Absolute repository root that contains `cwd`. */
export async function findRepoRoot(cwd: string): Promise<string> {
  const { stdout } = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return stdout.trim();
}

/** Conflicted paths in the index, with their working-tree contents and stage blobs. */
export async function listUnmerged(repoRoot: string): Promise<UnmergedFile[]> {
  const { stdout } = await git(repoRoot, ["diff", "--name-only", "-z", "--diff-filter=U"]);
  const paths = stdout.split("\0").filter((path) => path.length > 0);
  const gitDir = await resolveGitDir(repoRoot);
  const mergeMessage = (await readGitFile(gitDir, "MERGE_MSG")) ?? "";
  const files: UnmergedFile[] = [];
  for (const path of paths) {
    files.push(await readUnmerged(repoRoot, path, mergeMessage));
  }
  return files;
}

/**
 * Describe the in-progress git operation.
 * Labels are branch names. During a rebase, git's ours/theirs roles are swapped:
 * `current` is the commit being replayed, and `incoming` is the branch being replayed onto.
 */
export async function readOperation(repoRoot: string): Promise<OperationContext> {
  const gitDir = await resolveGitDir(repoRoot);
  const operation = await detectOperation(gitDir);
  if (operation === "rebase") return readRebase(repoRoot, gitDir);
  const currentSha = (await git(repoRoot, ["rev-parse", "HEAD"])).stdout.trim();
  const currentLabel = (await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  const incoming = await readIncoming(repoRoot, operation, currentSha, currentLabel);
  return {
    operation,
    current: { label: currentLabel, role: "ours", commitSha: currentSha },
    incoming: incoming.side,
    mergeBaseSha: incoming.mergeBaseSha,
  };
}

async function readUnmerged(
  repoRoot: string,
  path: string,
  mergeMessage: string,
): Promise<UnmergedFile> {
  const repoPath = path.replaceAll("\\", "/");
  const stages = await readStages(repoRoot, path);
  const working = await readWorking(repoRoot, path);
  const binary = working.binary || stages.binary;
  const kind = classifyConflict({
    binary,
    basePresent: stages.base !== null,
    oursPresent: stages.ours !== null,
    theirsPresent: stages.theirs !== null,
    modeDiffers: stages.modeDiffers,
    contentSame: stages.ours !== null && stages.ours === stages.theirs,
    renameRename: mentionsRenameConflict(mergeMessage, repoPath),
  });
  return {
    path: repoPath,
    text: binary ? null : working.text,
    binary,
    missing: working.missing,
    kind,
    stages: {
      base: binary ? null : stages.base,
      ours: binary ? null : stages.ours,
      theirs: binary ? null : stages.theirs,
    },
  };
}

async function readWorking(
  repoRoot: string,
  path: string,
): Promise<{ text: string | null; binary: boolean; missing: boolean }> {
  try {
    const buffer = await readFile(resolve(repoRoot, path));
    if (buffer.includes(0)) return { text: null, binary: true, missing: false };
    return { text: buffer.toString("utf8"), binary: false, missing: false };
  } catch (error) {
    if (isNotFound(error)) return { text: null, binary: false, missing: true };
    throw error;
  }
}

interface StageRead {
  base: string | null;
  ours: string | null;
  theirs: string | null;
  binary: boolean;
  modeDiffers: boolean;
}

async function readStages(repoRoot: string, path: string): Promise<StageRead> {
  const { stdout } = await git(repoRoot, ["ls-files", "-u", "--", path]);
  const records: Array<{ mode: string; sha: string; stage: "1" | "2" | "3" }> = [];
  for (const line of stdout.split("\n")) {
    const match = /^(\d+) ([0-9a-f]+) ([123])\t/.exec(line);
    const mode = match?.[1];
    const sha = match?.[2];
    const stage = match?.[3];
    if (!mode || !sha || (stage !== "1" && stage !== "2" && stage !== "3")) continue;
    records.push({ mode, sha, stage });
  }
  const blobs = new Map<"1" | "2" | "3", { mode: string; text: string | null; binary: boolean }>();
  for (const record of records) {
    const blob = await readBlob(repoRoot, record.sha);
    blobs.set(record.stage, { mode: record.mode, text: blob.text, binary: blob.binary });
  }
  const ours = blobs.get("2");
  const theirs = blobs.get("3");
  const binary = [blobs.get("1"), ours, theirs].some((blob) => blob?.binary === true);
  return {
    base: blobs.get("1")?.text ?? null,
    ours: ours?.text ?? null,
    theirs: theirs?.text ?? null,
    binary,
    modeDiffers: ours !== undefined && theirs !== undefined && ours.mode !== theirs.mode,
  };
}

async function readBlob(
  repoRoot: string,
  sha: string,
): Promise<{ text: string | null; binary: boolean }> {
  const { stdout } = await git(repoRoot, ["cat-file", "blob", sha]);
  if (stdout.includes("\0")) return { text: null, binary: true };
  return { text: stdout, binary: false };
}

async function resolveGitDir(repoRoot: string): Promise<string> {
  const { stdout } = await git(repoRoot, ["rev-parse", "--git-dir"]);
  const dir = stdout.trim();
  return isAbsolute(dir) ? dir : resolve(repoRoot, dir);
}

async function detectOperation(gitDir: string): Promise<GitOperation> {
  if (
    (await exists(resolve(gitDir, "rebase-merge"))) ||
    (await exists(resolve(gitDir, "rebase-apply")))
  ) {
    return "rebase";
  }
  if (await exists(resolve(gitDir, "CHERRY_PICK_HEAD"))) return "cherry-pick";
  if (await exists(resolve(gitDir, "REVERT_HEAD"))) return "revert";
  const message = await readGitFile(gitDir, "MERGE_MSG");
  if (message !== null && /stash/i.test(message)) return "stash-pop";
  return "merge";
}

async function readRebase(repoRoot: string, gitDir: string): Promise<OperationContext> {
  const headName =
    (await readGitFile(gitDir, "rebase-merge/head-name")) ??
    (await readGitFile(gitDir, "rebase-apply/head-name"));
  const ontoFile =
    (await readGitFile(gitDir, "rebase-merge/onto")) ??
    (await readGitFile(gitDir, "rebase-apply/onto"));
  const replaySha = (await git(repoRoot, ["rev-parse", "REBASE_HEAD"])).stdout.trim();
  const ontoSha = ontoFile ?? (await git(repoRoot, ["rev-parse", "HEAD"])).stdout.trim();
  const base = await git(repoRoot, ["merge-base", replaySha, ontoSha], { allowFailure: true });
  return {
    operation: "rebase",
    current: {
      label: headName ? branchLabel(headName) : shortSha(replaySha),
      role: "theirs",
      commitSha: replaySha,
    },
    incoming: { label: await prettyLabel(repoRoot, ontoSha), role: "ours", commitSha: ontoSha },
    mergeBaseSha: base.exitCode === 0 ? base.stdout.trim() : null,
  };
}

function branchLabel(ref: string): string {
  const prefix = "refs/heads/";
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

async function prettyLabel(repoRoot: string, sha: string): Promise<string> {
  const named = await git(
    repoRoot,
    ["name-rev", "--name-only", "--no-undefined", "--refs=refs/heads/*", sha],
    { allowFailure: true },
  );
  const label = named.exitCode === 0 ? named.stdout.trim() : "";
  if (label.length === 0 || label === "undefined") return shortSha(sha);
  return label.replace(/~0$/, "");
}

async function readGitFile(gitDir: string, name: string): Promise<string | null> {
  try {
    const text = await readFile(resolve(gitDir, name), "utf8");
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function readIncoming(
  repoRoot: string,
  operation: GitOperation,
  currentSha: string,
  currentLabel: string,
): Promise<{ side: OperationContext["incoming"]; mergeBaseSha: string | null }> {
  const same = {
    side: { label: currentLabel, role: "theirs" as const, commitSha: currentSha },
    mergeBaseSha: null,
  };
  const ref = incomingRef(operation);
  if (!ref) return same;
  const parsed = await git(repoRoot, ["rev-parse", "--verify", "--quiet", ref], {
    allowFailure: true,
  });
  if (parsed.exitCode !== 0) return same;
  const commitSha = parsed.stdout.trim();
  const named = await git(repoRoot, ["name-rev", "--name-only", commitSha], { allowFailure: true });
  const label =
    named.exitCode === 0 && named.stdout.trim().length > 0
      ? named.stdout.trim()
      : commitSha.slice(0, 7);
  const base = await git(repoRoot, ["merge-base", currentSha, commitSha], { allowFailure: true });
  return {
    side: { label, role: "theirs", commitSha },
    mergeBaseSha: base.exitCode === 0 ? base.stdout.trim() : null,
  };
}

function incomingRef(operation: GitOperation): string | null {
  switch (operation) {
    case "merge":
      return "MERGE_HEAD";
    case "cherry-pick":
      return "CHERRY_PICK_HEAD";
    case "revert":
      return "REVERT_HEAD";
    case "rebase":
      return "REBASE_HEAD";
    case "stash-pop":
      return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
