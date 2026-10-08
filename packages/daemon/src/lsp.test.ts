import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import { afterEach, describe, expect, it } from "vitest";
import { DaemonClient } from "./client.js";
import { shutdownRequest } from "./requests.js";

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const roots: string[] = [];

interface LspCommand {
  readonly title: string;
  readonly command: string;
  readonly arguments?: readonly unknown[];
}

interface LspCodeAction {
  readonly title: string;
  readonly command: LspCommand;
}

interface LspCodeLens {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number };
  };
  readonly command: LspCommand;
}

interface LspDiagnostic {
  readonly message: string;
  readonly source: string;
  readonly severity: number;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeRoot(root)));
});

describe("language server facade", () => {
  it("exits 2 and names both modes when no mode flag is set", async () => {
    const result = await runUntilExit([]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--stdio");
    expect(result.stderr).toContain("--lsp");
  });

  it("exits 2 when both mode flags are set", async () => {
    const result = await runUntilExit(["--stdio", "--lsp"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--stdio");
    expect(result.stderr).toContain("--lsp");
  });

  it("still answers daemon initialize on --stdio", async () => {
    const root = await repoWithConflict("note.ts", sides("return 2", "return 3"));
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
      const result = await client.initialize(root, "1.0.0");
      expect(result.protocolVersion).toBe("1.0.0");
      await connection.sendRequest(shutdownRequest);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      connection.dispose();
    }
  });

  it("advertises code actions, code lenses, and commands", async () => {
    const root = await repoWithConflict("note.ts", sides("return 2", "return 3"));
    const session = openLsp(root);
    try {
      const result = await session.connection.sendRequest<{
        capabilities: {
          codeActionProvider?: boolean;
          codeLensProvider?: object;
          executeCommandProvider?: { commands: string[] };
        };
      }>("initialize", initializeParams(root));
      expect(result.capabilities.codeActionProvider).toBe(true);
      expect(result.capabilities.codeLensProvider).toBeDefined();
      expect(result.capabilities.executeCommandProvider?.commands).toEqual([
        "accept",
        "edit",
        "undo",
        "applyAllSafe",
        "reject",
      ]);
    } finally {
      await session.close();
    }
  });

  it("accepts one side through a code action and undo restores the conflict", async () => {
    const current = "function alpha() {\n  return 2;\n}\n";
    const root = await repoWithConflict("note.ts", {
      base: "function alpha() {\n  return 1;\n}\n",
      current,
      incoming: "function alpha() {\n  return 3;\n}\n",
    });
    const session = openLsp(root);
    try {
      await session.connection.sendRequest("initialize", initializeParams(root));
      const uri = pathToFileURL(path.join(root, "note.ts")).href;
      const actions = await session.connection.sendRequest<LspCodeAction[]>(
        "textDocument/codeAction",
        documentParams(uri),
      );
      const chosen =
        actions.find((item) => item.title === "Accept recommended") ??
        actions.find((item) => item.title === "Accept ours");
      expect(chosen?.command.command).toBe("accept");
      await session.connection.sendRequest("workspace/executeCommand", {
        command: chosen?.command.command,
        arguments: chosen?.command.arguments ?? [],
      });
      const accepted = await readFile(path.join(root, "note.ts"), "utf8");
      expect(accepted).not.toContain("<<<<<<<");
      await session.connection.sendRequest("workspace/executeCommand", { command: "undo" });
      const restored = await readFile(path.join(root, "note.ts"), "utf8");
      expect(restored).toContain("<<<<<<<");
    } finally {
      await session.close();
    }
  });

  it("returns one code lens for the conflicted hunk", async () => {
    const root = await repoWithConflict("note.ts", sides("return 2", "return 3"));
    const session = openLsp(root);
    try {
      await session.connection.sendRequest("initialize", initializeParams(root));
      const uri = pathToFileURL(path.join(root, "note.ts")).href;
      const lenses = await session.connection.sendRequest<LspCodeLens[]>(
        "textDocument/codeLens",
        documentParams(uri),
      );
      expect(lenses).toHaveLength(1);
      const lens = lenses[0];
      expect(lens?.range.start.line).toBeGreaterThanOrEqual(0);
      expect(lens?.range.start.character).toBe(0);
      expect(lens?.range.end.line).toBeGreaterThanOrEqual(lens?.range.start.line ?? 0);
      expect(lens?.command.title.length).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  });

  it("publishes fail diagnostics the daemon returned for a broken combined result", async () => {
    const root = await repoWithConflict("note.ts", {
      base: "export const n: number = 0;\n",
      current: "export const n: number = 1;\n",
      incoming: "export const n: number = 2;\n",
    });
    const session = openLsp(root);
    try {
      await session.connection.sendRequest("initialize", initializeParams(root));
      const uri = pathToFileURL(path.join(root, "note.ts")).href;
      const pending = session.nextDiagnostics();
      await session.connection.sendRequest("textDocument/codeLens", documentParams(uri));
      const diagnostics = await pending;
      expect(diagnostics.length).toBeGreaterThan(0);
      for (const item of diagnostics) {
        expect(item.message.length).toBeGreaterThan(0);
        expect(item.source.length).toBeGreaterThan(0);
        expect(item.severity).toBeGreaterThan(0);
      }
    } finally {
      await session.close();
    }
  }, 60_000);
});

function sides(
  currentBody: string,
  incomingBody: string,
): {
  base: string;
  current: string;
  incoming: string;
} {
  return {
    base: "function alpha() {\n  return 1;\n}\n",
    current: `function alpha() {\n  ${currentBody};\n}\n`,
    incoming: `function alpha() {\n  ${incomingBody};\n}\n`,
  };
}

function initializeParams(root: string): {
  processId: number;
  rootUri: string;
  capabilities: Record<string, never>;
  clientInfo: { name: string; version: string };
} {
  return {
    processId: process.pid,
    rootUri: pathToFileURL(root).href,
    capabilities: {},
    clientInfo: { name: "lsp-test", version: "0.0.0" },
  };
}

function documentParams(uri: string): {
  textDocument: { uri: string };
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  context: { diagnostics: readonly [] };
} {
  return {
    textDocument: { uri },
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
    context: { diagnostics: [] },
  };
}

function openLsp(root: string): {
  connection: MessageConnection;
  close: () => Promise<void>;
  nextDiagnostics: () => Promise<readonly LspDiagnostic[]>;
} {
  const child = spawn(process.execPath, [script, "--lsp"], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
  });
  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );
  const diagnostics = new Deferred<readonly LspDiagnostic[]>();
  connection.onNotification(
    "textDocument/publishDiagnostics",
    (params: { diagnostics?: readonly LspDiagnostic[] }) => {
      diagnostics.resolve(params.diagnostics ?? []);
    },
  );
  connection.listen();
  return {
    connection,
    nextDiagnostics: () => diagnostics.promise,
    close: async () => {
      const exited = new Promise<void>((resolve) => {
        child.once("exit", () => {
          resolve();
        });
      });
      try {
        await connection.sendRequest("shutdown");
        await connection.sendNotification("exit");
      } catch {
        // The process can exit as soon as it receives exit.
      }
      await Promise.race([
        exited,
        new Promise<void>((resolve) => {
          setTimeout(resolve, 2000);
        }),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill();
      connection.dispose();
      if (child.exitCode !== null && child.exitCode !== 0 && stderr.length > 0) {
        process.stderr.write(Buffer.concat(stderr));
      }
    },
  };
}

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void = () => undefined;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }
}

async function runUntilExit(
  args: readonly string[],
): Promise<{ code: number | null; stderr: string }> {
  const child = spawn(process.execPath, [script, ...args], {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  const chunks: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  const code = await new Promise<number | null>((resolve) => {
    child.once("exit", (exitCode) => {
      resolve(exitCode);
    });
  });
  return { code, stderr: Buffer.concat(chunks).toString("utf8") };
}

async function repoWithConflict(
  name: string,
  texts: { base: string; current: string; incoming: string },
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "smartmerge-lsp-"));
  roots.push(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "dev@example.com"]);
  await git(root, ["config", "user.name", "SmartMerge"]);
  await git(root, ["config", "commit.gpgsign", "false"]);
  await git(root, ["config", "core.autocrlf", "false"]);
  await writeFile(path.join(root, name), texts.base);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "base"]);
  await git(root, ["checkout", "-b", "topic"]);
  await writeFile(path.join(root, name), texts.incoming);
  await git(root, ["add", name]);
  await git(root, ["commit", "-m", "incoming"]);
  await git(root, ["checkout", "main"]);
  await writeFile(path.join(root, name), texts.current);
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
