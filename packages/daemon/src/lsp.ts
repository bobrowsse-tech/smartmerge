import { realpath } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import type {
  Candidate,
  ConflictFile,
  ConflictSession,
  Diagnostic,
  Range,
  ResolutionProposal,
  UserAction,
} from "@smartmerge/protocol";
import { ErrorCodes, ResponseError } from "vscode-jsonrpc/node";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import { DaemonServer } from "./server.js";

interface LspPosition {
  readonly line: number;
  readonly character: number;
}

interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

interface LspInitializeParams {
  readonly rootUri?: string | null;
  readonly workspaceFolders?: readonly { readonly uri: string }[] | null;
  readonly clientInfo?: { readonly name?: string; readonly version?: string };
}

interface LspTextDocumentParams {
  readonly textDocument: { readonly uri: string };
}

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
  readonly range: LspRange;
  readonly command: LspCommand;
}

interface LspDiagnostic {
  readonly range: LspRange;
  readonly severity: number;
  readonly message: string;
  readonly source: string;
}

/**
 * Speak a small language-server session on stdio.
 * Each method calls `DaemonServer`. This process does not merge or score.
 */
export function startLspServer(): void {
  const connection = createMessageConnection(
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout),
  );
  const server = new DaemonServer();
  const facade = new LspFacade(server, connection);
  facade.listen();
  connection.listen();
  process.stdin.on("end", () => {
    void server.shutdown();
  });
}

class LspFacade {
  private repoRoot: string | null = null;
  private sessionReady: Promise<ConflictSession> | null = null;

  constructor(
    private readonly server: DaemonServer,
    private readonly connection: MessageConnection,
  ) {}

  listen(): void {
    this.connection.onRequest("initialize", (params: LspInitializeParams) =>
      this.initialize(params),
    );
    this.connection.onNotification("initialized", () => undefined);
    this.connection.onRequest("textDocument/codeAction", (params: LspTextDocumentParams) =>
      this.codeAction(params),
    );
    this.connection.onRequest("textDocument/codeLens", (params: LspTextDocumentParams) =>
      this.codeLens(params),
    );
    this.connection.onRequest(
      "workspace/executeCommand",
      (params: { command?: string; arguments?: readonly unknown[] }) => this.execute(params),
    );
    this.connection.onRequest("shutdown", () => this.server.shutdown());
    this.connection.onNotification("exit", () => {
      process.exit(0);
    });
  }

  private initialize(params: LspInitializeParams): {
    capabilities: {
      codeActionProvider: true;
      codeLensProvider: Record<string, never>;
      executeCommandProvider: { commands: readonly string[] };
    };
  } {
    const root = filePath(params.rootUri ?? params.workspaceFolders?.[0]?.uri ?? null);
    if (root !== null && root.trim().length > 0) {
      this.repoRoot = root;
      this.server.initialize({
        clientName: params.clientInfo?.name ?? "lsp",
        clientVersion: params.clientInfo?.version ?? "0.0.0",
        protocolRange: "1.0.0",
        repoRoot: root,
        workspaceTrusted: true,
        capabilities: { supportsWebview: false, supportsDiagnostics: true },
      });
    }
    return {
      capabilities: {
        codeActionProvider: true,
        codeLensProvider: {},
        executeCommandProvider: {
          commands: ["accept", "edit", "undo", "applyAllSafe", "reject"],
        },
      },
    };
  }

  private async codeAction(params: LspTextDocumentParams): Promise<LspCodeAction[]> {
    const opened = await this.open(params.textDocument.uri);
    if (opened === null) return [];
    const proposals = await this.server.propose({
      sessionId: opened.session.sessionId,
      path: opened.path,
    });
    await this.publish(opened, proposals);
    const actions: LspCodeAction[] = [];
    for (const proposal of proposals) {
      actions.push(...actionsFor(opened.file, proposal));
    }
    return actions;
  }

  private async codeLens(params: LspTextDocumentParams): Promise<LspCodeLens[]> {
    const opened = await this.open(params.textDocument.uri);
    if (opened === null) return [];
    const proposals = await this.server.propose({
      sessionId: opened.session.sessionId,
      path: opened.path,
    });
    await this.publish(opened, proposals);
    return opened.file.hunks.flatMap((hunk) => {
      const proposal = proposals.find((item) => item.hunkId === hunk.id);
      if (!proposal) return [];
      return [lensFor(hunk.range, proposal)];
    });
  }

  private async execute(params: {
    command?: string;
    arguments?: readonly unknown[];
  }): Promise<unknown> {
    const command = params.command ?? "";
    const action = readAction(command, params.arguments);
    const session = await this.rememberedSession();
    return this.server.act({ sessionId: session.sessionId, action });
  }

  private async open(
    uri: string,
  ): Promise<{ session: ConflictSession; file: ConflictFile; path: string } | null> {
    if (this.repoRoot === null) return null;
    const session = await this.rememberedSession();
    const repoPath = await relativeRepoPath(session.repoRoot, uri);
    if (repoPath === null) return null;
    const row = session.files.find((item) => posix(item.file.path) === repoPath);
    if (!row) return null;
    return { session, file: row.file, path: row.file.path };
  }

  private rememberedSession(): Promise<ConflictSession> {
    if (this.repoRoot === null) {
      return Promise.reject(
        new ResponseError(ErrorCodes.ServerNotInitialized, "Call initialize first"),
      );
    }
    const root = this.repoRoot;
    this.sessionReady ??= this.server.listConflicts({ repoRoot: root }).catch((error: unknown) => {
      this.sessionReady = null;
      throw error;
    });
    return this.sessionReady;
  }

