import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { installMergetool, resolveAuto, resolveInteractive } from "./resolve.js";

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeRoot(root)));
});

describe("git mergetool", () => {
  it("applies a certain resolution and leaves an uncertain file unresolved", async () => {
    const certain = await structuralRepo();
    const applied = await resolveAuto(certain);
    expect(applied.code).toBe(0);
    const text = await readFile(join(certain, "note.ts"), "utf8");
    expect(text).not.toContain("<<<<<<<");
    expect(text).toContain("return 2");
    expect(text).toContain("return 3");

    const uncertain = await textConflict();
    const before = await readFile(join(uncertain, "file.txt"));
    const skipped = await resolveAuto(uncertain);
    expect(skipped.code).toBe(1);
    expect(skipped.text).toContain("Nothing was written");
    expect(await readFile(join(uncertain, "file.txt"))).toEqual(before);
  }, 30_000);

  it("exits 0 from mergetool when the file is resolved and 1 when it is not", async () => {
    const certain = await structuralRepo();
    const resolved = await runCli(certain, [
      "mergetool",
      join(certain, "note.ts"),
      join(certain, "note.ts"),
      join(certain, "note.ts"),
      join(certain, "note.ts"),
    ]);
    expect(resolved.code).toBe(0);
    expect(await readFile(join(certain, "note.ts"), "utf8")).not.toContain("<<<<<<<");

    const uncertain = await textConflict();
    const left = await runCli(uncertain, [
      "mergetool",
      join(uncertain, "file.txt"),
      join(uncertain, "file.txt"),
      join(uncertain, "file.txt"),
      join(uncertain, "file.txt"),
    ]);
    expect(left.code).toBe(1);
    expect(await readFile(join(uncertain, "file.txt"), "utf8")).toContain("<<<<<<<");
  }, 30_000);

  it("does not wait for input when there is no terminal", async () => {
    const root = await textConflict();
    const result = await runCli(root, ["resolve"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Pass --auto");
    expect(await readFile(join(root, "file.txt"), "utf8")).toContain("<<<<<<<");
  }, 30_000);

  it("accepts a recommendation from a terminal answer", async () => {
    const root = await structuralRepo();
    const result = await resolveInteractive(root, "note.ts", true, () => Promise.resolve("y"));
    expect(result.code).toBe(0);
    expect(await readFile(join(root, "note.ts"), "utf8")).not.toContain("<<<<<<<");
  }, 30_000);

  it("writes repository mergetool config and git trusts the exit code", async () => {
    const root = await structuralRepo();
    expect(await installMergetool(root)).toContain("trust its exit code");
    expect(await gitValue(root, "merge.tool")).toBe("smartmerge");
    expect(await gitValue(root, "mergetool.smartmerge.trustExitCode")).toBe("true");
    const cmd = `"${process.execPath}" "${script}" mergetool "$BASE" "$LOCAL" "$REMOTE" "$MERGED"`;
    await runGit(root, ["config", "mergetool.smartmerge.cmd", cmd]);
    await runGit(root, ["mergetool", "--no-prompt", "note.ts"]);
    expect(await readFile(join(root, "note.ts"), "utf8")).not.toContain("<<<<<<<");
    const unmerged = await execFileAsync("git", ["diff", "--name-only", "--diff-filter=U"], {
      cwd: root,
      windowsHide: true,
    });
    expect(unmerged.stdout.trim()).toBe("");
  }, 30_000);
});

async function gitValue(repo: string, key: string): Promise<string> {
  const result = await execFileAsync("git", ["config", "--get", key], {
    cwd: repo,
    windowsHide: true,
  });
  return result.stdout.trim();
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
  const root = await mkdtemp(join(tmpdir(), "smartmerge-mergetool-"));
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

async function textConflict(): Promise<string> {
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

async function structuralRepo(): Promise<string> {
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
