import { withDaemon } from "@smartmerge/daemon";
import { acceptChoice, type ExplicitChoice } from "./present.js";

/**
 * Ask the daemon to apply one candidate for one file.
 * The editor calls this. It does not merge the text itself.
 */
export async function acceptFile(
  repoRoot: string,
  path: string,
  workspaceTrusted: boolean,
  choice?: ExplicitChoice,
): Promise<boolean> {
  return withDaemon(repoRoot, async (client) => {
    await client.initialize(repoRoot, "1.0.0", {
      clientName: "smartmerge-editor",
      workspaceTrusted,
      supportsWebview: true,
    });
    const session = await client.listConflicts(repoRoot);
    const proposals = await client.propose(session.sessionId, path);
    const action = acceptChoice(proposals, choice);
    if (!action) return false;
    await client.act(session.sessionId, action, { kind: "human" });
    return true;
  });
}

/** Restore the newest backup. */
export async function undoFile(repoRoot: string): Promise<void> {
  await withDaemon(repoRoot, async (client) => {
    await client.initialize(repoRoot, "1.0.0", { clientName: "smartmerge-editor" });
    const session = await client.listConflicts(repoRoot);
    await client.act(session.sessionId, { type: "undo" }, { kind: "human" });
  });
}
