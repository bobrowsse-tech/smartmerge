import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

/**
 * Install the conflict-resolution workflow into a repository.
 * An existing AGENTS.md keeps its other text. A second install replaces only the marked section.
 */
export async function installAgentKit(repoRoot: string): Promise<AgentKitInstall> {
  const agentsPath = join(repoRoot, "AGENTS.md");
  const skillPath = join(repoRoot, ".smartmerge", "skills", "resolve-conflicts", "SKILL.md");
  await mkdir(dirname(skillPath), { recursive: true });
  await writeFile(skillPath, skillMarkdown());
  let existing = "";
  try {
    existing = await readFile(agentsPath, "utf8");
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  const updated = existing.includes(AGENTS_MARK_START);
  await writeFile(agentsPath, mergeAgentsFile(existing, agentsSection()));
  return { agentsPath, skillPath, updated };
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
  const before = existing.slice(0, start).replace(/\s*$/, "");
  const after = existing.slice(end + AGENTS_MARK_END.length).replace(/^\s*/, "");
  const parts: string[] = [];
  if (before.length > 0) parts.push(before);
  parts.push(section.trimEnd());
  if (after.length > 0) parts.push(after);
  return `${parts.join("\n\n")}\n`;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
