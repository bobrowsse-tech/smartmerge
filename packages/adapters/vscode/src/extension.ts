import { performance } from "node:perf_hooks";
import { join, relative } from "node:path";
import { withDaemon } from "@smartmerge/daemon";
import { daemonScript } from "./daemon-path.js";
import { panelModel, renderPanelDocument } from "@smartmerge/ui";
import * as vscode from "vscode";
import {
  codeLensTitle,
  problemEntries,
  statusBarText,
  stepConflictIndex,
  type ProblemEntry,
} from "./present.js";
import { acceptFile, undoFile } from "./resolve.js";

interface PanelMessage {
  action?: string;
  candidateId?: string | null;
  hunkId?: string | null;
  path?: string | null;
}

let panelRef: vscode.WebviewPanel | undefined;
let selectedIndex = 0;
let selectedPath: string | null = null;

/** Editor entry. It renders daemon state and forwards commands. The daemon starts on the first command. */
export function activate(context: vscode.ExtensionContext): void {
  const started = performance.now();
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const problems = vscode.languages.createDiagnosticCollection("smartmerge");
  bar.command = "smartmerge.openPanel";
  bar.text = "SmartMergeResolver";
  bar.show();
  context.subscriptions.push(
    bar,
    problems,
    vscode.commands.registerCommand("smartmerge.refresh", () => refresh(bar, problems)),
    vscode.commands.registerCommand("smartmerge.openPanel", () => openPanel(0)),
    vscode.commands.registerCommand("smartmerge.nextConflict", () => openPanel(1)),
    vscode.commands.registerCommand("smartmerge.previousConflict", () => openPanel(-1)),
    vscode.commands.registerCommand("smartmerge.currentConflict", () => selectedPath),
    vscode.commands.registerCommand("smartmerge.acceptFile", (filePath?: string, hunkId?: string) =>
      accept(filePath, hunkId === undefined ? undefined : { hunkId }),
    ),
    vscode.commands.registerCommand("smartmerge.undo", () => undo()),
    vscode.commands.registerCommand("smartmerge.explain", () => openPanel(0)),
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, { provideCodeLenses }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.uri.scheme === "file" && document.getText().includes("<<<<<<<")) {
        void refresh(bar, problems);
      }
    }),
  );
  const mark = globalThis as { smartmergeActivationMs?: number };
  mark.smartmergeActivationMs = performance.now() - started;
}

export function deactivate(): void {
  /* The daemon is started per command and does not need a shutdown hook. */
}

async function refresh(
  bar: vscode.StatusBarItem,
  problems: vscode.DiagnosticCollection,
): Promise<void> {
  const root = repoRoot();
  if (!root) {
    bar.text = statusBarText(0, 0, false);
    problems.clear();
    return;
  }
  try {
    await withDaemon(
      root,
      async (client) => {
        await client.initialize(root, "1.0.0", {
          clientName: "smartmerge-editor",
          workspaceTrusted: vscode.workspace.isTrusted,
          supportsWebview: true,
          supportsDiagnostics: true,
        });
        const session = await client.listConflicts(root);
        bar.text = statusBarText(session.stats.total, session.stats.autoResolvable, true);
        problems.clear();
        for (const entry of session.files) {
          const proposals = await client.propose(session.sessionId, entry.file.path);
          publishProblems(problems, root, problemEntries(proposals));
        }
      },
      { scriptPath: daemonScript() },
    );
  } catch {
    bar.text = statusBarText(0, 0, false);
    problems.clear();
  }
}

async function openPanel(delta: number): Promise<string | null> {
  const root = repoRoot();
  const panel = ensurePanel();
  if (!root) {
    panel.webview.html = renderPanelDocument(
      panelModel({
        connected: false,
        loading: false,
        applying: false,
        error: null,
        llmEnabled: false,
        offline: true,
        undoAvailable: false,
        session: null,
        selectedIndex: 0,
      }),
    );
    selectedPath = null;
    return null;
  }
  panel.webview.html = renderPanelDocument(
    panelModel({
      connected: true,
      loading: true,
      applying: false,
      error: null,
      llmEnabled: false,
      offline: true,
      undoAvailable: false,
      session: null,
      selectedIndex,
    }),
  );
  try {
    await withDaemon(
      root,
      async (client) => {
        await client.initialize(root, "1.0.0", {
          clientName: "smartmerge-editor",
          workspaceTrusted: vscode.workspace.isTrusted,
          supportsWebview: true,
        });
        const session = await client.listConflicts(root);
        for (const entry of session.files) {
          entry.proposals = await client.propose(session.sessionId, entry.file.path);
        }
        const paths = hunkPaths(session);
        selectedIndex = stepConflictIndex(selectedIndex, delta, paths.length);
        selectedPath = paths[selectedIndex] ?? null;
        panel.webview.html = renderPanelDocument(
          panelModel({
            connected: true,
            loading: false,
            applying: false,
            error: null,
            llmEnabled: false,
            offline: true,
            undoAvailable: false,
            session,
            selectedIndex,
          }),
        );
      },
      { scriptPath: daemonScript() },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The daemon failed.";
    panel.webview.html = renderPanelDocument(
      panelModel({
        connected: true,
        loading: false,
        applying: false,
        error: message,
        llmEnabled: false,
        offline: true,
        undoAvailable: false,
        session: null,
        selectedIndex,
      }),
    );
    return selectedPath;
  }
  return selectedPath;
}

async function accept(
  filePath?: string,
  choice?: { hunkId?: string; candidateId?: string },
): Promise<void> {
  const root = repoRoot();
  const path = filePath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!root || !path) return;
  const relativePath = path.startsWith(root) ? relative(root, path) : path;
  const applied = await acceptFile(
    root,
    relativePath.replaceAll("\\", "/"),
    vscode.workspace.isTrusted,
    choice,
  );
  if (applied)
    void vscode.window.showInformationMessage("Accepted the recommendation. Undo is available.");
}

