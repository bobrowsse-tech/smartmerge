import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  decideCandidate,
  decideWriteGate,
  defaultConfig,
  redactSecrets,
  repoRelativePath,
  tightenPolicy,
} from "@smartmerge/core";
import { withDaemon } from "@smartmerge/daemon";
import { appendAuditRecord, git } from "@smartmerge/git";
import { readRepoPolicy } from "@smartmerge/mcp";
import type {
  Actor,
  AgentPolicy,
  AuditRecord,
  Check,
  CheckStatus,
  ConflictHunk,
  Untrusted,
} from "@smartmerge/protocol";

import { CommandFailure } from "./failure.js";

const CI_ACTOR: Actor = { kind: "ci" };

/** One hunk in a CI report. Reasons are policy text, not repository content. */
export interface CiHunkReport {
  hunkId: string;
  outcome: "applied" | "eligible" | "skipped";
  candidateId?: string;
  reason?: string;
}

/** One conflicted file. The path is untrusted repository data. */
export interface CiFileReport {
  path: Untrusted;
  hunks: CiHunkReport[];
}

/** What `smart-merge ci` decided. Writes happen only when policy allows them. */
export interface CiResult {
  mode: AgentPolicy["mode"];
  dryRun: boolean;
  wrote: boolean;
  conflicts: number;
  applied: number;
  eligible: number;
  skipped: number;
  remaining: number;
  redactions: number;
  files: CiFileReport[];
}

/**
 * Report conflicts, and apply recommended candidates when the effective policy allows writes.
 * The actor is always `ci`. A repository policy file can only tighten `--policy`.
 */
export async function runCi(
  repo: string,
  options: { userPolicy?: AgentPolicy; dryRun: boolean },
): Promise<{ code: 0 | 1; result: CiResult }> {
  const user = options.userPolicy ?? defaultConfig().agent;
  let overlay: Partial<AgentPolicy>;
  try {
    overlay = await readRepoPolicy(repo);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Policy file could not be read.";
    throw new CommandFailure(2, "INVALID_INPUT", message);
  }
  const policy = tightenPolicy(user, overlay);
  return withDaemon(repo, async (client) => {
    await client.initialize(repo);
    const session = await client.listConflicts(repo);
    const redactions = { count: 0 };
    const files: CiFileReport[] = [];
    const counted = new Set<string>();
    let applied = 0;
    let eligible = 0;
    let skipped = 0;
    const rows = [...session.files].sort((left, right) =>
      left.file.path.localeCompare(right.file.path),
    );
    for (const row of rows) {
      const path = row.file.path;
      if (repoRelativePath(repo, path) === null) {
        skipped += row.file.hunks.length;
        files.push({
          path: conceal(path, redactions),
          hunks: row.file.hunks.map((hunk) => ({
            hunkId: hunk.id,
            outcome: "skipped" as const,
            reason: "That path is outside the repository.",
          })),
        });
        await audit(repo, "blocked", "That path is outside the repository.");
        continue;
      }
      const proposals = await client.propose(session.sessionId, path);
      const hunks = [...row.file.hunks].sort(
        (left, right) => right.range.startLine - left.range.startLine,
      );
      const reports: CiHunkReport[] = [];
      for (const hunk of hunks) {
        const proposal = proposals.find((item) => item.hunkId === hunk.id);
        const candidateId = proposal?.recommended;
        if (candidateId === undefined || candidateId === null) {
          skipped += 1;
          reports.push({
            hunkId: hunk.id,
            outcome: "skipped",
            reason: "No recommended candidate.",
          });
          continue;
        }
        const candidate = proposal?.candidates.find((item) => item.id === candidateId);
        if (!candidate) {
          skipped += 1;
          reports.push({
            hunkId: hunk.id,
            outcome: "skipped",
            reason: "No recommended candidate.",
          });
          continue;
        }
        const quality = decideCandidate(policy, {
          kind: "apply-all",
          customText: false,
          band: candidate.band,
          hazardous: candidate.hazardous,
          acceptHazardous: false,
          syntax: statusOf(candidate.checks, "syntax"),
          symbols: statusOf(candidate.checks, "symbols"),
        });
        if (!quality.allowed) {
          skipped += 1;
          reports.push({
            hunkId: hunk.id,
            outcome: "skipped",
            candidateId,
            reason: quality.message,
          });
          continue;
        }
        const gate = decideWriteGate(policy, {
          kind: "apply-all",
          path,
          filesApplied: counted.size,
          pathAlreadyCounted: counted.has(path),
        });
        if (!gate.allowed) {
          const modeBlocks = policy.mode === "read-only" || policy.mode === "propose-and-verify";
          if (modeBlocks) {
            eligible += 1;
            reports.push({ hunkId: hunk.id, outcome: "eligible", candidateId });
          } else {
            skipped += 1;
            reports.push({
              hunkId: hunk.id,
              outcome: "skipped",
              candidateId,
              reason: gate.message,
            });
          }
          continue;
        }
        if (options.dryRun) {
          eligible += 1;
          counted.add(path);
          reports.push({ hunkId: hunk.id, outcome: "eligible", candidateId });
          continue;
        }
        if (!(await markerRemains(repo, path, hunk))) {
          skipped += 1;
          reports.push({
            hunkId: hunk.id,
            outcome: "skipped",
            candidateId,
            reason: "Conflict markers are already gone.",
          });
          continue;
        }
        await client.act(
          session.sessionId,
          { type: "accept", hunkId: hunk.id, candidateId },
          CI_ACTOR,
        );
        counted.add(path);
        applied += 1;
        reports.push({ hunkId: hunk.id, outcome: "applied", candidateId });
        await audit(repo, "ok", "Applied a recommended candidate.", path, hunk.id);
      }
      if (reports.some((report) => report.outcome === "applied")) {
        await stageIfResolved(repo, path);
      }
      files.push({ path: conceal(path, redactions), hunks: reports });
    }
    const after = await client.listConflicts(repo);
    const remaining = after.files.length;
    const wrote = applied > 0;
    if (!wrote) {
      const message = options.dryRun
        ? `Dry run. ${String(eligible)} eligible resolution(s). Nothing was written.`
        : `Reported ${String(session.files.length)} conflict(s). Nothing was written.`;
      await audit(repo, "ok", message);
    }
    return {
      code: remaining === 0 ? 0 : 1,
      result: {
        mode: policy.mode,
        dryRun: options.dryRun,
        wrote,
        conflicts: session.files.length,
        applied,
        eligible,
        skipped,
        remaining,
        redactions: redactions.count,
        files,
      },
    };
  });
}

