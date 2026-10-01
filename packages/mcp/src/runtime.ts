import { randomUUID } from "node:crypto";
import {
  decideCandidate,
  decideLlm,
  decideWriteGate,
  repoRelativePath,
  replaceHunk,
  splitLines,
} from "@smartmerge/core";
import { openDaemon, type DaemonClient, type DaemonHandle } from "@smartmerge/daemon";
import { appendAuditRecord, readAuditLog, readSessionLog, readWorkingBytes } from "@smartmerge/git";
import type {
  Actor,
  AgentPolicy,
  AuditRecord,
  Candidate,
  Check,
  CheckStatus,
  ConflictHunk,
  ConflictSession,
  ResolutionProposal,
} from "@smartmerge/protocol";
import { failureFromDaemon, ToolFailure } from "./failure.js";
import { clipLines, conceal, UNTRUSTED_NOTICE } from "./present.js";

const MAX_RESULT_CHARS = 1_000_000;
const DEFAULT_PAGE = 20;
const DEFAULT_MAX_LINES = 200;

interface PageInput {
  cursor?: string | undefined;
  limit?: number | undefined;
}

interface HunkInput {
  path: string;
  hunkId?: string | undefined;
  maxLines?: number | undefined;
  contextLines?: number | undefined;
}

interface ProposeInput {
  path: string;
  hunkId?: string | undefined;
  useLlm?: boolean | undefined;
  compact?: boolean | undefined;
  maxLines?: number | undefined;
}

interface VerifyInput {
  path: string;
  hunkId: string;
  resultText: string;
}

interface PreviewInput {
  path: string;
  hunkId: string;
  candidateId?: string | undefined;
  resultText?: string | undefined;
  maxLines?: number | undefined;
}

interface ApplyInput {
  path: string;
  hunkId: string;
  candidateId?: string | undefined;
  resultText?: string | undefined;
  dryRun?: boolean | undefined;
  acceptHazardous?: boolean | undefined;
}

interface ApplyAllInput {
  dryRun?: boolean | undefined;
}

interface UndoInput {
  entryId?: string | undefined;
}

/**
 * Agent-facing operations. Policy is decided here; the daemon performs the file write.
 * Calls are serialized so two tools cannot apply the same hunk together.
 */
