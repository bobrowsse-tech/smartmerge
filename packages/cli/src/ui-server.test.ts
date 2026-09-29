import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { startUiServer, type UiServer } from "./ui-server.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const servers: UiServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => removeRoot(root)));
});

describe("local browser", () => {
  it("lists the conflict, accepts an explicit side, and does not apply automatically", async () => {
    const root = await textConflict();
    const server = await startUiServer(root, { port: 0 });
    servers.push(server);
    expect(server.url.startsWith("http://127.0.0.1:")).toBe(true);

    const dashboard = await fetch(`${server.url}/?theme=dark`).then((response) => response.text());
    expect(dashboard).toContain('data-theme="dark"');
    expect(dashboard).toContain("file.txt");
    expect(dashboard).toContain('href="/panel?path=file.txt&amp;theme=dark"');
    expect(dashboard).toContain("High contrast");

    const before = await readFile(join(root, "file.txt"));
    const safe = await fetch(`${server.url}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "applyAllSafe", next: "/" }),
    });
    expect(safe.status).toBe(200);
    const safePayload: unknown = await safe.json();
    expect(nextOf(safePayload)).toContain("notice=unchanged");
    expect(await readFile(join(root, "file.txt"))).toEqual(before);

    const panel = await fetch(`${server.url}/panel?path=file.txt`).then((response) =>
      response.text(),
    );
    expect(panel).toContain("current");
    expect(panel).toContain("incoming");
    expect(panel).toContain("All conflicts");
    const choice = alternative(panel, "manual-current");
    const accepted = await fetch(`${server.url}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "alternative",
        path: choice.path,
        hunkId: choice.hunkId,
        candidateId: choice.candidateId,
        next: "/panel?path=file.txt",
      }),
    });
    expect(accepted.status).toBe(200);
    const written = await readFile(join(root, "file.txt"), "utf8");
    expect(written).not.toContain("<<<<<<<");
    expect(written).toContain("current");

    const undone = await fetch(`${server.url}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "undo", next: "/" }),
    });
    expect(undone.status).toBe(200);
    expect(await readFile(join(root, "file.txt"), "utf8")).toContain("<<<<<<<");

    const missing = await fetch(`${server.url}/panel?path=../clean.txt`).then((response) =>
      response.text(),
    );
    expect(missing).toContain("That file is not conflicted.");
    expect(missing).not.toContain("clean\n");
  }, 30_000);
});

function nextOf(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || !("next" in payload)) {
    throw new Error("Missing next");
  }
  const next = payload.next;
  if (typeof next !== "string") throw new Error("Missing next");
  return next;
}

function alternative(
  html: string,
  idPart: string,
): { path: string; hunkId: string; candidateId: string } {
  const pattern =
    /data-action="alternative" data-path="([^"]*)" data-hunk="([^"]*)" data-candidate="([^"]*)"/g;
  for (const match of html.matchAll(pattern)) {
    const path = match[1];
    const hunkId = match[2];
    const candidateId = match[3];
    if (path !== undefined && hunkId !== undefined && candidateId?.includes(idPart)) {
      return { path, hunkId, candidateId };
    }
  }
  throw new Error(`No ${idPart} choice in the panel`);
}

async function textConflict(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smartmerge-ui-"));
  roots.push(root);
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "dev@example.com"]);
  await runGit(root, ["config", "user.name", "SmartMerge"]);
  await runGit(root, ["config", "commit.gpgsign", "false"]);
  await runGit(root, ["config", "core.autocrlf", "false"]);
  await writeFile(join(root, "clean.txt"), "clean\n");
  await runGit(root, ["add", "clean.txt"]);
  await runGit(root, ["commit", "-m", "base"]);
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
