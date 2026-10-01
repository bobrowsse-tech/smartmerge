import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectMeasuredConflicts,
  parseMeasureSources,
  replayMeasuredConflicts,
} from "./measure.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("measure sources", () => {
  it("reads two local repositories and does not score them", async () => {
    const first = await conflictRepo();
    const second = await conflictRepo();
    const conflicts = await collectMeasuredConflicts(
      [
        { name: "alpha", source: first },
        { name: "beta", source: second },
      ],
      10,
    );
    expect(conflicts.map((conflict) => conflict.repository).sort()).toEqual(["alpha", "beta"]);
    expect(conflicts.every((conflict) => conflict.conflicted.includes("<<<<<<<"))).toBe(true);
    const replay = await replayMeasuredConflicts(conflicts);
    expect(replay.predicted).toBe(replay.rows.length);
    expect(Object.keys(replay)).not.toContain("ece");
  });

  it("rejects an empty source list", () => {
    expect(() => parseMeasureSources([])).toThrow(/At least one source/);
  });
});

async function conflictRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smartmerge-measure-"));
  roots.push(root);
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "dev@example.com"]);
  await runGit(root, ["config", "user.name", "SmartMerge"]);
  await runGit(root, ["config", "commit.gpgsign", "false"]);
  await runGit(root, ["config", "core.autocrlf", "false"]);
  await writeFile(join(root, "file.ts"), "base\n");
  await runGit(root, ["add", "file.ts"]);
  await runGit(root, ["commit", "-m", "base"]);
  await runGit(root, ["checkout", "-b", "incoming"]);
  await writeFile(join(root, "file.ts"), "incoming\n");
  await runGit(root, ["add", "file.ts"]);
  await runGit(root, ["commit", "-m", "incoming"]);
  await runGit(root, ["checkout", "main"]);
  await writeFile(join(root, "file.ts"), "current\n");
  await runGit(root, ["add", "file.ts"]);
  await runGit(root, ["commit", "-m", "current"]);
  await runGit(root, ["merge", "incoming"], [0, 1]);
  await writeFile(join(root, "file.ts"), "resolved\n");
  await runGit(root, ["add", "file.ts"]);
  await runGit(root, ["commit", "-m", "merge"]);
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
