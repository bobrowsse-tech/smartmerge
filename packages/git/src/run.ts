import { execa } from "execa";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { GitOperation, OperationContext } from "@smartmerge/protocol";

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

/** Conflicted paths in the index, with their working-tree contents. */
export async function listUnmerged(repoRoot: string): Promise<UnmergedFile[]> {
  const { stdout } = await git(repoRoot, ["diff", "--name-only", "-z", "--diff-filter=U"]);
  const paths = stdout.split("\0").filter((path) => path.length > 0);
  const files: UnmergedFile[] = [];
  for (const path of paths) {
    files.push(await readUnmerged(repoRoot, path));
  }
  return files;
}

/**
 * Describe the in-progress git operation.
 * Rebase swaps git's ours/theirs roles; that inversion is applied in a later milestone.
 * This skeleton labels the checked-out commit as current.
 */
export async function readOperation(repoRoot: string): Promise<OperationContext> {
  const gitDir = await resolveGitDir(repoRoot);
  const operation = await detectOperation(gitDir);
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

async function readUnmerged(repoRoot: string, path: string): Promise<UnmergedFile> {
  const repoPath = path.replaceAll("\\", "/");
  const absolute = resolve(repoRoot, path);
  try {
    const buffer = await readFile(absolute);
    if (buffer.includes(0)) {
      return { path: repoPath, text: null, binary: true, missing: false };
    }
    return { path: repoPath, text: buffer.toString("utf8"), binary: false, missing: false };
  } catch (error) {
    if (isNotFound(error)) {
      return { path: repoPath, text: null, binary: false, missing: true };
    }
    throw error;
  }
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
  return "merge";
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
