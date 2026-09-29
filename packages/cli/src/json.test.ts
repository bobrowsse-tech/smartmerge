import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeRoot(root)));
});

describe("json commands", () => {
  it("reports a conflict as JSON and exits 1", async () => {
    const root = await textConflict();
    const result = await runCli(root, ["status", "--json"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    const body = jsonBody(result.stdout);
    expect(body.protocolVersion).toBe("1.0.0");
    expect(JSON.stringify(body.result)).toContain("file.txt");
  });

  it("refuses a missing file with NOT_FOUND", async () => {
    const root = await textConflict();
    const result = await runCli(root, ["propose", "missing.txt", "--json"]);
    expect(result.code).toBe(2);
    const body = jsonBody(result.stdout);
    expect(body.error?.code).toBe("NOT_FOUND");
  });

  it("checks a dropped brace without writing the file", async () => {
    const root = await structuralConflict();
    const status = jsonBody((await runCli(root, ["status", "--json"])).stdout);
    const file = status.result?.files?.find((entry) => entry.file.path === "note.ts");
    const hunk = file?.file.hunks[0];
    if (!hunk) throw new Error("expected a TypeScript hunk");
    const broken = hunk.current.replace(/\}\s*$/, "");
    await writeFile(join(root, "broken.ts"), broken);
    const before = await readFile(join(root, "note.ts"), "utf8");
    const result = await runCli(root, [
      "verify",
      "note.ts",
      "--hunk",
      hunk.id,
      "--result-file",
      join(root, "broken.ts"),
      "--json",
    ]);
    expect(result.code).toBe(4);
    const body = jsonBody(result.stdout);
    expect(body.result?.hazardous).toBe(true);
    expect(body.result?.overall).toBe("fail");
    expect(body.result?.checks?.find((check) => check.kind === "types")?.status).toBe("unknown");
    expect(await readFile(join(root, "note.ts"), "utf8")).toBe(before);
    expect(before).toContain("<<<<<<<");
  });

  it("applies an explicit side and undo restores it", async () => {
    const root = await textConflict();
    const before = await readFile(join(root, "file.txt"));
    const status = jsonBody((await runCli(root, ["status", "--json"])).stdout);
    const candidate = status.result?.files?.[0]?.proposals
      .flatMap((proposal) => proposal.candidates)
      .find((item) => item.strategy === "manual-current");
    if (!candidate) throw new Error("expected a manual-current candidate");
    const applied = await runCli(root, [
      "apply",
      "file.txt",
      "--candidate",
      candidate.id,
      "--json",
    ]);
    expect(applied.code).toBe(0);
    const written = await readFile(join(root, "file.txt"), "utf8");
    expect(written).not.toContain("<<<<<<<");
    expect(written).toContain("current");
    const undone = await runCli(root, ["undo", "--json"]);
    expect(undone.code).toBe(0);
    expect(jsonBody(undone.stdout).result?.text).toContain("Restored");
    expect(await readFile(join(root, "file.txt"))).toEqual(before);
  });

  it("lists conflicts without opening a terminal", async () => {
    const root = await textConflict();
    const result = await runCli(root, ["resolve", "--json"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('"protocolVersion"');
    expect(result.stdout).not.toContain("\u001b");
  });
});

interface JsonEnvelope {
  protocolVersion?: string;
  error?: { code?: string };
  result?: {
    hazardous?: boolean;
    overall?: string;
    text?: string;
    checks?: Array<{ kind?: string; status?: string }>;
    files?: Array<{
      file: { path: string; hunks: Array<{ id: string; current: string }> };
      proposals: Array<{ candidates: Array<{ id: string; strategy: string }> }>;
    }>;
  };
}

function jsonBody(stdout: string): JsonEnvelope {
  return JSON.parse(stdout) as JsonEnvelope;
}

function runCli(
  repo: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repo,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end();
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      resolvePromise({
        code: code ?? 2,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

async function removeRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100 * (attempt + 1)));
    }
  }
}

async function cleanRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smartmerge-json-"));
  roots.push(root);
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "dev@example.com"]);
  await runGit(root, ["config", "user.name", "SmartMerge"]);
  await runGit(root, ["config", "commit.gpgsign", "false"]);
  await runGit(root, ["config", "core.autocrlf", "false"]);
  return root;
}

async function textConflict(): Promise<string> {
  const root = await cleanRepo();
  await writeFile(join(root, "file.txt"), "base\n");
  await runGit(root, ["add", "file.txt"]);
  await runGit(root, ["commit", "-m", "base"]);
  await runGit(root, ["checkout", "-b", "incoming"]);
  await writeFile(join(root, "file.txt"), "incoming\n");
  await runGit(root, ["commit", "-am", "incoming"]);
  await runGit(root, ["checkout", "main"]);
  await writeFile(join(root, "file.txt"), "current\n");
  await runGit(root, ["commit", "-am", "current"]);
  await runGit(root, ["merge", "incoming"], [0, 1]);
  return root;
}

async function structuralConflict(): Promise<string> {
  const root = await cleanRepo();
  const base = "function alpha() { return 1; }\nfunction beta() { return 1; }\n";
  await writeFile(join(root, "note.ts"), base);
  await runGit(root, ["add", "note.ts"]);
  await runGit(root, ["commit", "-m", "base"]);
  await runGit(root, ["checkout", "-b", "topic"]);
  await writeFile(
    join(root, "note.ts"),
    "function alpha() { return 1; }\nfunction beta() { return 3; }\n",
  );
  await runGit(root, ["commit", "-am", "incoming"]);
  await runGit(root, ["checkout", "main"]);
  await writeFile(
    join(root, "note.ts"),
    "function alpha() { return 2; }\nfunction beta() { return 1; }\n",
  );
  await runGit(root, ["commit", "-am", "current"]);
  await runGit(root, ["merge", "topic"], [0, 1]);
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
