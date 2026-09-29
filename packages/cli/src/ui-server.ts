import { execFile, spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { UserAction } from "@smartmerge/protocol";
import { withDaemon } from "@smartmerge/daemon";
import {
  panelModel,
  renderDashboardDocument,
  renderPanelDocument,
  type DocumentTheme,
  type DocumentView,
} from "@smartmerge/ui";
import { loadConflicts } from "./session.js";

const execFileAsync = promisify(execFile);

const notices = {
  written: "The choice was written. The previous file is backed up.",
  unchanged: "Nothing was written. Automatic apply is off.",
  restored: "Restored the previous bytes.",
} as const;

type Notice = keyof typeof notices;

export interface UiServer {
  /** Local URL, including the bound port. */
  url: string;
  close(): Promise<void>;
}

/**
 * Serve the merge dashboard and conflict panel on the loopback interface.
 * Button actions are forwarded to the daemon. Automatic apply is not enabled.
 */
export async function startUiServer(start: string, options?: { port?: number }): Promise<UiServer> {
  const root = await gitRoot(start);
  const server = createServer((request, response) => {
    void handle(root, request, response);
  });
  const port = options?.port ?? 0;
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error): void => {
      reject(error);
    };
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", fail);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The local UI server did not bind a port.");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

/**
 * Print the local URL and serve until the process is interrupted.
 * The browser opens only when `open` is set.
 */
export async function serveUi(
  start: string,
  options: { port: number; open: boolean },
): Promise<void> {
  const server = await startUiServer(start, { port: options.port });
  process.stdout.write(`${server.url}\n`);
  if (options.open) openBrowser(server.url);
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await server.close();
}

async function handle(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/action") {
      try {
        await postAction(root, request, response);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The action failed.";
        if (!response.headersSent) sendJson(response, 400, { error: message.slice(0, 500) });
      }
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(response, 405, "Method not allowed.");
      return;
    }
    const theme = themeOf(url.searchParams.get("theme"));
    const notice = noticeText(url.searchParams.get("notice"));
    if (url.pathname === "/") {
      const loaded = await loadConflicts(root);
      const view = browserView("/", theme, notice, false);
      const html = renderDashboardDocument(loaded.summary, view);
      sendHtml(response, request.method === "HEAD" ? "" : html);
      return;
    }
    if (url.pathname === "/panel") {
      const path = url.searchParams.get("path") ?? "";
      const loaded = await loadConflicts(root);
      const index = selectedIndex(loaded.session, path);
      const view = browserView(`/panel?path=${encodeURIComponent(path)}`, theme, notice, true);
      if (index < 0) {
        sendHtml(response, errorDocument("That file is not conflicted.", view));
        return;
      }
      const html = renderPanelDocument(
        panelModel({
          connected: true,
          loading: false,
          applying: false,
          error: null,
          llmEnabled: false,
          offline: true,
          undoAvailable: false,
          session: loaded.session,
          selectedIndex: index,
        }),
        view,
      );
      sendHtml(response, request.method === "HEAD" ? "" : html);
      return;
    }
    sendText(response, 404, "Not found.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "The daemon failed.";
    sendHtml(response, errorDocument(message, { browser: true, pagePath: "/" }));
  }
}

async function postAction(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const message = parseAction(await readBody(request));
  const next = safeNext(message.next);
  let notice: Notice;
  if (message.action === "applyAllSafe") notice = await applySafe(root);
  else if (message.action === "undo") notice = await undo(root);
  else if (message.action === "accept" || message.action === "alternative") {
    if (message.path === null || message.hunkId === null || message.candidateId === null) {
      throw new Error("A file, hunk, and candidate are required.");
    }
    notice = await acceptChoice(root, message.path, message.hunkId, message.candidateId);
  } else {
    throw new Error("Unknown action.");
  }
  sendJson(response, 200, { next: withNotice(next, notice) });
}

async function applySafe(root: string): Promise<Notice> {
  return withDaemon(root, async (client): Promise<Notice> => {
    await client.initialize(root);
    const session = await client.listConflicts(root);
    const result = await client.act(
      session.sessionId,
      { type: "applyAllSafe", minBand: "certain" },
      { kind: "human" },
    );
    return result.log.length === 0 ? "unchanged" : "written";
  });
}

