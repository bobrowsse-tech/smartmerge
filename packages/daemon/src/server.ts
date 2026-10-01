import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  Actor,
  ConflictSession,
  DashboardSummary,
  InitializeParams,
  InitializeResult,
  ResolutionProposal,
  SessionLogEntry,
  SmartMergeConfig,
  UserAction,
  VerifyRequest,
  VerifyResult,
} from "@smartmerge/protocol";
import { PROTOCOL_VERSION } from "@smartmerge/protocol";
import { buildConflict, defaultConfig, replaceHunk, summarizeDashboard } from "@smartmerge/core";
import {
  appendSessionLog,
  backupWorkingFile,
  enrichLineage,
  readWorkingBytes,
  findRepoRoot,
  listUnmerged,
  readOperation,
  readSessionLog,
  removeWorkingFile,
  restoreBackup,
  writeAtomic,
} from "@smartmerge/git";
import { ErrorCodes, ResponseError, type MessageConnection } from "vscode-jsonrpc/node";
import { WorkerPool, workerPoolSize } from "./pool.js";
import { protocolRangeSupported } from "./protocol-range.js";
import {
  initializeRequest,
  actRequest,
  dashboardRequest,
  listConflictsRequest,
  proposeRequest,
  shutdownRequest,
  verifyRequest,
} from "./requests.js";

const SERVER_VERSION = "0.0.0";

/**
 * In-memory daemon session. Stdout belongs to JSON-RPC, so this type does not log there.
 */
export class DaemonServer {
  private initialized = false;
  private workspaceTrusted = false;
  private config: SmartMergeConfig = defaultConfig();
  private readonly sessions = new Map<string, ConflictSession>();
  private readonly knownBases = new Map<string, readonly string[]>();
  private readonly pool = new WorkerPool(workerPoolSize(), new URL("./worker.js", import.meta.url));

  listen(connection: MessageConnection): void {
    connection.onRequest(initializeRequest, (params) => this.initialize(params));
    connection.onRequest(listConflictsRequest, (params) => this.listConflicts(params));
    connection.onRequest(proposeRequest, (params) => this.propose(params));
    connection.onRequest(dashboardRequest, (params) => this.dashboard(params));
    connection.onRequest(actRequest, (params) => this.act(params));
    connection.onRequest(verifyRequest, (params) => this.verify(params));
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
    this.workspaceTrusted = params.workspaceTrusted;
    this.config = defaultConfig();
    return {
      serverVersion: SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      supportedLanguages: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
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
      const files: ConflictSession["files"] = [];
      for (const file of unmerged) {
        const built = buildConflict(file, operation ?? emptyOperation(repoRoot));
        this.knownBases.set(baseKey(sessionId, file.path), built.knownBaseHunkIds);
        files.push({
          file: await enrichLineage(repoRoot, built.file),
          proposals: [],
          status: "pending" as const,
        });
      }
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

  /**
   * Dashboard rows from proposals already stored on the session.
   * Files that have not been proposed yet are grouped as needing review.
   */
  dashboard(params: { sessionId: string }): DashboardSummary {
    this.requireInitialized();
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new ResponseError(ErrorCodes.InvalidParams, `Unknown session ${params.sessionId}`);
    }
    return summarizeDashboard(session);
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

  /** Check resolution text. The working tree is left unchanged. */
  async verify(params: VerifyRequest): Promise<VerifyResult> {
    this.requireInitialized();
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new ResponseError(ErrorCodes.InvalidParams, `Unknown session ${params.sessionId}`);
    }
    if (params.resultText.length > 1_000_000) {
      throw new ResponseError(ErrorCodes.InvalidParams, "Result text is too large.");
    }
    const entry = session.files.find((item) => item.file.path === params.path);
    if (!entry) {
      throw new ResponseError(ErrorCodes.InvalidParams, `No conflicted file at ${params.path}`);
    }
    const hunk = entry.file.hunks.find((item) => item.id === params.hunkId);
    if (!hunk) {
      throw new ResponseError(ErrorCodes.InvalidParams, `No hunk ${params.hunkId}`);
    }
    return this.checkResolution(
      session,
      params.path,
      entry.file.languageId,
      params.resultText,
      hunk.current,
      hunk.incoming,
      hunk.range,
    );
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
    if (params.action.type === "edit") {
      const entry = await this.edit(session, params.action, actor);
      return { log: [entry], session };
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

  private async edit(
    session: ConflictSession,
    action: { hunkId: string; text: string; acceptHazardous?: boolean },
    actor: Actor,
  ): Promise<SessionLogEntry> {
    if (action.text.length > 1_000_000) {
      throw new ResponseError(ErrorCodes.InvalidParams, "Result text is too large.");
    }
    const located = locateHunk(session, action.hunkId);
    const verified = await this.checkResolution(
      session,
      located.path,
      located.row.file.languageId,
      action.text,
      located.hunk.current,
      located.hunk.incoming,
      located.hunk.range,
    );
    if (verified.hazardous && action.acceptHazardous !== true) {
      throw new ResponseError(ErrorCodes.InvalidParams, "Refusing to apply a hazardous edit");
    }
    const backup = await backupWorkingFile(session.repoRoot, located.path);
    const next = replaceHunk(backup.bytes.toString("utf8"), located.hunk.range, action.text);
    await writeAtomic(resolveInside(session.repoRoot, located.path), Buffer.from(next, "utf8"));
    const entry: SessionLogEntry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor,
      path: located.path,
      hunkId: action.hunkId,
      action: "edited",
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

  /**
   * Verify one hunk against the working file.
   * Trust comes from initialization. The check sees the whole file with the hunk replaced.
   */
  private async checkResolution(
    session: ConflictSession,
    path: string,
    languageId: string | null,
    result: string,
    current: string,
    incoming: string,
    range: { startLine: number; endLine: number },
  ): Promise<VerifyResult> {
    let fileText: string | undefined;
    try {
      fileText = (await readWorkingBytes(session.repoRoot, path)).toString("utf8");
    } catch {
      fileText = undefined;
    }
    return this.pool.verify(
      {
        path,
        languageId,
        result,
        current,
        incoming,
        trusted: this.workspaceTrusted,
        projectRoot: session.repoRoot,
        ...(fileText === undefined
          ? {}
          : { fileText, startLine: range.startLine, endLine: range.endLine }),
      },
      new AbortController().signal,
    );
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
      (entry.action === "accepted" ||
        entry.action === "edited" ||
        entry.action === "auto-applied") &&
      !undone.has(entry.backupId),
  );
  const target =
    entryId === undefined
      ? applied[applied.length - 1]
      : applied.find((entry) => entry.id === entryId);
  if (!target) {
    throw new ResponseError(ErrorCodes.InvalidParams, "Nothing to undo");
  }
  if (target.absentBefore === true) await removeWorkingFile(repoRoot, target.path);
  else await restoreBackup(repoRoot, target.backupId, target.path);
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

function locateHunk(
  session: ConflictSession,
  hunkId: string,
): {
  path: string;
  row: ConflictSession["files"][number];
  hunk: ConflictSession["files"][number]["file"]["hunks"][number];
} {
  for (const row of session.files) {
    const hunk = row.file.hunks.find((item) => item.id === hunkId);
    if (hunk) return { path: row.file.path, row, hunk };
  }
  throw new ResponseError(ErrorCodes.InvalidParams, `Unknown hunk ${hunkId}`);
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
