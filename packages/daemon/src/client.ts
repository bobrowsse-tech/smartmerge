import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  Actor,
  ConflictSession,
  DashboardSummary,
  InitializeParams,
  InitializeResult,
  ResolutionProposal,
  SessionLogEntry,
  UserAction,
  VerifyRequest,
  VerifyResult,
} from "@smartmerge/protocol";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import {
  initializeRequest,
  listConflictsRequest,
  actRequest,
  dashboardRequest,
  proposeRequest,
  shutdownRequest,
  verifyRequest,
} from "./requests.js";

/** Speak JSON-RPC to a `smartmerged --stdio` child process. */
export class DaemonClient {
  constructor(private readonly connection: ReturnType<typeof createMessageConnection>) {}

  initialize(
    repoRoot: string,
    protocolRange = "1.0.0",
    options?: {
      clientName?: string;
      clientVersion?: string;
      workspaceTrusted?: boolean;
      supportsWebview?: boolean;
      supportsDiagnostics?: boolean;
    },
  ): Promise<InitializeResult> {
    const params: InitializeParams = {
      clientName: options?.clientName ?? "smart-merge",
      clientVersion: options?.clientVersion ?? "0.0.0",
      protocolRange,
      repoRoot,
      workspaceTrusted: options?.workspaceTrusted ?? true,
      capabilities: {
        supportsWebview: options?.supportsWebview ?? false,
        supportsDiagnostics: options?.supportsDiagnostics ?? false,
      },
    };
    return this.connection.sendRequest(initializeRequest, params);
  }

  listConflicts(repoRoot: string): Promise<ConflictSession> {
    return this.connection.sendRequest(listConflictsRequest, { repoRoot });
  }

  propose(sessionId: string, path: string): Promise<ResolutionProposal[]> {
    return this.connection.sendRequest(proposeRequest, { sessionId, path });
  }

  /** Check resolution text for one hunk. This does not write the file. */
  verify(params: VerifyRequest): Promise<VerifyResult> {
    return this.connection.sendRequest(verifyRequest, params);
  }

  /** Rows for the merge dashboard. Propose each file first when recommendations are needed. */
  dashboard(sessionId: string): Promise<DashboardSummary> {
    return this.connection.sendRequest(dashboardRequest, { sessionId });
  }

  act(
    sessionId: string,
    action: UserAction,
    actor?: Actor,
  ): Promise<{ log: SessionLogEntry[]; session: ConflictSession }> {
    const params: { sessionId: string; action: UserAction; actor?: Actor } = { sessionId, action };
    if (actor !== undefined) params.actor = actor;
    return this.connection.sendRequest(actRequest, params);
  }
}

/** A daemon process kept open for more than one request. */
export interface DaemonHandle {
  client: DaemonClient;
  /** Daemon stderr collected so far. */
  stderr(): string;
  close(): Promise<void>;
}

/** Spawn the daemon and leave it running until `close`. */
export function openDaemon(repoRoot: string, options?: { scriptPath?: string }): DaemonHandle {
  const script = options?.scriptPath ?? fileURLToPath(new URL("./bin.js", import.meta.url));
  if (!existsSync(script)) {
    throw new Error(`Daemon is not built at ${script}. Run pnpm build.`);
  }
  const child = spawn(process.execPath, [script, "--stdio"], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const stderrChunks: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  });
  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );
  connection.listen();
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  return {
    client: new DaemonClient(connection),
    stderr: () => Buffer.concat(stderrChunks).toString("utf8").trim(),
    close: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          await connection.sendRequest(shutdownRequest);
        } catch {
          // The process is stopped below whether or not shutdown was acknowledged.
        }
        child.kill();
      }
      await Promise.race([
        exited,
        new Promise<void>((resolve) => {
          setTimeout(resolve, 500);
        }),
      ]);
      connection.dispose();
    },
  };
}

/** Spawn the daemon, run `task`, then shut the daemon down. */
export async function withDaemon<T>(
  repoRoot: string,
  task: (client: DaemonClient) => Promise<T>,
  options?: { scriptPath?: string },
): Promise<T> {
  const handle = openDaemon(repoRoot, options);
  try {
    return await task(handle.client);
  } catch (error) {
    const stderr = handle.stderr();
    if (stderr.length > 0 && error instanceof Error) {
      error.message = `${error.message}\n${stderr}`;
    }
    throw error;
  } finally {
    await handle.close();
  }
}
