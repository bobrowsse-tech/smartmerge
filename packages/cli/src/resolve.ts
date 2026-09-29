import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { ConflictHunk, ResolutionProposal } from "@smartmerge/protocol";
import { DaemonClient, withDaemon } from "@smartmerge/daemon";

const execFileAsync = promisify(execFile);

export type ExitCode = 0 | 1 | 2;

export interface CommandResult {
  code: ExitCode;
  text: string;
}

/**
 * Apply only recommendations the engine already marked safe for automatic apply.
 * This runs because the user passed `--auto` or git invoked the mergetool.
 * It does not change the saved automatic-apply setting.
 */
export async function resolveAuto(repo: string, file?: string): Promise<CommandResult> {
  return withDaemon(repo, async (client) => {
    await client.initialize(repo);
    const session = await client.listConflicts(repo);
    const files = session.files.filter((entry) => file === undefined || entry.file.path === file);
    if (file !== undefined && files.length === 0) {
      throw new Error(`No conflicted file at ${file}`);
    }
    let applied = 0;
    for (const entry of files) {
      const proposals = await client.propose(session.sessionId, entry.file.path);
      applied += await applyEligible(client, session.sessionId, entry.file.hunks, proposals);
    }
    const remaining = await countMarkers(
      repo,
      files.map((entry) => entry.file.path),
    );
    const text =
      applied === 0
        ? "No certain resolution was eligible. Nothing was written.\n"
        : `Applied ${String(applied)} certain resolution(s). ${String(remaining)} file(s) still contain conflict markers.\n`;
    return { code: remaining === 0 ? 0 : 1, text };
  });
}

/**
 * Show recommendations. A terminal can accept one. Without a terminal the
 * command prints the list and does not wait, so an SSH session without a TTY
 * cannot hang.
 */
export async function resolveInteractive(
  repo: string,
  file: string | undefined,
  tty: boolean,
  ask?: (prompt: string) => Promise<string>,
): Promise<CommandResult> {
  return withDaemon(repo, async (client) => {
    await client.initialize(repo);
    const session = await client.listConflicts(repo);
    const files = session.files.filter((entry) => file === undefined || entry.file.path === file);
    if (files.length === 0) return { code: 0, text: "No conflicts.\n" };
    if (!tty || ask === undefined) {
      const lines = [
        "Conflicts remain. Pass --auto to apply certain resolutions, or use a terminal to choose.",
        "",
      ];
      for (const entry of files) {
        const proposals = await client.propose(session.sessionId, entry.file.path);
        lines.push(`${entry.file.path}: ${headline(proposals)}`);
      }
      return { code: 1, text: `${lines.join("\n")}\n` };
    }
    let applied = 0;
    for (const entry of files) {
      const proposals = await client.propose(session.sessionId, entry.file.path);
      const answer = (
        await ask(`${entry.file.path}: ${headline(proposals)}\nAccept the recommendation? [y/N] `)
      )
        .trim()
        .toLowerCase();
      if (answer !== "y" && answer !== "yes") continue;
      applied += await applyChosen(client, session.sessionId, entry.file.hunks, proposals);
    }
    const remaining = await countMarkers(
      repo,
      files.map((entry) => entry.file.path),
    );
    return {
      code: remaining === 0 ? 0 : 1,
      text: `Applied ${String(applied)} recommendation(s). ${String(remaining)} file(s) still contain conflict markers.\n`,
    };
  });
}

/** git mergetool entry. Exit 0 when the merged file has no conflict markers. */
export async function runMergetool(
  base: string,
  local: string,
  remote: string,
  merged: string,
): Promise<CommandResult> {
  for (const [label, file] of [
    ["BASE", base],
    ["LOCAL", local],
    ["REMOTE", remote],
    ["MERGED", merged],
  ] as const) {
    if (file.length === 0) throw new Error(`Missing ${label} path`);
  }
  const mergedReal = await realpath(merged);
  const repo = await realpath(await repoRoot(mergedReal));
  const path = repoPath(repo, mergedReal);
  const result = await resolveAuto(repo, path);
  if (result.code === 0) return { code: 0, text: `Resolved ${path}.\n` };
  return { code: 1, text: `Left ${path} unresolved.\n${result.text}` };
}

/** Point this repository's merge tool at the command. Does not change global git config. */
export async function installMergetool(repo: string): Promise<string> {
  const cmd = 'smart-merge mergetool "$BASE" "$LOCAL" "$REMOTE" "$MERGED"';
  await git(repo, ["config", "merge.tool", "smartmerge"]);
  await git(repo, ["config", "mergetool.smartmerge.cmd", cmd]);
  await git(repo, ["config", "mergetool.smartmerge.trustExitCode", "true"]);
  return "Installed the mergetool for this repository. Git will trust its exit code.\n";
}

async function applyEligible(
  client: DaemonClient,
  sessionId: string,
  hunks: readonly ConflictHunk[],
  proposals: readonly ResolutionProposal[],
): Promise<number> {
  const chosen = choices(hunks, proposals).filter((item) => item.eligible);
  for (const item of chosen) {
    await client.act(sessionId, {
      type: "accept",
      hunkId: item.hunkId,
      candidateId: item.candidateId,
    });
  }
  return chosen.length;
}

async function applyChosen(
  client: DaemonClient,
  sessionId: string,
  hunks: readonly ConflictHunk[],
  proposals: readonly ResolutionProposal[],
): Promise<number> {
  const chosen = choices(hunks, proposals).filter((item) => item.safeToConfirm);
  for (const item of chosen) {
    await client.act(sessionId, {
      type: "accept",
      hunkId: item.hunkId,
      candidateId: item.candidateId,
    });
  }
  return chosen.length;
}

function choices(
  hunks: readonly ConflictHunk[],
  proposals: readonly ResolutionProposal[],
): Array<{
  hunkId: string;
  candidateId: string;
  startLine: number;
  eligible: boolean;
  safeToConfirm: boolean;
}> {
  const chosen = [];
  for (const proposal of proposals) {
    if (proposal.recommended === null) continue;
    const candidate = proposal.candidates.find((item) => item.id === proposal.recommended);
    if (
      !candidate ||
      candidate.hazardous ||
      candidate.checks.some((check) => check.status === "fail")
    ) {
      continue;
    }
    const hunk = hunks.find((item) => item.id === proposal.hunkId);
    chosen.push({
      hunkId: proposal.hunkId,
      candidateId: candidate.id,
      startLine: hunk?.range.startLine ?? 0,
      eligible: proposal.autoApplyEligible && candidate.band === "certain",
      safeToConfirm: true,
    });
  }
  chosen.sort((left, right) => right.startLine - left.startLine);
  return chosen;
}

function headline(proposals: readonly ResolutionProposal[]): string {
  const chosen = proposals.find((proposal) => proposal.recommended !== null);
  return chosen?.explanation.headline ?? "No recommendation";
}

async function countMarkers(repo: string, paths: readonly string[]): Promise<number> {
  let remaining = 0;
  for (const path of paths) {
    const text = await readFile(resolve(repo, path), "utf8");
    if (text.includes("<<<<<<<")) remaining += 1;
  }
  return remaining;
}

async function repoRoot(file: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", resolve(file, ".."), "rev-parse", "--show-toplevel"],
    {
      windowsHide: true,
    },
  );
  return stdout.trim();
}

function repoPath(repo: string, file: string): string {
  const path = relative(repo, resolve(file)).split(sep).join("/");
  if (path.startsWith("..") || path === "")
    throw new Error("The merged file is outside the repository");
  return path;
}

async function git(repo: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: repo, windowsHide: true });
}
