import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { acceptFile, undoFile } from "./resolve.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeRoot(root)));
});

describe("editor actions", () => {
  it("accepts the recommended side of a real conflict and undo restores the bytes", async () => {
    const root = await conflictRepo();
    const before = await readFile(join(root, "file.txt"));
    expect(await acceptFile(root, "file.txt", true)).toBe(true);
    const applied = await readFile(join(root, "file.txt"), "utf8");
    expect(applied).not.toContain("<<<<<<<");
    expect(applied.trim()).toBe("value");
    await undoFile(root);
    expect(await readFile(join(root, "file.txt"))).toEqual(before);
  }, 30_000);
});

async function removeRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

async function conflictRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smartmerge-editor-"));
  roots.push(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "dev@example.com"]);
  await git(root, ["config", "user.name", "SmartMerge"]);
  await git(root, ["config", "commit.gpgsign", "false"]);
  await git(root, ["config", "core.autocrlf", "false"]);
  await writeFile(join(root, "file.txt"), "value\n");
  await git(root, ["add", "file.txt"]);
  await git(root, ["commit", "-m", "base"]);
  await git(root, ["checkout", "-b", "topic"]);
  await writeFile(join(root, "file.txt"), "value\t\n");
  await git(root, ["add", "file.txt"]);
  await git(root, ["commit", "-m", "incoming"]);
  await git(root, ["checkout", "main"]);
  await writeFile(join(root, "file.txt"), "value \n");
  await git(root, ["add", "file.txt"]);
  await git(root, ["commit", "-m", "current"]);
  await git(root, ["merge", "topic"], [0, 1]);
  return root;
}

async function git(cwd: string, args: string[], allowed: readonly number[] = [0]): Promise<void> {
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
