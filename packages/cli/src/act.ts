import type { ResolutionProposal } from "@smartmerge/protocol";
import { withDaemon } from "@smartmerge/daemon";
import { CommandFailure } from "./failure.js";

/**
 * Apply one explicit candidate, or every recommended candidate in the file.
 * The previous bytes are backed up first. Nothing is applied when there is no recommendation
 * and no candidate id.
 */
export async function applyFile(
  start: string,
  path: string,
  candidateId: string | undefined,
  acceptHazardous = false,
  hunkId?: string,
): Promise<string> {
  return withDaemon(start, async (client) => {
    await client.initialize(start);
    const session = await client.listConflicts(start);
    const row = session.files.find((item) => item.file.path === path);
    if (!row) throw new Error(`No conflicted file at ${path}`);
    const proposals = await client.propose(session.sessionId, path);
    if (hunkId !== undefined && !row.file.hunks.some((hunk) => hunk.id === hunkId)) {
      throw new CommandFailure(2, "NOT_FOUND", `No hunk ${hunkId}`);
    }
    const chosen = selectCandidates(row.file.hunks, proposals, candidateId, hunkId);
    if (chosen.length === 0) {
      throw new Error(`No recommendation for ${path}. Pass --candidate to choose a side.`);
    }
    for (const item of chosen) {
      const candidate = proposals
        .flatMap((proposal) => proposal.candidates)
        .find((entry) => entry.id === item.candidateId);
      if (candidate?.hazardous === true && !acceptHazardous) {
        throw new CommandFailure(
          3,
          "POLICY_BLOCKED",
          "Refusing to apply a hazardous candidate.",
          "Pass --accept-hazardous to write it anyway.",
        );
      }
      await client.act(session.sessionId, {
        type: "accept",
        hunkId: item.hunkId,
        candidateId: item.candidateId,
        ...(candidate?.hazardous === true ? { acceptHazardous: true } : {}),
      });
    }
    return `Applied ${String(chosen.length)} hunk(s) in ${path}. The previous file is backed up and can be restored with smart-merge undo.\n`;
  });
}

/** Restore the newest backup that has not already been undone. */
export async function undoApply(start: string): Promise<string> {
  return withDaemon(start, async (client) => {
    await client.initialize(start);
    const session = await client.listConflicts(start);
    const result = await client.act(session.sessionId, { type: "undo" });
    const entry = result.log[0];
    if (!entry) throw new Error("Undo did not record a log entry");
    return `Restored ${entry.path} from backup ${entry.backupId}.\n`;
  });
}

function selectCandidates(
  hunks: ReadonlyArray<{ id: string; range: { startLine: number } }>,
  proposals: ResolutionProposal[],
  candidateId: string | undefined,
  hunkId: string | undefined,
): Array<{ hunkId: string; candidateId: string; startLine: number }> {
  const chosen: Array<{ hunkId: string; candidateId: string; startLine: number }> = [];
  for (const proposal of proposals) {
    if (hunkId !== undefined && proposal.hunkId !== hunkId) continue;
    const hunk = hunks.find((item) => item.id === proposal.hunkId);
    const startLine = hunk?.range.startLine ?? 0;
    if (candidateId !== undefined) {
      if (proposal.candidates.some((candidate) => candidate.id === candidateId)) {
        chosen.push({ hunkId: proposal.hunkId, candidateId, startLine });
      }
      continue;
    }
    if (proposal.recommended !== null) {
      chosen.push({ hunkId: proposal.hunkId, candidateId: proposal.recommended, startLine });
    }
  }
  chosen.sort((left, right) => right.startLine - left.startLine);
  return chosen;
}