async function undo(root: string): Promise<Notice> {
  return withDaemon(root, async (client): Promise<Notice> => {
    await client.initialize(root);
    const session = await client.listConflicts(root);
    const result = await client.act(session.sessionId, { type: "undo" }, { kind: "human" });
    if (result.log.length === 0) throw new Error("Nothing to undo.");
    return "restored";
  });
}

async function acceptChoice(
  root: string,
  path: string,
  hunkId: string,
  candidateId: string,
): Promise<Notice> {
  return withDaemon(root, async (client): Promise<Notice> => {
    await client.initialize(root);
    const session = await client.listConflicts(root);
    const entry = session.files.find((item) => item.file.path === path);
    if (!entry) throw new Error(`No conflicted file at ${path}`);
    const proposals = await client.propose(session.sessionId, path);
    const proposal = proposals.find((item) => item.hunkId === hunkId);
    const candidate = proposal?.candidates.find((item) => item.id === candidateId);
    if (!proposal || !candidate) throw new Error("That choice is not one of the candidates.");
    const action: UserAction = {
      type: "accept",
      hunkId,
      candidateId,
      ...(candidate.hazardous ? { acceptHazardous: true } : {}),
    };
    await client.act(session.sessionId, action, { kind: "human" });
    return "written";
  });
}

function browserView(
  pagePath: string,
  theme: DocumentTheme | undefined,
  notice: string | undefined,
  showHome: boolean,
): DocumentView {
  const view: DocumentView = { browser: true, linkFiles: true, pagePath, showHome };
  if (theme !== undefined) view.theme = theme;
  if (notice !== undefined) view.notice = notice;
  return view;
}

function errorDocument(message: string, view: DocumentView): string {
  return renderPanelDocument(
    panelModel({
      connected: true,
      loading: false,
      applying: false,
      error: message,
      llmEnabled: false,
      offline: true,
      undoAvailable: false,
      session: null,
      selectedIndex: 0,
    }),
    view,
  );
}

function selectedIndex(session: LoadedSession, path: string): number {
  if (path.length === 0 || path.includes("..") || path.startsWith("/") || path.includes("\\")) {
    return -1;
  }
  let index = 0;
  for (const entry of session.files) {
    if (entry.file.path === path) return index;
    index += entry.file.hunks.length;
  }
  return -1;
}

type LoadedSession = Awaited<ReturnType<typeof loadConflicts>>["session"];

interface ActionMessage {
  action: string;
  path: string | null;
  hunkId: string | null;
  candidateId: string | null;
  next: string | null;
}

function parseAction(raw: string): ActionMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Expected an action object.");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("Expected an action object.");
  const record = parsed as Record<string, unknown>;
  const action = stringField(record, "action");
  if (action === null) throw new Error("An action is required.");
  return {
    action,
    path: stringField(record, "path"),
    hunkId: stringField(record, "hunkId"),
    candidateId: stringField(record, "candidateId"),
    next: stringField(record, "next"),
  };
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Expected ${key} to be a string.`);
  return value;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16_384) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function safeNext(value: string | null): string {
  if (value === null) return "/";
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("..")
  ) {
    return "/";
  }
  try {
    const url = new URL(value, "http://127.0.0.1");
    if (url.pathname !== "/" && url.pathname !== "/panel") return "/";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}

function withNotice(next: string, notice: Notice): string {
  const url = new URL(next, "http://127.0.0.1");
  url.searchParams.set("notice", notice);
  return `${url.pathname}${url.search}`;
}

function themeOf(value: string | null): DocumentTheme | undefined {
  if (value === "light" || value === "dark" || value === "contrast") return value;
  return undefined;
}

function noticeText(value: string | null): string | undefined {
  if (value === "written" || value === "unchanged" || value === "restored") return notices[value];
  return undefined;
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: { next?: string; error?: string },
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
}

async function gitRoot(start: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", start, "rev-parse", "--show-toplevel"], {
      windowsHide: true,
    });
    return await realpath(stdout.trim());
  } catch {
    throw new Error("Not a git repository.");
  }
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", windowsHide: true, detached: true });
  child.on("error", () => {
    // The URL is already printed. A missing opener does not stop the server.
  });
  child.unref();
}
