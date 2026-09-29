import { randomUUID } from "node:crypto";
import type {
  ConflictSession,
  InitializeParams,
  InitializeResult,
  ResolutionProposal,
} from "@smartmerge/protocol";
import { PROTOCOL_VERSION } from "@smartmerge/protocol";
import { defaultConfig, toConflictFile } from "@smartmerge/core";
import { findRepoRoot, listUnmerged, readOperation } from "@smartmerge/git";
import { ErrorCodes, ResponseError, type MessageConnection } from "vscode-jsonrpc/node";
import { WorkerPool, workerPoolSize } from "./pool.js";
import { protocolRangeSupported } from "./protocol-range.js";
import {
  initializeRequest,
  listConflictsRequest,
  proposeRequest,
  shutdownRequest,
} from "./requests.js";

const SERVER_VERSION = "0.0.0";

/**
 * In-memory daemon session. Stdout belongs to JSON-RPC, so this type does not log there.
 */
export class DaemonServer {
  private initialized = false;
  private readonly sessions = new Map<string, ConflictSession>();
  private readonly pool = new WorkerPool(workerPoolSize(), new URL("./worker.js", import.meta.url));

  listen(connection: MessageConnection): void {
    connection.onRequest(initializeRequest, (params) => this.initialize(params));
    connection.onRequest(listConflictsRequest, (params) => this.listConflicts(params));
    connection.onRequest(proposeRequest, (params) => this.propose(params));
    connection.onRequest(shutdownRequest, () => this.shutdown());
  }

  initialize(params: InitializeParams): InitializeResult {
    if (!protocolRangeSupported(params.protocolRange)) {
      throw new ResponseError(
        ErrorCodes.InvalidParams,
        `Unsupported protocol range ${params.protocolRange}. This daemon speaks protocol ${PROTOCOL_VERSION}.`,
      );
    }
    if (params.repoRoot.trim().length === 0) {
      throw new ResponseError(ErrorCodes.InvalidParams, "repoRoot is required");
    }
    this.initialized = true;
    return {
      serverVersion: SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      supportedLanguages: [],
      config: defaultConfig(),
    };
  }

  async listConflicts(params: { repoRoot: string }): Promise<ConflictSession> {
    this.requireInitialized();
    if (params.repoRoot.trim().length === 0) {
      throw new ResponseError(ErrorCodes.InvalidParams, "repoRoot is required");
    }
    try {
      const repoRoot = await findRepoRoot(params.repoRoot);
      const unmerged = await listUnmerged(repoRoot);
      const operation = unmerged.length === 0 ? null : await readOperation(repoRoot);
      const files = unmerged.map((file) => ({
        file: toConflictFile(file, operation ?? emptyOperation(repoRoot)),
        proposals: [],
        status: "pending" as const,
      }));
      const session: ConflictSession = {
        sessionId: randomUUID(),
        repoRoot,
        files,
        stats: { total: files.length, autoResolvable: 0, resolved: 0 },
      };
      this.sessions.set(session.sessionId, session);
      return session;
    } catch (error) {
      throw asRpcError(error);
    }
  }

  async propose(params: { sessionId: string; path: string }): Promise<ResolutionProposal[]> {
    this.requireInitialized();
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new ResponseError(ErrorCodes.InvalidParams, `Unknown session ${params.sessionId}`);
    }
    const entry = session.files.find((item) => item.file.path === params.path);
    if (!entry) {
      throw new ResponseError(ErrorCodes.InvalidParams, `No conflicted file at ${params.path}`);
    }
    const proposals = await this.pool.run(
      { file: entry.file, delayMs: 0 },
      new AbortController().signal,
    );
    entry.proposals = proposals;
    entry.status = "ready";
    return proposals;
  }

  async shutdown(): Promise<null> {
    await this.pool.stop();
    this.sessions.clear();
    this.initialized = false;
    return null;
  }

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new ResponseError(ErrorCodes.ServerNotInitialized, "Call initialize first");
    }
  }
}

function emptyOperation(repoRoot: string): ConflictSession["files"][number]["file"]["operation"] {
  return {
    operation: "merge",
    current: { label: repoRoot, role: "ours", commitSha: "" },
    incoming: { label: repoRoot, role: "theirs", commitSha: "" },
    mergeBaseSha: null,
  };
}

function asRpcError(error: unknown): ResponseError {
  if (error instanceof ResponseError) return new ResponseError(error.code, error.message);
  const message = error instanceof Error ? error.message : "Unknown failure";
  return new ResponseError(ErrorCodes.InternalError, message);
}
