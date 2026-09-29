import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  Actor,
  ConflictSession,
  InitializeParams,
  InitializeResult,
  ResolutionProposal,
  SessionLogEntry,
  SmartMergeConfig,
  UserAction,
} from "@smartmerge/protocol";
import { PROTOCOL_VERSION } from "@smartmerge/protocol";
import { buildConflict, defaultConfig, replaceHunk } from "@smartmerge/core";
import {
  appendSessionLog,
  backupWorkingFile,
  findRepoRoot,
  listUnmerged,
  readOperation,
  readSessionLog,
  restoreBackup,
  writeAtomic,
} from "@smartmerge/git";
import { ErrorCodes, ResponseError, type MessageConnection } from "vscode-jsonrpc/node";
import { WorkerPool, workerPoolSize } from "./pool.js";
import { protocolRangeSupported } from "./protocol-range.js";
import {
  initializeRequest,
  actRequest,
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
  private config: SmartMergeConfig = defaultConfig();
  private readonly sessions = new Map<string, ConflictSession>();
  private readonly knownBases = new Map<string, readonly string[]>();
  private readonly pool = new WorkerPool(workerPoolSize(), new URL("./worker.js", import.meta.url));

  listen(connection: MessageConnection): void {
    connection.onRequest(initializeRequest, (params) => this.initialize(params));
    connection.onRequest(listConflictsRequest, (params) => this.listConflicts(params));
    connection.onRequest(proposeRequest, (params) => this.propose(params));
    connection.onRequest(actRequest, (params) => this.act(params));
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
    this.config = defaultConfig();
    return {
      serverVersion: SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      supportedLanguages: [],
      config: this.config,
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
      const sessionId = randomUUID();
      const files = unmerged.map((file) => {
        const built = buildConflict(file, operation ?? emptyOperation(repoRoot));
        this.knownBases.set(baseKey(sessionId, file.path), built.knownBaseHunkIds);
        return {
          file: built.file,
          proposals: [],
          status: "pending" as const,
        };
      });
      const session: ConflictSession = {
        sessionId,
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
      {
        file: entry.file,
        delayMs: 0,
        knownBaseHunkIds: [...(this.knownBases.get(baseKey(params.sessionId, params.path)) ?? [])],
      },
      new AbortController().signal,
    );
    entry.proposals = proposals;
    entry.status = "ready";
    return proposals;
  }

  async act(params: {
    sessionId: string;
    action: UserAction;
    actor?: Actor;
  }): Promise<{ log: SessionLogEntry[]; session: ConflictSession }> {
    this.requireInitialized();
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new ResponseError(ErrorCodes.InvalidParams, `Unknown session ${params.sessionId}`);
    }
    const actor = params.actor ?? { kind: "human" as const };
    if (params.action.type === "undo") {
      const entry = await undoLast(session.repoRoot, params.action.entryId, actor);
      return { log: [entry], session };
    }
    if (params.action.type === "applyAllSafe") {
      // Automatic apply stays off unless the saved config explicitly enables it.
      if (!this.config.autoApply.enabled) return { log: [], session };
      return { log: [], session };
    }
    if (params.action.type !== "accept") {
      throw new ResponseError(
        ErrorCodes.InvalidParams,
        `Action ${params.action.type} is not available in this milestone`,
      );
    }
    const entry = await this.accept(session, params.action, actor);
    return { log: [entry], session };
  }

  async shutdown(): Promise<null> {
    await this.pool.stop();
    this.sessions.clear();
    this.knownBases.clear();
    this.initialized = false;
    return null;
  }

  private async accept(
    session: ConflictSession,
    action: { hunkId: string; candidateId: string; acceptHazardous?: boolean },
    actor: Actor,
  ): Promise<SessionLogEntry> {
    const located = locateCandidate(session, action.hunkId, action.candidateId);
    if (located.candidate.hazardous && action.acceptHazardous !== true) {
      throw new ResponseError(ErrorCodes.InvalidParams, "Refusing to apply a hazardous candidate");
    }
    const backup = await backupWorkingFile(session.repoRoot, located.path);
    const next = replaceHunk(
      backup.bytes.toString("utf8"),
      located.hunk.range,
      located.candidate.result,
    );
    await writeAtomic(resolveInside(session.repoRoot, located.path), Buffer.from(next, "utf8"));
    const entry: SessionLogEntry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor,
      path: located.path,
      hunkId: action.hunkId,
      action: "accepted",
      candidateId: action.candidateId,
      strategy: located.candidate.strategy,
      backupId: backup.id,
    };
    await appendSessionLog(session.repoRoot, entry);
    located.row.status = next.includes("<<<<<<<") ? "pending" : "resolved";
    return entry;
  }

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new ResponseError(ErrorCodes.ServerNotInitialized, "Call initialize first");
    }
  }
}

function baseKey(sessionId: string, path: string): string {
  return `${sessionId}\0${path}`;
}

async function undoLast(
  repoRoot: string,
  entryId: string | undefined,
  actor: Actor,
): Promise<SessionLogEntry> {
  const log = await readSessionLog(repoRoot);
  const undone = new Set(
    log.filter((entry) => entry.action === "undone").map((entry) => entry.backupId),
  );
  const applied = log.filter(
    (entry) =>
      (entry.action === "accepted" || entry.action === "auto-applied") &&
      !undone.has(entry.backupId),
  );
  const target =
    entryId === undefined
      ? applied[applied.length - 1]
      : applied.find((entry) => entry.id === entryId);
  if (!target) {
    throw new ResponseError(ErrorCodes.InvalidParams, "Nothing to undo");
  }
  await restoreBackup(repoRoot, target.backupId, target.path);
  const entry: SessionLogEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    actor,
    path: target.path,
    hunkId: target.hunkId,
    action: "undone",
    backupId: target.backupId,
  };
  await appendSessionLog(repoRoot, entry);
  return entry;
}

function locateCandidate(
  session: ConflictSession,
  hunkId: string,
  candidateId: string,
): {
  path: string;
  row: ConflictSession["files"][number];
  hunk: ConflictSession["files"][number]["file"]["hunks"][number];
  candidate: ResolutionProposal["candidates"][number];
} {
  for (const row of session.files) {
    const hunk = row.file.hunks.find((item) => item.id === hunkId);
    if (!hunk) continue;
    const proposal = row.proposals.find((item) => item.hunkId === hunkId);
    const candidate = proposal?.candidates.find((item) => item.id === candidateId);
    if (!candidate) {
      throw new ResponseError(
        ErrorCodes.InvalidParams,
        `Unknown candidate ${candidateId}. Call resolution/propose first.`,
      );
    }
    return { path: row.file.path, row, hunk, candidate };
  }
  throw new ResponseError(ErrorCodes.InvalidParams, `Unknown hunk ${hunkId}`);
}

function resolveInside(root: string, path: string): string {
  const absolute = resolve(root, path);
  const fromRoot = relative(root, absolute);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new ResponseError(ErrorCodes.InvalidParams, `Path escapes the repository: ${path}`);
  }
  return absolute;
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