function statusOf(checks: readonly Check[], kind: Check["kind"]): CheckStatus {
  return checks.find((check) => check.kind === kind)?.status ?? "unknown";
}

function conceal(value: string, redactions: { count: number }): Untrusted {
  const redacted = redactSecrets(value);
  redactions.count += redacted.redactions;
  return { untrusted: true, value: redacted.text };
}

async function stageIfResolved(repo: string, path: string): Promise<void> {
  const relative = repoRelativePath(repo, path);
  if (relative === null) return;
  const text = await readFile(join(repo, relative), "utf8");
  if (text.includes("<<<<<<<")) return;
  await git(repo, ["add", "--", relative]);
}

/**
 * True when the hunk range still contains a conflict marker.
 * Paths that leave the repository are refused and are not read.
 */
export async function markerRemains(
  repo: string,
  path: string,
  hunk: ConflictHunk,
): Promise<boolean> {
  const relative = repoRelativePath(repo, path);
  if (relative === null) return false;
  const text = await readFile(join(repo, relative), "utf8");
  const lines = text.split(/\r?\n/);
  const slice = lines.slice(hunk.range.startLine - 1, hunk.range.endLine).join("\n");
  return slice.includes("<<<<<<<");
}

async function audit(
  repo: string,
  outcome: AuditRecord["outcome"],
  message: string,
  path?: string,
  hunkId?: string,
): Promise<void> {
  const record: AuditRecord = {
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: CI_ACTOR,
    tool: "ci",
    outcome,
    message,
  };
  if (path !== undefined) record.path = path;
  if (hunkId !== undefined) record.hunkId = hunkId;
  await appendAuditRecord(repo, record);
}
