import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { withDaemon } from "./client.js";

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeRoot(root)));
});

describe("dashboard", () => {
  it("returns a dashboard row for a proposed conflict", async () => {
    const root = await conflictRepo();
    await withDaemon(
      root,
      async (client) => {
        await client.initialize(root, "1.0.0");
        const session = await client.listConflicts(root);
        const path = session.files[0]?.file.path;
        if (!path) throw new Error("missing conflict");
        await client.propose(session.sessionId, path);
        const summary = await client.dashboard(session.sessionId);
        expect(summary.totals.files).toBe(1);
        expect(summary.rows[0]?.path).toBe("file.txt");
        expect(summary.rows[0]?.group).toBe("needs-review");
        expect(summary.totals.safeToAccept).toBe(0);
      },
      { scriptPath: script },
    );
  }, 30_000);
});

async function removeRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
      await new Promise((resolve) => {
        setTimeout(resolve, 100 * (attempt + 1));
      });
    }
  }
}

async function conflictRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smartmerge-dashboard-"));
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
  await writeFile(join(root, "file.txt"), "value \n");
  await git(root, ["add", "file.txt"]);
  await git(root, ["commit", "-m", "incoming"]);
  await git(root, ["checkout", "main"]);
  await writeFile(join(root, "file.txt"), "value\t\n");
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