export class MergeRuntime {
  private handle: DaemonHandle | null = null;
  private session: ConflictSession | null = null;
  private readonly filesWritten = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repoRoot: string,
    private readonly policy: AgentPolicy,
    private readonly actor: Actor,
  ) {}

  listConflicts(input: { summary?: boolean | undefined } & PageInput): Promise<unknown> {
    return this.guard("list_conflicts", () => this.listConflictsInner(input));
  }

  getConflict(input: HunkInput): Promise<unknown> {
    return this.guard("get_conflict", () => this.getConflictInner(input));
  }

  propose(input: ProposeInput): Promise<unknown> {
    return this.guard("propose_resolutions", () => this.proposeInner(input));
  }

  verify(input: VerifyInput): Promise<unknown> {
    return this.guard("verify_candidate", () => this.verifyInner(input));
  }

  preview(input: PreviewInput): Promise<unknown> {
    return this.guard("preview_result", () => this.previewInner(input));
  }

  apply(input: ApplyInput): Promise<unknown> {
    return this.guard("apply_resolution", () => this.applyInner(input));
  }

  applyAll(input: ApplyAllInput): Promise<unknown> {
    return this.guard("apply_all_safe", () => this.applyAllInner(input));
  }

  undo(input: UndoInput): Promise<unknown> {
    return this.guard("undo", () => this.undoInner(input));
  }

  explain(input: { path: string; hunkId?: string | undefined }): Promise<unknown> {
    return this.guard("explain", () => this.explainInner(input));
  }

  sessionLog(input: PageInput): Promise<unknown> {
    return this.guard("session_log", () => this.sessionLogInner(input));
  }

  /** Resource body for the current session or one conflict. */
  readResource(href: string): Promise<string> {
    return this.guard("resource", async () => {
      const url = new URL(href);
      if (
        url.protocol !== "smartmerge:" ||
        (url.hostname !== "session" && url.hostname !== "conflict")
      ) {
        throw new ToolFailure("NOT_FOUND", "That resource is not available.");
      }
      if (url.hostname === "session") {
        return JSON.stringify(await this.listConflictsInner({ summary: true }));
      }
      const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
      const hunkId = url.hash.length > 1 ? decodeURIComponent(url.hash.slice(1)) : undefined;
      const request: HunkInput = { path };
      if (hunkId !== undefined) request.hunkId = hunkId;
      return JSON.stringify(await this.getConflictInner(request));
    }).then((value) => {
      if (typeof value !== "string")
        throw new ToolFailure("INTERNAL", "The resource could not be read.");
      return value;
    });
  }

  async close(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    this.session = null;
    if (handle) await handle.close();
  }

  private guard<T>(tool: string, fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof ToolFailure) throw error;
        const failure = failureFromDaemon(error);
        await this.audit(
          tool,
          failure.code === "POLICY_BLOCKED" ? "blocked" : "error",
          failure.message,
        );
        throw failure;
      }
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async listConflictsInner(
    input: { summary?: boolean | undefined } & PageInput,
  ): Promise<unknown> {
    const { client, session } = await this.ensure();
    const totalHunks = session.files.reduce((sum, row) => sum + row.file.hunks.length, 0);
    if (input.summary === true) {
      await this.audit("list_conflicts", "ok", "Returned conflict counts.");
      return {
        notice: UNTRUSTED_NOTICE,
        summary: true,
        files: session.files.length,
        hunks: totalHunks,
      };
    }
    const limit = pageLimit(input.limit);
    const offset = pageOffset(input.cursor);
    const page = session.files.slice(offset, offset + limit);
    const redactions = { count: 0 };
    const files = [];
    for (const row of page) {
      const proposals = await client.propose(session.sessionId, row.file.path);
      row.proposals = proposals;
      files.push(fileSummary(row, proposals, redactions));
    }
    const next =
      offset + page.length < session.files.length ? String(offset + page.length) : undefined;
    await this.audit("list_conflicts", "ok", `Listed ${String(files.length)} file(s).`);
    return {
      notice: UNTRUSTED_NOTICE,
      summary: false,
      totalFiles: session.files.length,
      totalHunks,
      redactions: redactions.count,
      files,
      ...(next !== undefined ? { nextCursor: next } : {}),
    };
  }

  private async getConflictInner(input: HunkInput): Promise<unknown> {
    const path = await this.requirePath("get_conflict", input.path);
    const { session } = await this.ensure();
    const located = findHunk(session, path, input.hunkId);
    const maxLines = lineCap(input.maxLines);
    const contextLines = input.contextLines ?? 3;
    if (!Number.isInteger(contextLines) || contextLines < 0 || contextLines > 20) {
      throw new ToolFailure("INVALID_INPUT", "contextLines must be an integer from 0 to 20.");
    }
    const redactions = { count: 0 };
    const base = clipLines(located.hunk.base, maxLines);
    const current = clipLines(located.hunk.current, maxLines);
    const incoming = clipLines(located.hunk.incoming, maxLines);
    const around = await this.surrounding(path, located.hunk, contextLines);
    const linkedRefs = [
      ...located.hunk.temporal.current.commits,
      ...located.hunk.temporal.incoming.commits,
    ].flatMap((commit) => commit.refs);
    await this.audit("get_conflict", "ok", "Returned one hunk.", path, located.hunk.id);
    return {
      notice: UNTRUSTED_NOTICE,
      path: conceal(path, redactions),
      hunkId: located.hunk.id,
      sideLabels: {
        current: conceal(located.row.file.operation.current.label, redactions),
        incoming: conceal(located.row.file.operation.incoming.label, redactions),
      },
      base: conceal(base.text, redactions),
      current: conceal(current.text, redactions),
      incoming: conceal(incoming.text, redactions),
      truncated: base.truncated || current.truncated || incoming.truncated,
      contextBefore: conceal(around.before, redactions),
      contextAfter: conceal(around.after, redactions),
      semanticChanges: located.hunk.semanticChanges.map((change) => ({
        side: change.side,
        kind: change.kind,
        label: conceal(change.label, redactions),
      })),
      linkedRefs: linkedRefs.map((ref) => ({
        kind: ref.kind,
        id: conceal(ref.id, redactions),
        ...(ref.title !== undefined ? { title: conceal(ref.title, redactions) } : {}),
      })),
      redactions: redactions.count,
    };
  }

  private async proposeInner(input: ProposeInput): Promise<unknown> {
    if (input.useLlm === true) {
      const decision = decideLlm(this.policy);
      if (!decision.allowed) await this.block("propose_resolutions", decision);
    }
    const path = await this.requirePath("propose_resolutions", input.path);
    const { client, session } = await this.ensure();
    const row = findFile(session, path);
    const proposals = await client.propose(session.sessionId, path);
    row.proposals = proposals;
    const selected =
      input.hunkId === undefined
        ? proposals
        : proposals.filter((proposal) => proposal.hunkId === input.hunkId);
    if (input.hunkId !== undefined && selected.length === 0) {
      throw new ToolFailure(
        "NOT_FOUND",
        "That hunk is not in this file.",
        "List the conflicts for the file.",
      );
    }
    const redactions = { count: 0 };
    const maxLines = lineCap(input.maxLines);
    await this.audit("propose_resolutions", "ok", "Returned candidates.", path, input.hunkId);
    return {
      notice: UNTRUSTED_NOTICE,
      path: conceal(path, redactions),
      llmRan: false,
      redactions: redactions.count,
      proposals: selected.map((proposal) =>
        input.compact === true
          ? compactProposal(row.file, proposal, redactions)
          : fullProposal(proposal, redactions, maxLines),
      ),
    };
  }

  private async verifyInner(input: VerifyInput): Promise<unknown> {
    if (input.resultText.length > MAX_RESULT_CHARS) {
      throw new ToolFailure(
        "TOO_LARGE",
        "Result text is too large.",
        "Shorten the resolution and try again.",
      );
    }
    const path = await this.requirePath("verify_candidate", input.path);
    const { client, session } = await this.ensure();
    findHunk(session, path, input.hunkId);
    const result = await client.verify({
      sessionId: session.sessionId,
      path,
      hunkId: input.hunkId,
      resultText: input.resultText,
    });
    await this.audit(
      "verify_candidate",
      "ok",
      "Checked resolution text. Nothing was written.",
      path,
      input.hunkId,
    );
    const redactions = { count: 0 };
    return {
      notice: UNTRUSTED_NOTICE,
      wrote: false,
      hazardous: result.hazardous,
      overall: result.overall,
      band: result.band,
      redactions: redactions.count,
      checks: result.checks.map((check) => ({
        kind: check.kind,
        status: check.status,
        ...(check.reason !== undefined ? { reason: check.reason } : {}),
        diagnostics: check.diagnostics.map((diagnostic) => ({
          severity: diagnostic.severity,
          code: diagnostic.code,
          message: conceal(diagnostic.message, redactions),
          preExisting: diagnostic.preExisting,
        })),
      })),
    };
  }

  private async previewInner(input: PreviewInput): Promise<unknown> {
    const path = await this.requirePath("preview_result", input.path);
    const { session } = await this.ensure();
    const located = findHunk(session, path, input.hunkId);
    const replacement = await this.replacement(session, path, located.hunk, input);
    const bytes = await readWorkingBytes(this.repoRoot, path);
    const next = replaceHunk(bytes.toString("utf8"), located.hunk.range, replacement);
    const clipped = clipLines(next, lineCap(input.maxLines));
    const redactions = { count: 0 };
    await this.audit(
      "preview_result",
      "ok",
      "Previewed a result. Nothing was written.",
      path,
      located.hunk.id,
    );
    return {
      notice: UNTRUSTED_NOTICE,
      wrote: false,
      hunkId: located.hunk.id,
      truncated: clipped.truncated,
      content: conceal(clipped.text, redactions),
      impact: {
        hunkId: located.hunk.id,
        markersRemain: next.includes("<<<<<<<"),
      },
      redactions: redactions.count,
    };
  }

  private async applyInner(input: ApplyInput): Promise<unknown> {
    if ((input.candidateId === undefined) === (input.resultText === undefined)) {
      throw new ToolFailure(
        "INVALID_INPUT",
        "Provide a candidate id or resolution text, not both.",
      );
    }
    const path = await this.requirePath("apply_resolution", input.path);
    const gate = decideWriteGate(this.policy, {
      kind: "apply",
      path,
      filesApplied: this.filesWritten.size,
      pathAlreadyCounted: this.filesWritten.has(path),
    });
    if (!gate.allowed) await this.block("apply_resolution", gate, path);
    const { client, session } = await this.ensure();
    const located = findHunk(session, path, input.hunkId);
    if (!(await this.stillConflicted(path, located.hunk))) {
      await this.audit(
        "apply_resolution",
        "ok",
        "Hunk was already resolved.",
        path,
        located.hunk.id,
      );
      return { applied: false, alreadyApplied: true, path, hunkId: located.hunk.id };
    }
    if (input.resultText !== undefined) {
      return this.applyText(client, session, path, located, input.resultText, input);
    }
    const candidateId = input.candidateId;
    if (candidateId === undefined) {
      throw new ToolFailure("INVALID_INPUT", "A candidate id is required.");
    }
    const proposals = await this.proposalsFor(client, session, path);
    const candidate = proposals
      .flatMap((proposal) => proposal.candidates)
      .find((item) => item.id === candidateId && item.hunkId === located.hunk.id);
    if (!candidate) throw new ToolFailure("NOT_FOUND", "That candidate is not in this hunk.");
    const decision = decideCandidate(this.policy, {
      kind: "apply",
      customText: false,
      band: candidate.band,
      hazardous: candidate.hazardous,
      acceptHazardous: input.acceptHazardous === true,
      syntax: statusOf(candidate.checks, "syntax"),
      symbols: statusOf(candidate.checks, "symbols"),
    });
    if (!decision.allowed) await this.block("apply_resolution", decision, path, located.hunk.id);
    if (input.dryRun === true) {
      await this.audit(
        "apply_resolution",
        "ok",
        "Dry run. Nothing was written.",
        path,
        located.hunk.id,
      );
      return { applied: false, dryRun: true, path, hunkId: located.hunk.id, candidateId };
    }
    const acted = await client.act(
      session.sessionId,
      {
        type: "accept",
        hunkId: located.hunk.id,
        candidateId,
        ...(candidate.hazardous ? { acceptHazardous: true } : {}),
      },
      this.actor,
    );
    this.session = null;
    this.filesWritten.add(path);
    await this.audit("apply_resolution", "ok", "Applied a candidate.", path, located.hunk.id);
    const entry = acted.log[0];
    return {
      applied: true,
      path,
      hunkId: located.hunk.id,
      candidateId,
      ...(entry !== undefined ? { backupId: entry.backupId } : {}),
    };
  }

  private async applyText(
    client: DaemonClient,
    session: ConflictSession,
    path: string,
    located: Located,
    resultText: string,
    input: ApplyInput,
  ): Promise<unknown> {
    if (resultText.length > MAX_RESULT_CHARS) {
      throw new ToolFailure(
        "TOO_LARGE",
        "Result text is too large.",
        "Shorten the resolution and try again.",
      );
    }
    const verified = await client.verify({
      sessionId: session.sessionId,
      path,
      hunkId: located.hunk.id,
      resultText,
    });
    const decision = decideCandidate(this.policy, {
      kind: "apply",
      customText: true,
      hazardous: verified.hazardous,
      acceptHazardous: input.acceptHazardous === true,
      syntax: statusOf(verified.checks, "syntax"),
      symbols: statusOf(verified.checks, "symbols"),
    });
    if (!decision.allowed) await this.block("apply_resolution", decision, path, located.hunk.id);
    if (input.dryRun === true) {
      await this.audit(
        "apply_resolution",
        "ok",
        "Dry run. Nothing was written.",
        path,
        located.hunk.id,
      );
      return { applied: false, dryRun: true, path, hunkId: located.hunk.id };
    }
    const acted = await client.act(
      session.sessionId,
      {
        type: "edit",
        hunkId: located.hunk.id,
        text: resultText,
        ...(verified.hazardous ? { acceptHazardous: true } : {}),
      },
      this.actor,
    );
    this.session = null;
    this.filesWritten.add(path);
    await this.audit("apply_resolution", "ok", "Applied custom text.", path, located.hunk.id);
    const entry = acted.log[0];
    return {
      applied: true,
      path,
      hunkId: located.hunk.id,
      ...(entry !== undefined ? { backupId: entry.backupId } : {}),
    };
  }

  private async applyAllInner(input: ApplyAllInput): Promise<unknown> {
    const gate = decideWriteGate(this.policy, {
      kind: "apply-all",
      filesApplied: this.filesWritten.size,
    });
    if (!gate.allowed) await this.block("apply_all_safe", gate);
    const { client, session } = await this.ensure();
    const planned: Array<{ path: string; hunkId: string; candidateId: string }> = [];
    const files = [...session.files].sort((left, right) =>
      left.file.path < right.file.path ? -1 : left.file.path > right.file.path ? 1 : 0,
    );
    for (const row of files) {
      const path = row.file.path;
      const fileGate = decideWriteGate(this.policy, {
        kind: "apply",
        path,
        filesApplied: this.filesWritten.size + new Set(planned.map((item) => item.path)).size,
        pathAlreadyCounted: this.filesWritten.has(path),
      });
      if (!fileGate.allowed) continue;
      const proposals = await client.propose(session.sessionId, path);
      row.proposals = proposals;
      const hunks = [...row.file.hunks].sort(
        (left, right) => right.range.startLine - left.range.startLine,
      );
      for (const hunk of hunks) {
        const proposal = proposals.find((item) => item.hunkId === hunk.id);
        const candidateId = proposal?.recommended;
        if (candidateId === undefined || candidateId === null) continue;
        const candidate = proposal?.candidates.find((item) => item.id === candidateId);
        if (!candidate) continue;
        const decision = decideCandidate(this.policy, {
          kind: "apply-all",
          customText: false,
          band: candidate.band,
          hazardous: candidate.hazardous,
          acceptHazardous: false,
          syntax: statusOf(candidate.checks, "syntax"),
          symbols: statusOf(candidate.checks, "symbols"),
        });
        if (!decision.allowed) continue;
        planned.push({ path, hunkId: hunk.id, candidateId });
      }
    }
    if (input.dryRun === true) {
      await this.audit("apply_all_safe", "ok", `Dry run for ${String(planned.length)} hunk(s).`);
      return { applied: false, dryRun: true, hunks: planned };
    }
    const applied: Array<{ path: string; hunkId: string; candidateId: string; backupId?: string }> =
      [];
    for (const item of planned) {
      if (!(await this.markerRemains(item.path, item.hunkId))) continue;
      const acted = await client.act(
        session.sessionId,
        { type: "accept", hunkId: item.hunkId, candidateId: item.candidateId },
        this.actor,
      );
      this.filesWritten.add(item.path);
      const entry = acted.log[0];
      applied.push(entry !== undefined ? { ...item, backupId: entry.backupId } : item);
    }
    this.session = null;
    await this.audit("apply_all_safe", "ok", `Applied ${String(applied.length)} hunk(s).`);
    return { applied: applied.length > 0, hunks: applied };
  }

  private async undoInner(input: UndoInput): Promise<unknown> {
    const gate = decideWriteGate(this.policy, {
      kind: "undo",
      filesApplied: this.filesWritten.size,
    });
    if (!gate.allowed) await this.block("undo", gate);
    const log = await readSessionLog(this.repoRoot);
    const undone = new Set(
      log.filter((entry) => entry.action === "undone").map((entry) => entry.backupId),
    );
    if (input.entryId !== undefined) {
      const target = log.find((entry) => entry.id === input.entryId);
      if (target && undone.has(target.backupId)) {
        await this.audit(
          "undo",
          "ok",
          "That backup was already restored.",
          target.path,
          target.hunkId,
        );
        return { restored: false, alreadyUndone: true, entryId: input.entryId };
      }
    }
    const { client, session } = await this.ensure();
    const action =
      input.entryId === undefined
        ? { type: "undo" as const }
        : { type: "undo" as const, entryId: input.entryId };
    const acted = await client.act(session.sessionId, action, this.actor);
    const entry = acted.log[0];
    if (!entry) throw new ToolFailure("INTERNAL", "Undo did not record a log entry.");
    this.session = null;
    this.filesWritten.delete(entry.path);
    await this.audit("undo", "ok", "Restored a backup.", entry.path, entry.hunkId);
    return { restored: true, path: entry.path, backupId: entry.backupId, entryId: entry.id };
  }

  private async explainInner(input: {
    path: string;
    hunkId?: string | undefined;
  }): Promise<unknown> {
    const path = await this.requirePath("explain", input.path);
    const { client, session } = await this.ensure();
    const row = findFile(session, path);
    const proposals = await client.propose(session.sessionId, path);
    row.proposals = proposals;
    const proposal =
      input.hunkId === undefined
        ? proposals[0]
        : proposals.find((item) => item.hunkId === input.hunkId);
    if (!proposal) throw new ToolFailure("NOT_FOUND", "That hunk is not in this file.");
    const redactions = { count: 0 };
    await this.audit("explain", "ok", "Returned an explanation.", path, proposal.hunkId);
    return {
      notice: UNTRUSTED_NOTICE,
      path: conceal(path, redactions),
      hunkId: proposal.hunkId,
      headline: conceal(proposal.explanation.headline, redactions),
      bullets: proposal.explanation.bullets.map((bullet) => conceal(bullet, redactions)),
      verificationSummary: conceal(proposal.explanation.verificationSummary, redactions),
      temporalSummary: conceal(proposal.explanation.temporalSummary, redactions),
      evidence: (
        proposal.candidates.find((item) => item.id === proposal.recommended)?.evidence ?? []
      ).map((item) => ({ code: item.code, text: conceal(item.text, redactions) })),
      redactions: redactions.count,
    };
  }

  private async sessionLogInner(input: PageInput): Promise<unknown> {
    const records = await readAuditLog(this.repoRoot);
    const limit = pageLimit(input.limit);
    const offset = pageOffset(input.cursor);
    const page = records.slice(offset, offset + limit);
    const next = offset + page.length < records.length ? String(offset + page.length) : undefined;
    await this.audit("session_log", "ok", "Returned the audit log.");
    return {
      notice: UNTRUSTED_NOTICE,
      entries: page,
      ...(next !== undefined ? { nextCursor: next } : {}),
    };
  }

  private async replacement(
    session: ConflictSession,
    path: string,
    hunk: ConflictHunk,
    input: { candidateId?: string | undefined; resultText?: string | undefined },
  ): Promise<string> {
    if ((input.candidateId === undefined) === (input.resultText === undefined)) {
      throw new ToolFailure(
        "INVALID_INPUT",
        "Provide a candidate id or resolution text, not both.",
      );
    }
    if (input.resultText !== undefined) {
      if (input.resultText.length > MAX_RESULT_CHARS) {
        throw new ToolFailure(
          "TOO_LARGE",
          "Result text is too large.",
          "Shorten the resolution and try again.",
        );
      }
      return input.resultText;
    }
    const candidateId = input.candidateId;
    if (candidateId === undefined)
      throw new ToolFailure("INVALID_INPUT", "A candidate id is required.");
    if (!this.handle) throw new ToolFailure("INTERNAL", "The daemon is not running.");
    const proposals = await this.proposalsFor(this.handle.client, session, path);
    const candidate = proposals
      .flatMap((proposal) => proposal.candidates)
      .find((item) => item.id === candidateId && item.hunkId === hunk.id);
    if (!candidate) throw new ToolFailure("NOT_FOUND", "That candidate is not in this hunk.");
    return candidate.result;
  }

  private async proposalsFor(
    client: DaemonClient,
    session: ConflictSession,
    path: string,
  ): Promise<ResolutionProposal[]> {
    const row = findFile(session, path);
    if (row.proposals.length > 0) return row.proposals;
    const proposals = await client.propose(session.sessionId, path);
    row.proposals = proposals;
    return proposals;
  }

  private async stillConflicted(path: string, hunk: ConflictHunk): Promise<boolean> {
    const bytes = await readWorkingBytes(this.repoRoot, path);
    const lines = splitLines(bytes.toString("utf8"));
    const slice = lines.slice(hunk.range.startLine - 1, hunk.range.endLine).join("\n");
    return slice.includes("<<<<<<<");
  }

  private async markerRemains(path: string, hunkId: string): Promise<boolean> {
    const session = this.session;
    if (!session) return false;
    const located = findHunk(session, path, hunkId);
    return this.stillConflicted(path, located.hunk);
  }

  private async surrounding(
    path: string,
    hunk: ConflictHunk,
    contextLines: number,
  ): Promise<{ before: string; after: string }> {
    if (contextLines === 0) return { before: "", after: "" };
    try {
      const lines = splitLines((await readWorkingBytes(this.repoRoot, path)).toString("utf8"));
      const before = lines.slice(
        Math.max(0, hunk.range.startLine - 1 - contextLines),
        hunk.range.startLine - 1,
      );
      const after = lines.slice(hunk.range.endLine, hunk.range.endLine + contextLines);
      return { before: before.join("\n"), after: after.join("\n") };
    } catch {
      return { before: "", after: "" };
    }
  }

  private async ensure(): Promise<{ client: DaemonClient; session: ConflictSession }> {
    if (!this.handle) {
      this.handle = openDaemon(this.repoRoot);
      try {
        await this.handle.client.initialize(this.repoRoot, "1.0.0", {
          clientName: "smart-merge-mcp",
          clientVersion: "0.0.0",
        });
      } catch (error) {
        const stderr = this.handle.stderr();
        await this.handle.close();
        this.handle = null;
        if (stderr.length > 0 && error instanceof Error)
          error.message = `${error.message}\n${stderr}`;
        throw error;
      }
    }
    if (!this.session) this.session = await this.handle.client.listConflicts(this.repoRoot);
    return { client: this.handle.client, session: this.session };
  }

  private async requirePath(tool: string, input: string): Promise<string> {
    const path = repoRelativePath(this.repoRoot, input);
    if (path === null) {
      await this.audit(tool, "blocked", "That path is outside the repository.");
      throw new ToolFailure(
        "POLICY_BLOCKED",
        "That path is outside the repository.",
        "Use a path relative to the repository root.",
      );
    }
    return path;
  }

  private async block(
    tool: string,
    decision: { message: string; hint: string },
    path?: string,
    hunkId?: string,
  ): Promise<never> {
    await this.audit(tool, "blocked", decision.message, path, hunkId);
    throw new ToolFailure("POLICY_BLOCKED", decision.message, decision.hint);
  }

  private async audit(
    tool: string,
    outcome: AuditRecord["outcome"],
    message: string,
    path?: string,
    hunkId?: string,
  ): Promise<void> {
    const record: AuditRecord = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: this.actor,
      tool,
      outcome,
      message,
    };
    if (path !== undefined) record.path = path;
    if (hunkId !== undefined) record.hunkId = hunkId;
    await appendAuditRecord(this.repoRoot, record);
  }
}

