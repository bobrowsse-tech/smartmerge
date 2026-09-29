import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { withDaemon } from "@smartmerge/daemon";
import { applyFile, undoApply } from "./act.js";
import { statusReport } from "./status.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeRoot(root)));
});

describe("smart-merge status", () => {
  it("lists a real conflict and skips clean files", async () => {
    const root = await conflictRepo();
    const report = await statusReport(root);
    expect(report.text).toContain("file.txt");
    expect(report.text).toContain("1 hunk");
    expect(report.text).toContain("no recommendation yet");
    expect(report.text).not.toContain("clean.txt");
    expect(report.session.files).toHaveLength(1);
  });

  it("applies a chosen side and undo restores the original bytes", async () => {
    const root = await conflictRepo();
    const before = await readFile(join(root, "file.txt"));
    const report = await statusReport(root);
    const manual = report.proposals
      .get("file.txt")?.[0]
      ?.candidates.find((candidate) => candidate.strategy === "manual-current");
    if (!manual) throw new Error("expected a manual-current candidate");
    await applyFile(root, "file.txt", manual.id);
    const applied = await readFile(join(root, "file.txt"), "utf8");
    expect(applied).not.toContain("<<<<<<<");
    expect(applied).toContain("current");
    await undoApply(root);
    expect(await readFile(join(root, "file.txt"))).toEqual(before);
    await expect(undoApply(root)).rejects.toThrow(/Nothing to undo/);
  }, 30_000);

  it("does not write when automatic apply is requested and left off", async () => {
    const root = await conflictRepo();
    const before = await readFile(join(root, "file.txt"));
    await withDaemon(root, async (client) => {
      await client.initialize(root);
      const session = await client.listConflicts(root);
      await client.propose(session.sessionId, "file.txt");
      const result = await client.act(session.sessionId, {
        type: "applyAllSafe",
        minBand: "certain",
      });
      expect(result.log).toEqual([]);
    });
    expect(await readFile(join(root, "file.txt"))).toEqual(before);
  });

  it("reports an empty repository as having no conflicts", async () => {
    const root = await cleanRepo();
    const report = await statusReport(root);
    expect(report.text).toBe("No conflicts.\n");
  });

  it("fails outside a git repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "smartmerge-cli-"));
    roots.push(root);
    await expect(statusReport(root)).rejects.toThrow(/not a git repository|fatal:/i);
  });

  it("refuses a protocol range this daemon does not speak", async () => {
    const root = await cleanRepo();
    await expect(withDaemon(root, (client) => client.initialize(root, "2.0.0"))).rejects.toThrow(
      /Unsupported protocol range 2.0.0/,
    );
  });
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

async function cleanRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smartmerge-cli-"));
  roots.push(root);
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "dev@example.com"]);
  await runGit(root, ["config", "user.name", "SmartMerge"]);
  await runGit(root, ["config", "commit.gpgsign", "false"]);
  await runGit(root, ["config", "core.autocrlf", "false"]);
  await writeFile(join(root, "clean.txt"), "clean\n");
  await runGit(root, ["add", "clean.txt"]);
  await runGit(root, ["commit", "-m", "base"]);
  return root;
}

async function conflictRepo(): Promise<string> {
  const root = await cleanRepo();
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
