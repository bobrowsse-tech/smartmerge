import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { listUnmerged } from "./run.js";

const execFileAsync = promisify(execFile);

/**
 * Skeleton latency probe for conflict discovery.
 * Regression gates against main arrive with the performance milestone.
 */
const root = await mkdtemp(join(tmpdir(), "smartmerge-bench-"));
try {
  await setup(root);
  const started = performance.now();
  const files = await listUnmerged(root);
  const ms = performance.now() - started;
  process.stdout.write(
    `${JSON.stringify({ operation: "discover-unmerged", files: files.length, ms: Number(ms.toFixed(3)) })}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

async function setup(cwd: string): Promise<void> {
  await run(cwd, ["init", "-b", "main"]);
  await run(cwd, ["config", "user.email", "dev@example.com"]);
  await run(cwd, ["config", "user.name", "SmartMerge"]);
  await run(cwd, ["config", "commit.gpgsign", "false"]);
  await run(cwd, ["config", "core.autocrlf", "false"]);
  await writeFile(join(cwd, "file.txt"), "base\n");
  await run(cwd, ["add", "file.txt"]);
  await run(cwd, ["commit", "-m", "base"]);
  await run(cwd, ["checkout", "-b", "incoming"]);
  await writeFile(join(cwd, "file.txt"), "incoming\n");
  await run(cwd, ["commit", "-am", "incoming"]);
  await run(cwd, ["checkout", "main"]);
  await writeFile(join(cwd, "file.txt"), "current\n");
  await run(cwd, ["commit", "-am", "current"]);
  await run(cwd, ["merge", "incoming"], [0, 1]);
}

async function run(cwd: string, args: string[], allowed: readonly number[] = [0]): Promise<void> {
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