interface Located {
  row: ConflictSession["files"][number];
  hunk: ConflictHunk;
}

function findFile(session: ConflictSession, path: string): ConflictSession["files"][number] {
  const row = session.files.find((item) => item.file.path === path);
  if (!row)
    throw new ToolFailure("NOT_FOUND", "That file is not conflicted.", "List conflicts again.");
  return row;
}

function findHunk(session: ConflictSession, path: string, hunkId: string | undefined): Located {
  const row = findFile(session, path);
  const hunk =
    hunkId === undefined ? row.file.hunks[0] : row.file.hunks.find((item) => item.id === hunkId);
  if (!hunk)
    throw new ToolFailure("NOT_FOUND", "That hunk is not in this file.", "List conflicts again.");
  return { row, hunk };
}

function fileSummary(
  row: ConflictSession["files"][number],
  proposals: readonly ResolutionProposal[],
  redactions: { count: number },
): unknown {
  const recommended = proposals
    .map((proposal) =>
      proposal.candidates.find((candidate) => candidate.id === proposal.recommended),
    )
    .filter((candidate): candidate is Candidate => candidate !== undefined);
  const top = recommended.reduce<Candidate | undefined>((best, candidate) => {
    if (!best) return candidate;
    return rank(candidate.band) > rank(best.band) ? candidate : best;
  }, undefined);
  return {
    path: conceal(row.file.path, redactions),
    hunks: row.file.hunks.length,
    band: top?.band ?? null,
    checks: (top?.checks ?? []).map((check) => ({ kind: check.kind, status: check.status })),
  };
}

