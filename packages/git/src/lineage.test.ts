import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { parseCommitLog, readRangeCommits } from "./lineage.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("lineage", () => {
  it("reads a commit subject and ignores the line diff that follows it", () => {
    const commits = parseCommitLog(
      [
        "abc1234\tAda\t2026-01-01T00:00:00Z\trename load for #12 and ABC-9",
        "diff --git a/file.ts b/file.ts",
        "+fetch()",
      ]
        .join("\n")
        .replaceAll("\t", "\x1f"),
    );
    expect(commits).toEqual([
      {
        sha: "abc1234",
        author: "Ada",
        authoredAt: "2026-01-01T00:00:00Z",
        subject: "rename load for #12 and ABC-9",
        refs: [
          { kind: "issue", id: "#12" },
          { kind: "ticket", id: "ABC-9" },
        ],
      },
    ]);
  });

  it("reads the subject of the commit that touched a line", async () => {
    const root = await mkdtemp(join(tmpdir(), "smartmerge-lineage-"));
    roots.push(root);
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.email", "dev@example.com"]);
    await git(root, ["config", "user.name", "SmartMerge"]);
    await git(root, ["config", "commit.gpgsign", "false"]);
    await writeFile(join(root, "file.ts"), "function load() {\n  return 1;\n}\n");
    await git(root, ["add", "file.ts"]);
    await git(root, ["commit", "-m", "add load"]);
    const sha = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, windowsHide: true })
    ).stdout.trim();
    const commits = await readRangeCommits(root, "file.ts", sha, 1, 1);
    expect(commits.at(-1)?.subject).toBe("add load");
    expect(commits.at(-1)?.refs).toEqual([]);
  });
});

async function git(cwd: string, args: string[]): Promise<void> {
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
}
