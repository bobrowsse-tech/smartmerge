import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { assertCorpusDestination, fetchConflictFiles, writeConflictFiles } from "./corpus.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("fetchConflictFiles", () => {
  it("reads a resolved merge and skips a clean merge and a non-script file", async () => {
    const root = await resolvedConflictRepo();
    const conflicts = await fetchConflictFiles({ repoRoot: root, repository: "sample", limit: 10 });
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    expect(conflict?.repository).toBe("sample");
    expect(conflict?.path).toBe("file.ts");
    expect(conflict?.languageId).toBe("typescript");
    expect(conflict?.base).toBe("base\n");
    expect(conflict?.current).toBe("current\n");
    expect(conflict?.incoming).toBe("incoming\n");
    expect(conflict?.humanResult).toBe("resolved\n");
    expect(conflict?.hunks).toBe(1);
    expect(JSON.stringify(conflict)).not.toContain("ece");
  });

  it("returns nothing when every merge is clean", async () => {
    const root = await cleanMergeRepo();
    const conflicts = await fetchConflictFiles({ repoRoot: root, repository: "sample", limit: 10 });
    expect(conflicts).toEqual([]);
  });

  it("refuses to write the corpus inside the source repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "smartmerge-corpus-"));
    roots.push(root);
    expect(() => {
      assertCorpusDestination(root, join(root, "out"));
    }).toThrow(/outside the source repository/);
    const out = await mkdtemp(join(tmpdir(), "smartmerge-corpus-out-"));
    roots.push(out);
    assertCorpusDestination(root, out);
    const file = await writeConflictFiles(out, []);
    expect(await readFile(file, "utf8")).toBe("[]\n");
  });
});

async function resolvedConflictRepo(): Promise<string> {
  const root = await initRepo();
  await writeFile(join(root, "file.ts"), "base\n");
  await writeFile(join(root, "notes.md"), "base\n");
  await runGit(root, ["add", "."]);
  await runGit(root, ["commit", "-m", "base"]);
  await runGit(root, ["checkout", "-b", "incoming"]);
  await writeFile(join(root, "file.ts"), "incoming\n");
  await writeFile(join(root, "notes.md"), "incoming\n");
  await runGit(root, ["add", "."]);
  await runGit(root, ["commit", "-m", "incoming"]);
  await runGit(root, ["checkout", "main"]);
  await writeFile(join(root, "file.ts"), "current\n");
  await writeFile(join(root, "notes.md"), "current\n");
  await runGit(root, ["add", "."]);
  await runGit(root, ["commit", "-m", "current"]);
  await runGit(root, ["merge", "incoming"], [0, 1]);
  await writeFile(join(root, "file.ts"), "resolved\n");
  await writeFile(join(root, "notes.md"), "resolved\n");
  await runGit(root, ["add", "."]);
  await runGit(root, ["commit", "-m", "merge both"]);
  await runGit(root, ["checkout", "-b", "left"]);
  await writeFile(join(root, "only-left.ts"), "left\n");
  await runGit(root, ["add", "only-left.ts"]);
  await runGit(root, ["commit", "-m", "left"]);
  await runGit(root, ["checkout", "main"]);
  await runGit(root, ["checkout", "-b", "right"]);
  await writeFile(join(root, "only-right.ts"), "right\n");
  await runGit(root, ["add", "only-right.ts"]);
  await runGit(root, ["commit", "-m", "right"]);
  await runGit(root, ["checkout", "main"]);
  await runGit(root, ["merge", "left", "-m", "clean left"]);
  await runGit(root, ["merge", "right", "-m", "clean right"]);
  return root;
}

async function cleanMergeRepo(): Promise<string> {
  const root = await initRepo();
  await writeFile(join(root, "file.ts"), "base\n");
  await runGit(root, ["add", "file.ts"]);
  await runGit(root, ["commit", "-m", "base"]);
  await runGit(root, ["checkout", "-b", "other"]);
  await writeFile(join(root, "other.ts"), "other\n");
  await runGit(root, ["add", "other.ts"]);
  await runGit(root, ["commit", "-m", "other"]);
  await runGit(root, ["checkout", "main"]);
  await runGit(root, ["merge", "other", "-m", "clean"]);
  return root;
}

async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smartmerge-corpus-"));
  roots.push(root);
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "dev@example.com"]);
  await runGit(root, ["config", "user.name", "SmartMerge"]);
  await runGit(root, ["config", "commit.gpgsign", "false"]);
  await runGit(root, ["config", "core.autocrlf", "false"]);
  return root;
}

async function runGit(cwd: string, args: string[], allowed: readonly number[] = [0]): Promise<void> {
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
