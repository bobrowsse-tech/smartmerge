import { readFile } from "node:fs/promises";
import type { ResolutionProposal, VerifyResult } from "@smartmerge/protocol";
import { withDaemon } from "@smartmerge/daemon";
import { applyFile, undoApply } from "./act.js";
import { CommandFailure } from "./failure.js";
import { resolveAuto, resolveInteractive } from "./resolve.js";
import { statusReport } from "./status.js";

const MAX_RESULT_BYTES = 1_000_000;

/** Conflict list as JSON. Exit 1 when conflicts remain. */
export async function statusJson(start: string): Promise<{ code: 0 | 1; result: unknown }> {
  const report = await statusReport(start);
  for (const entry of report.session.files) {
    entry.proposals = report.proposals.get(entry.file.path) ?? [];
  }
  return {
    code: report.session.files.length === 0 ? 0 : 1,
    result: report.session,
  };
}

/** Proposals for one conflicted file. */
export async function proposeJson(
  start: string,
  path: string,
  hunkId: string | undefined,
  compact: boolean,
): Promise<unknown> {
  return withDaemon(start, async (client) => {
    await client.initialize(start);
    const session = await client.listConflicts(start);
    const row = session.files.find((item) => item.file.path === path);
    if (!row) throw new CommandFailure(2, "NOT_FOUND", `No conflicted file at ${path}`);
    let proposals = await client.propose(session.sessionId, path);
    if (hunkId !== undefined) proposals = proposals.filter((item) => item.hunkId === hunkId);
    return compact ? proposals.map(compactProposal) : proposals;
  });
}

/**
 * Check resolution text for one hunk.
 * Exit 4 when syntax or symbols fail. The working tree is not written.
 */
export async function verifyFile(
  start: string,
  path: string,
  hunkId: string,
  resultText: string,
): Promise<{ code: 0 | 4; result: VerifyResult }> {
  if (resultText.length > MAX_RESULT_BYTES) {
    throw new CommandFailure(
      2,
      "TOO_LARGE",
      "Result text is too large.",
      "Shorten the resolution and try again.",
    );
  }
  const result = await withDaemon(start, async (client) => {
    await client.initialize(start);
    const session = await client.listConflicts(start);
    const row = session.files.find((item) => item.file.path === path);
    if (!row) throw new CommandFailure(2, "NOT_FOUND", `No conflicted file at ${path}`);
    if (!row.file.hunks.some((hunk) => hunk.id === hunkId)) {
      throw new CommandFailure(2, "NOT_FOUND", `No hunk ${hunkId}`);
    }
    return client.verify({
      sessionId: session.sessionId,
      path,
      hunkId,
      resultText,
    });
  });
  return { code: result.hazardous || result.overall === "fail" ? 4 : 0, result };
}

export async function readResultText(resultFile: string): Promise<string> {
  if (resultFile === "-") return readStdin();
  return readFile(resultFile, "utf8");
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer | string): void => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buffer.length;
      if (size > MAX_RESULT_BYTES) {
        reject(
          new CommandFailure(
            2,
            "TOO_LARGE",
            "Result text is too large.",
            "Shorten the resolution and try again.",
          ),
        );
        return;
      }
      chunks.push(buffer);
    };
    process.stdin.on("data", onData);
    process.stdin.once("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    process.stdin.once("error", reject);
  });
}

/** Explicit apply. A hazardous candidate is refused unless the caller accepts it. */
export async function applyExplicit(
  start: string,
  path: string,
  candidateId: string | undefined,
  acceptHazardous: boolean,
): Promise<string> {
  return applyFile(start, path, candidateId, acceptHazardous);
}

export async function undoExplicit(start: string): Promise<string> {
  return undoApply(start);
}

/** Automatic resolve, or a non-interactive list when --json is set. Never prompts. */
export async function resolveJson(
  start: string,
  file: string | undefined,
  auto: boolean,
): Promise<{ code: 0 | 1; result: { text: string } }> {
  const result = auto
    ? await resolveAuto(start, file)
    : await resolveInteractive(start, file, false);
  return { code: result.code === 0 ? 0 : 1, result: { text: result.text } };
}

function compactProposal(proposal: ResolutionProposal): unknown {
  return {
    hunkId: proposal.hunkId,
    recommended: proposal.recommended,
    headline: proposal.explanation.headline,
    candidates: proposal.candidates.map((candidate) => ({
      id: candidate.id,
      strategy: candidate.strategy,
      band: candidate.band,
      hazardous: candidate.hazardous,
      checks: candidate.checks.map((check) => ({ kind: check.kind, status: check.status })),
    })),
  };
}
