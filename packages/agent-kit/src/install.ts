import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appendSessionLog, findRepoRoot, snapshotWorkingFile, writeAtomic } from "@smartmerge/git";
import type { SessionLogEntry } from "@smartmerge/protocol";
import {
  AGENTS_MARK_END,
  AGENTS_MARK_START,
  agentsSection,
  skillMarkdown,
} from "./instructions.js";

/** Files written by {@link installAgentKit}. */
export interface AgentKitInstall {
  agentsPath: string;
  skillPath: string;
  /** True when an existing marked section was replaced. */
  updated: boolean;
}

const SKILL_PATH = ".smartmerge/skills/resolve-conflicts/SKILL.md";

/**
 * Install the conflict-resolution workflow at the Git root.
 * Each destination is snapshotted first, written atomically, and recorded so `smart-merge undo` can restore it.
 * An existing AGENTS.md keeps every character outside the marked section.
 */
export async function installAgentKit(start: string): Promise<AgentKitInstall> {
  const repoRoot = await findRepoRoot(start);
  const agentsPath = join(repoRoot, "AGENTS.md");
  const skillPath = join(repoRoot, SKILL_PATH);
  let existing = "";
  try {
    existing = await readFile(agentsPath, "utf8");
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  const updated = existing.includes(AGENTS_MARK_START);
  const nextAgents = mergeAgentsFile(existing, agentsSection());
  await replaceTracked(repoRoot, SKILL_PATH, skillMarkdown());
  await replaceTracked(repoRoot, "AGENTS.md", nextAgents);
  return { agentsPath, skillPath, updated };
}

async function replaceTracked(repoRoot: string, path: string, text: string): Promise<void> {
  const snapshot = await snapshotWorkingFile(repoRoot, path);
  const target = join(repoRoot, path);
  await mkdir(dirname(target), { recursive: true });
  await writeAtomic(target, Buffer.from(text, "utf8"));
  const entry: SessionLogEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: { kind: "human" },
    path,
    hunkId: "agent-kit",
    action: "edited",
    backupId: snapshot.id,
  };
  if (snapshot.absent) entry.absentBefore = true;
  await appendSessionLog(repoRoot, entry);
}

function mergeAgentsFile(existing: string, section: string): string {
  const start = existing.indexOf(AGENTS_MARK_START);
  const end = existing.indexOf(AGENTS_MARK_END);
  if (start === -1 && end === -1) {
    if (existing.length === 0) return section;
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    return `${existing}${separator}${section}`;
  }
  if (start === -1 || end === -1 || end < start) {
    throw new Error("AGENTS.md has an incomplete SmartMergeResolver section.");
  }
  const before = existing.slice(0, start);
  let cursor = end + AGENTS_MARK_END.length;
  if (existing.startsWith("\r\n", cursor)) cursor += 2;
  else if (existing.startsWith("\n", cursor) || existing.startsWith("\r", cursor)) cursor += 1;
  const after = existing.slice(cursor);
  const body = section.endsWith("\n") ? section : `${section}\n`;
  return `${before}${body}${after}`;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
