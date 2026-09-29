import type { ConflictSession, ResolutionProposal } from "@smartmerge/protocol";
import { withDaemon } from "@smartmerge/daemon";

export interface StatusReport {
  repoRoot: string;
  session: ConflictSession;
  proposals: Map<string, ResolutionProposal[]>;
  text: string;
}

/** Ask the daemon for conflicted files and a deterministic proposal for each. */
export async function statusReport(start: string): Promise<StatusReport> {
  return withDaemon(start, async (client) => {
    await client.initialize(start);
    const session = await client.listConflicts(start);
    const proposals = new Map<string, ResolutionProposal[]>();
    for (const entry of session.files) {
      proposals.set(entry.file.path, await client.propose(session.sessionId, entry.file.path));
    }
    return {
      repoRoot: session.repoRoot,
      session,
      proposals,
      text: formatStatus(session, proposals),
    };
  });
}

/** Human-readable status. A recommendation is a review hint, not an applied change. */
export function formatStatus(
  session: ConflictSession,
  proposals: Map<string, ResolutionProposal[]>,
): string {
  if (session.files.length === 0) return "No conflicts.\n";
  const noun = session.files.length === 1 ? "file" : "files";
  const lines = [`${String(session.files.length)} conflicted ${noun}`, ""];
  for (const entry of session.files) {
    const hunks = entry.file.hunks.length;
    const hunkNoun = hunks === 1 ? "hunk" : "hunks";
    lines.push(entry.file.path);
    lines.push(
      `  ${entry.file.kind}, ${String(hunks)} ${hunkNoun}, ${recommendation(proposals.get(entry.file.path))}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function recommendation(proposals: ResolutionProposal[] | undefined): string {
  const chosen = proposals?.find((proposal) => proposal.recommended !== null);
  if (!chosen?.recommended) return "no recommendation yet";
  const candidate = chosen.candidates.find((item) => item.id === chosen.recommended);
  const band = candidate?.band ?? "medium";
  return `${band}: ${chosen.explanation.headline}`;
}
