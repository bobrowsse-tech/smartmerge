import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runTests } from "@vscode/test-electron";

const execFileAsync = promisify(execFile);
const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * Launch an editor with the staged extension and a real two-file conflict.
 * The test project is a temporary git repository, removed when the run ends.
 */
const fixture = await mkdtemp(join(tmpdir(), "smartmerge-host-"));
let failed = false;
try {
  await conflictRepo(fixture);
  await runTests({
    extensionDevelopmentPath: join(packageRoot, ".pack"),
    extensionTestsPath: join(packageRoot, "dist", "host", "suite.js"),
    launchArgs: [
      fixture,
      `--user-data-dir=${join(shortProfile(), "data")}`,
      `--extensions-dir=${join(shortProfile(), "ext")}`,
      "--disable-gpu",
      "--disable-workspace-trust",
      "--disable-telemetry",
      "--skip-welcome",
      "--skip-release-notes",
    ],
  });
} catch (error) {
  failed = true;
  const message = error instanceof Error ? error.message : "editor host test failed";
  process.stderr.write(`${message}\n`);
} finally {
  await rm(fixture, { recursive: true, force: true });
}
if (failed) process.exit(1);

function shortProfile(): string {
  return process.platform === "win32" ? join(tmpdir(), "sm-host") : "/tmp/sm-host";
}

async function conflictRepo(root: string): Promise<void> {
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "dev@example.com"]);
  await git(root, ["config", "user.name", "SmartMerge"]);
  await git(root, ["config", "commit.gpgsign", "false"]);
  await git(root, ["config", "core.autocrlf", "false"]);
  await writeFile(join(root, "file.txt"), "value\n");
  await writeFile(join(root, "other.txt"), "value\n");
  await git(root, ["add", "file.txt", "other.txt"]);
  await git(root, ["commit", "-m", "base"]);
  await git(root, ["checkout", "-b", "topic"]);
  await writeFile(join(root, "file.txt"), "value\t\n");
  await writeFile(join(root, "other.txt"), "value\t\n");
  await git(root, ["add", "file.txt", "other.txt"]);
  await git(root, ["commit", "-m", "incoming"]);
  await git(root, ["checkout", "main"]);
  await writeFile(join(root, "file.txt"), "value \n");
  await writeFile(join(root, "other.txt"), "value \n");
  await git(root, ["add", "file.txt", "other.txt"]);
  await git(root, ["commit", "-m", "current"]);
  await git(root, ["merge", "topic"], [0, 1]);
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