  private async publish(
    opened: { session: ConflictSession; path: string },
    proposals: readonly ResolutionProposal[],
  ): Promise<void> {
    const diagnostics: LspDiagnostic[] = [];
    for (const proposal of proposals) {
      for (const candidate of proposal.candidates) {
        const verified = await this.server.verify({
          sessionId: opened.session.sessionId,
          path: opened.path,
          hunkId: proposal.hunkId,
          resultText: candidate.result,
        });
        for (const check of verified.checks) {
          if (check.status !== "fail") continue;
          for (const item of check.diagnostics) {
            if (item.preExisting) continue;
            diagnostics.push(lspDiagnostic(item));
          }
        }
      }
    }
    const uri = pathToFileUri(opened.session.repoRoot, opened.path);
    void this.connection.sendNotification("textDocument/publishDiagnostics", { uri, diagnostics });
  }
}

function actionsFor(file: ConflictFile, proposal: ResolutionProposal): LspCodeAction[] {
  const actions: LspCodeAction[] = [];
  const recommended = proposal.candidates.find((item) => item.id === proposal.recommended);
  if (recommended !== undefined && !recommended.hazardous) {
    actions.push(acceptAction("Accept recommended", proposal.hunkId, recommended.id));
  }
  const ours = manualForRole(file, proposal, "ours");
  if (ours !== undefined) actions.push(acceptAction("Accept ours", proposal.hunkId, ours.id));
  const theirs = manualForRole(file, proposal, "theirs");
  if (theirs !== undefined) actions.push(acceptAction("Accept theirs", proposal.hunkId, theirs.id));
  return actions;
}

function manualForRole(
  file: ConflictFile,
  proposal: ResolutionProposal,
  role: "ours" | "theirs",
): Candidate | undefined {
  const strategy =
    file.operation.current.role === role
      ? "manual-current"
      : file.operation.incoming.role === role
        ? "manual-incoming"
        : null;
  if (strategy === null) return undefined;
  return proposal.candidates.find((item) => item.strategy === strategy);
}

function acceptAction(title: string, hunkId: string, candidateId: string): LspCodeAction {
  const action: UserAction = { type: "accept", hunkId, candidateId };
  return { title, command: { title, command: "accept", arguments: [action] } };
}

function lensFor(range: Range, proposal: ResolutionProposal): LspCodeLens {
  const recommended = proposal.candidates.find((item) => item.id === proposal.recommended);
  const title =
    recommended === undefined
      ? "No recommendation yet"
      : `${proposal.explanation.headline} ${String(recommended.confidence)}`;
  const command: LspCommand =
    recommended !== undefined && !recommended.hazardous
      ? {
          title,
          command: "accept",
          arguments: [{ type: "accept", hunkId: proposal.hunkId, candidateId: recommended.id }],
        }
      : { title, command: "" };
  return { range: lspRange(range), command };
}

function lspDiagnostic(item: Diagnostic): LspDiagnostic {
  return {
    range: lspRange(item.range),
    severity: item.severity === "warning" ? 2 : item.severity === "info" ? 3 : 1,
    message: item.message,
    source: item.source,
  };
}

function lspRange(range: Range): LspRange {
  return {
    start: { line: Math.max(0, range.startLine - 1), character: 0 },
    end: { line: Math.max(0, range.endLine), character: 0 },
  };
}

function readAction(command: string, args: readonly unknown[] | undefined): UserAction {
  const first = args?.[0];
  if (isUserAction(first)) return first;
  if (command === "undo") return { type: "undo" };
  if (command === "applyAllSafe") return { type: "applyAllSafe", minBand: "high" };
  if (command === "edit") {
    throw new ResponseError(ErrorCodes.InvalidParams, "edit requires hunkId and text");
  }
  if (command === "reject") {
    throw new ResponseError(ErrorCodes.InvalidParams, "reject requires hunkId");
  }
  if (command === "accept") {
    throw new ResponseError(ErrorCodes.InvalidParams, "accept requires hunkId and candidateId");
  }
  throw new ResponseError(ErrorCodes.InvalidParams, `Unknown command ${command}`);
}

function isUserAction(value: unknown): value is UserAction {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "undo") return true;
  if (value.type === "accept") {
    return typeof value.hunkId === "string" && typeof value.candidateId === "string";
  }
  if (value.type === "edit")
    return typeof value.hunkId === "string" && typeof value.text === "string";
  if (value.type === "reject") return typeof value.hunkId === "string";
  if (value.type === "applyAllSafe") {
    return (
      value.minBand === "certain" ||
      value.minBand === "high" ||
      value.minBand === "medium" ||
      value.minBand === "low"
    );
  }
  if (value.type === "markResolved") {
    return typeof value.path === "string" && typeof value.gitAdd === "boolean";
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function filePath(uri: string | null): string | null {
  if (uri === null || !uri.startsWith("file:")) return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

async function relativeRepoPath(repoRoot: string, uri: string): Promise<string | null> {
  const absolute = filePath(uri);
  if (absolute === null) return null;
  // Git reports a resolved root. A document URI can still use a symlink, such as a temp directory.
  const root = await resolvePath(repoRoot);
  const target = await resolvePath(absolute);
  const fromRoot = path.relative(root, target);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) return null;
  return posix(fromRoot);
}

async function resolvePath(value: string): Promise<string> {
  try {
    return await realpath(value);
  } catch {
    return value;
  }
}

function pathToFileUri(repoRoot: string, repoPath: string): string {
  return pathToFileURL(path.join(repoRoot, repoPath)).href;
}

function posix(value: string): string {
  return value.split("\\").join("/");
}