async function undo(): Promise<void> {
  const root = repoRoot();
  if (!root) return;
  await undoFile(root);
  void vscode.window.showInformationMessage("Restored the previous bytes.");
}

async function provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
  const root = repoRoot();
  if (!root || document.uri.scheme !== "file") return [];
  const path = relative(root, document.uri.fsPath).replaceAll("\\", "/");
  return withDaemon(
    root,
    async (client) => {
      await client.initialize(root, "1.0.0", {
        clientName: "smartmerge-editor",
        workspaceTrusted: vscode.workspace.isTrusted,
        supportsWebview: true,
      });
      const session = await client.listConflicts(root);
      const entry = session.files.find((item) => item.file.path === path);
      if (!entry) return [];
      const proposals = await client.propose(session.sessionId, path);
      return entry.file.hunks
        .map((hunk) => {
          const proposal = proposals.find((item) => item.hunkId === hunk.id);
          const line = Math.max(0, hunk.range.startLine - 1);
          const range = new vscode.Range(line, 0, line, 0);
          return [
            new vscode.CodeLens(range, {
              title: codeLensTitle(proposal),
              command: "smartmerge.acceptFile",
              arguments: [path, hunk.id],
            }),
            new vscode.CodeLens(range, { title: "Compare", command: "smartmerge.openPanel" }),
            new vscode.CodeLens(range, { title: "Explain", command: "smartmerge.explain" }),
          ];
        })
        .flat();
    },
    { scriptPath: daemonScript() },
  );
}

function publishProblems(
  problems: vscode.DiagnosticCollection,
  root: string,
  entries: readonly ProblemEntry[],
): void {
  const byPath = new Map<string, vscode.Diagnostic[]>();
  for (const entry of entries) {
    const list = byPath.get(entry.path) ?? [];
    const start = Math.max(0, entry.startLine - 1);
    const end = Math.max(start, entry.endLine - 1);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(start, 0, end, 0),
      entry.message,
      severity(entry.severity),
    );
    diagnostic.source = "smartmerge";
    if (entry.code !== undefined) diagnostic.code = entry.code;
    list.push(diagnostic);
    byPath.set(entry.path, list);
  }
  for (const [path, diagnostics] of byPath) {
    problems.set(vscode.Uri.file(join(root, path)), diagnostics);
  }
}

function severity(level: ProblemEntry["severity"]): vscode.DiagnosticSeverity {
  if (level === "error") return vscode.DiagnosticSeverity.Error;
  if (level === "warning") return vscode.DiagnosticSeverity.Warning;
  return vscode.DiagnosticSeverity.Information;
}

function ensurePanel(): vscode.WebviewPanel {
  if (panelRef) {
    panelRef.reveal(vscode.ViewColumn.Beside);
    return panelRef;
  }
  const panel = vscode.window.createWebviewPanel(
    "smartmerge",
    "SmartMergeResolver",
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );
  const messages = panel.webview.onDidReceiveMessage((message: PanelMessage) => {
    if (message.action === "undo") {
      void undo();
      return;
    }
    if (message.action !== "accept" && message.action !== "alternative") return;
    const choice: { hunkId?: string; candidateId?: string } = {};
    if (message.hunkId) choice.hunkId = message.hunkId;
    if (message.candidateId) choice.candidateId = message.candidateId;
    void accept(message.path ?? undefined, choice);
  });
  panel.onDidDispose(() => {
    messages.dispose();
    panelRef = undefined;
  });
  panelRef = panel;
  return panel;
}

function hunkPaths(session: {
  files: readonly { file: { path: string; hunks: readonly unknown[] } }[];
}): string[] {
  return session.files.flatMap((entry) =>
    Array.from({ length: entry.file.hunks.length }, () => entry.file.path),
  );
}

function repoRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
