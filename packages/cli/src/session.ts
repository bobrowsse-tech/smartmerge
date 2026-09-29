import type { ConflictSession, DashboardSummary } from "@smartmerge/protocol";
import { withDaemon } from "@smartmerge/daemon";

export interface LoadedConflicts {
  repoRoot: string;
  session: ConflictSession;
  summary: DashboardSummary;
}

/**
 * List conflicted files and ask the daemon for a proposal and dashboard row for each.
 * Callers render this state. They do not merge it here.
 */
export async function loadConflicts(start: string): Promise<LoadedConflicts> {
  return withDaemon(start, async (client) => {
    await client.initialize(start, "1.0.0", {
      clientName: "smart-merge",
      workspaceTrusted: true,
      supportsWebview: true,
    });
    const session = await client.listConflicts(start);
    for (const entry of session.files) {
      entry.proposals = await client.propose(session.sessionId, entry.file.path);
    }
    const summary = await client.dashboard(session.sessionId);
    return { repoRoot: session.repoRoot, session, summary };
  });
}