function fullProposal(
  proposal: ResolutionProposal,
  redactions: { count: number },
  maxLines: number,
): unknown {
  return {
    hunkId: proposal.hunkId,
    recommended: proposal.recommended,
    candidates: proposal.candidates.map((candidate) => {
      const clipped = clipLines(candidate.result, maxLines);
      return {
        id: candidate.id,
        strategy: candidate.strategy,
        band: candidate.band,
        hazardous: candidate.hazardous,
        confidence: candidate.confidence,
        checks: candidate.checks.map((check) => ({ kind: check.kind, status: check.status })),
        truncated: clipped.truncated,
        result: conceal(clipped.text, redactions),
        evidence: candidate.evidence.map((item) => ({
          code: item.code,
          text: conceal(item.text, redactions),
        })),
      };
    }),
  };
}

function compactProposal(
  file: ConflictSession["files"][number]["file"],
  proposal: ResolutionProposal,
  redactions: { count: number },
): unknown {
  const hunk = file.hunks.find((item) => item.id === proposal.hunkId);
  const top =
    proposal.candidates.find((candidate) => candidate.id === proposal.recommended) ?? null;
  const diff = clipLines(top?.result ?? "", 20);
  return {
    hunkId: proposal.hunkId,
    sideLabels: {
      current: conceal(file.operation.current.label, redactions),
      incoming: conceal(file.operation.incoming.label, redactions),
    },
    semanticChanges: (hunk?.semanticChanges ?? []).map((change) => ({
      side: change.side,
      kind: change.kind,
      label: conceal(change.label, redactions),
    })),
    topCandidateId: proposal.recommended,
    band: top?.band ?? null,
    checks: (top?.checks ?? []).map((check) => ({ kind: check.kind, status: check.status })),
    truncated: diff.truncated,
    diff: conceal(diff.text, redactions),
  };
}

function statusOf(checks: readonly Check[], kind: "syntax" | "symbols"): CheckStatus {
  return checks.find((check) => check.kind === kind)?.status ?? "unknown";
}

function rank(band: Candidate["band"]): number {
  if (band === "certain") return 3;
  if (band === "high") return 2;
  if (band === "medium") return 1;
  return 0;
}

function pageLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ToolFailure("INVALID_INPUT", "limit must be an integer from 1 to 50.");
  }
  return limit;
}

function pageOffset(cursor: string | undefined): number {
  if (cursor === undefined || cursor.length === 0) return 0;
  if (!/^\d+$/.test(cursor)) {
    throw new ToolFailure(
      "INVALID_INPUT",
      "The page cursor is not valid.",
      "Use the nextCursor from the previous page.",
    );
  }
  return Number(cursor);
}

function lineCap(maxLines: number | undefined): number {
  if (maxLines === undefined) return DEFAULT_MAX_LINES;
  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 2000) {
    throw new ToolFailure("INVALID_INPUT", "maxLines must be an integer from 1 to 2000.");
  }
  return maxLines;
}
