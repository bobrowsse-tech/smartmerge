import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { buildConflict } from "@smartmerge/core";
import { listUnmerged, readOperation } from "./run.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("listUnmerged", () => {
  it("lists a real merge conflict and ignores clean files", async () => {
    const root = await conflictRepo();
    const files = await listUnmerged(root);
    expect(files.map((file) => file.path)).toEqual(["file.txt"]);
    const file = files[0];
    expect(file?.text).toContain("<<<<<<<");
    expect(file?.text).toContain("current");
    expect(file?.text).toContain("incoming");
    expect(file?.binary).toBe(false);

    const operation = await readOperation(root);
    expect(operation.operation).toBe("merge");
    expect(operation.current.label).toBe("main");
    expect(operation.current.role).toBe("ours");
    expect(operation.incoming.role).toBe("theirs");
    expect(operation.incoming.commitSha).not.toBe(operation.current.commitSha);
    expect(operation.mergeBaseSha).not.toBeNull();
  });

  it("labels a rebase with the replayed branch as current", async () => {
    const root = await rebaseRepo();
    const operation = await readOperation(root);
    expect(operation.operation).toBe("rebase");
    expect(operation.current.role).toBe("theirs");
    expect(operation.current.label).toBe("feature");
    expect(operation.incoming.role).toBe("ours");
    expect(operation.incoming.label).toBe("main");
    expect(operation.current.label).not.toMatch(/^(ours|theirs)$/);

    const files = await listUnmerged(root);
    const file = files[0];
    if (!file) throw new Error("expected a conflicted file");
    const built = buildConflict(file, operation);
    expect(built.file.hunks[0]?.current).toBe("feature");
    expect(built.file.hunks[0]?.incoming).toBe("mainline");
    expect(built.knownBaseHunkIds).toContain(built.file.hunks[0]?.id);
    expect(built.file.hunks[0]?.base).toBe("base");
  });
});

async function conflictRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smartmerge-git-"));
  roots.push(root);
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "dev@example.com"]);
  await runGit(root, ["config", "user.name", "SmartMerge"]);
  await runGit(root, ["config", "commit.gpgsign", "false"]);
  await runGit(root, ["config", "core.autocrlf", "false"]);
  await writeFile(join(root, "file.txt"), "base\n");
  await writeFile(join(root, "clean.txt"), "clean\n");
  await runGit(root, ["add", "."]);
  await runGit(root, ["commit", "-m", "base"]);
  await runGit(root, ["checkout", "-b", "incoming"]);
  await writeFile(join(root, "file.txt"), "incoming\n");
  await runGit(root, ["add", "file.txt"]);
  await runGit(root, ["commit", "-m", "incoming"]);
  await runGit(root, ["checkout", "main"]);
  await writeFile(join(root, "file.txt"), "current\n");
  await runGit(root, ["add", "file.txt"]);
  await runGit(root, ["commit", "-m", "current"]);
  await runGit(root, ["merge", "incoming"], [0, 1]);
  return root;
}

async function rebaseRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smartmerge-git-"));
  roots.push(root);
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "dev@example.com"]);
  await runGit(root, ["config", "user.name", "SmartMerge"]);
  await runGit(root, ["config", "commit.gpgsign", "false"]);
  await runGit(root, ["config", "core.autocrlf", "false"]);
  await runGit(root, ["config", "rebase.backend", "merge"]);
  await writeFile(join(root, "file.txt"), "base\n");
  await runGit(root, ["add", "file.txt"]);
  await runGit(root, ["commit", "-m", "base"]);
  await runGit(root, ["checkout", "-b", "feature"]);
  await writeFile(join(root, "file.txt"), "feature\n");
  await runGit(root, ["add", "file.txt"]);
  await runGit(root, ["commit", "-m", "feature"]);
  await runGit(root, ["checkout", "main"]);
  await writeFile(join(root, "file.txt"), "mainline\n");
  await runGit(root, ["add", "file.txt"]);
  await runGit(root, ["commit", "-m", "mainline"]);
  await runGit(root, ["checkout", "feature"]);
  await runGit(root, ["rebase", "main"], [0, 1]);
  return root;
}

async function runGit(
  cwd: string,
  args: string[],
  allowed: readonly number[] = [0],
): Promise<void> {
  try {
    await execFileAsync("git", args, {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "SmartMerge",
        GIT_AUTHOR_EMAIL: "dev@example.com",
        GIT_COMMITTER_NAME: "SmartMerge",
        GIT_COMMITTER_EMAIL: "dev@example.com",
      },
    });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (typeof code === "number" && allowed.includes(code)) return;
    throw error;
  }
}
