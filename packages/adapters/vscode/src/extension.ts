import { relative } from "node:path";
import { withDaemon } from "@smartmerge/daemon";
import { daemonScript } from "./daemon-path.js";
import { panelModel, renderPanelDocument } from "@smartmerge/ui";
import * as vscode from "vscode";
import { codeLensTitle, statusBarText } from "./present.js";
import { acceptFile, undoFile } from "./resolve.js";

interface PanelMessage {
  action?: string;
  candidateId?: string | null;
  hunkId?: string | null;
  path?: string | null;
}

/** Editor entry. It renders daemon state and forwards commands. */
export function activate(context: vscode.ExtensionContext): void {
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  bar.command = "smartmerge.openPanel";
  bar.show();
  context.subscriptions.push(
    bar,
    vscode.commands.registerCommand("smartmerge.refresh", () => {
      void refresh(bar);
    }),
    vscode.commands.registerCommand("smartmerge.openPanel", () => {
      void openPanel();
    }),
    vscode.commands.registerCommand(
      "smartmerge.acceptFile",
      (filePath?: string, hunkId?: string) => {
        void accept(filePath, hunkId === undefined ? undefined : { hunkId });
      },
    ),
    vscode.commands.registerCommand("smartmerge.undo", () => {
      void undo();
    }),
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, { provideCodeLenses }),
  );
  void refresh(bar);
}

export function deactivate(): void {
  /* The daemon is started per command and does not need a shutdown hook. */
}

async function refresh(bar: vscode.StatusBarItem): Promise<void> {
  const root = repoRoot();
  if (!root) {
    bar.text = statusBarText(0, 0, false);
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
        });
        const session = await client.listConflicts(root);
        bar.text = statusBarText(session.stats.total, session.stats.autoResolvable, true);
      },
      { scriptPath: daemonScript() },
    );
  } catch {
    bar.text = statusBarText(0, 0, false);
  }
}

async function openPanel(): Promise<void> {
  const root = repoRoot();
  const panel = vscode.window.createWebviewPanel(
    "smartmerge",
    "SmartMergeResolver",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
    },
  );
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
    return;
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
      selectedIndex: 0,
    }),
  );
  panel.webview.onDidReceiveMessage((message: PanelMessage) => {
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
            selectedIndex: 0,
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
        selectedIndex: 0,
      }),
    );
  }
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
      return entry.file.hunks.map((hunk) => {
        const proposal = proposals.find((item) => item.hunkId === hunk.id);
        const line = Math.max(0, hunk.range.startLine - 1);
        return new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
          title: codeLensTitle(proposal),
          command: "smartmerge.acceptFile",
          arguments: [path, hunk.id],
        });
      });
    },
    { scriptPath: daemonScript() },
  );
}

function repoRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
