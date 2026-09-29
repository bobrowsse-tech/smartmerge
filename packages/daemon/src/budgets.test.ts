import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { afterEach, describe, expect, it } from "vitest";
import { DaemonClient, withDaemon } from "./client.js";
import { shutdownRequest } from "./requests.js";

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("speed budgets", () => {
  it("starts the daemon in under 400 ms", async () => {
    const root = await repoWithConflict("note.ts");
    const samples: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const started = performance.now();
      await withDaemon(
        root,
        async (client) => {
          await client.initialize(root, "1.0.0");
          samples.push(performance.now() - started);
        },
        { scriptPath: script },
      );
    }
    samples.sort((left, right) => left - right);
    const typical = samples[3];
    expect(typical ?? Number.POSITIVE_INFINITY).toBeLessThan(limit(400, 1200));
  }, 30_000);

  it("lists conflicts in a 1000-file repository in under 500 ms", async () => {
    const root = await repoWithConflict("file.txt", 1000);
    let elapsed = Number.POSITIVE_INFINITY;
    await withDaemon(
      root,
      async (client) => {
        await client.initialize(root, "1.0.0");
        const started = performance.now();
        const session = await client.listConflicts(root);
        elapsed = performance.now() - started;
        expect(session.stats.total).toBe(1);
      },
      { scriptPath: script },
    );
    expect(elapsed).toBeLessThan(limit(500, 1500));
  }, 60_000);

  it("proposes a checked result in under 300 ms and checks stay under 150 ms", async () => {
    const root = await repoWithConflict("note.ts");
    await withDaemon(
      root,
      async (client) => {
        await client.initialize(root, "1.0.0");
        const session = await client.listConflicts(root);
        const path = session.files[0]?.file.path;
        if (!path) throw new Error("missing conflict");
        await client.propose(session.sessionId, path);
        const started = performance.now();
        const proposals = await client.propose(session.sessionId, path);
        expect(performance.now() - started).toBeLessThan(300);
        const checks = proposals[0]?.candidates[0]?.checks ?? [];
        expect(checks.length).toBeGreaterThan(0);
        for (const check of checks) expect(check.durationMs).toBeLessThan(150);
      },
      { scriptPath: script },
    );
  }, 30_000);

  it("stays under 150 MB after startup", async () => {
    const root = await repoWithConflict("file.txt");
    const child = spawn(process.execPath, [script, "--stdio"], {
      cwd: root,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    connection.listen();
    try {
      const client = new DaemonClient(connection);
      await client.initialize(root, "1.0.0");
      if (child.pid === undefined) throw new Error("daemon pid is missing");
      expect(await residentMb(child.pid)).toBeLessThan(150);
      await connection.sendRequest(shutdownRequest);
    } finally {
      child.kill();
    }
  }, 60_000);
});

/** Specification budget on Linux. Other runners get a wider allowance for process startup. */
function limit(specMs: number, runnerMs: number): number {
  return process.platform === "linux" ? specMs : runnerMs;
}

async function residentMb(pid: number): Promise<number> {
  if (process.platform === "linux") {
    const text = await readFile(`/proc/${String(pid)}/status`, "utf8");
    const line = text.split("\n").find((item) => item.startsWith("VmRSS:"));
    return Number(line?.split(/\s+/)[1] ?? "NaN") / 1024;
  }
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `(Get-Process -Id ${String(pid)}).WorkingSet64 / 1MB`,
    ]);
    return Number(stdout.trim());
  }
  const { stdout } = await execFileAsync("ps", ["-o", "rss=", "-p", String(pid)]);
  return Number(stdout.trim()) / 1024;
}

async function repoWithConflict(name: string, extraFiles = 0): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smartmerge-budget-"));
  roots.push(root);
  const typescript = name.endsWith(".ts");
  const base = typescript ? "function alpha() {\n  return 1;\n}\n" : "value\n";
  const current = typescript ? "function alpha() {\n  return 2;\n}\n" : "value \n";
  const incoming = typescript ? "function alpha() {\n  return 3;\n}\n" : "value\t\n";
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "dev@example.com"]);
  await git(root, ["config", "user.name", "SmartMerge"]);
  await git(root, ["config", "commit.gpgsign", "false"]);
  await git(root, ["config", "core.autocrlf", "false"]);
  await writeFile(join(root, name), base);
  for (let index = 0; index < extraFiles; index += 1) {
    await writeFile(join(root, `extra-${String(index)}.txt`), "ok\n");
  }
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "base"]);
  await git(root, ["checkout", "-b", "topic"]);
  await writeFile(join(root, name), incoming);
  await git(root, ["add", name]);
  await git(root, ["commit", "-m", "incoming"]);
  await git(root, ["checkout", "main"]);
  await writeFile(join(root, name), current);
  await git(root, ["add", name]);
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
