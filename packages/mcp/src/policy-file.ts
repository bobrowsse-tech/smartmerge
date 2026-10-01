import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parsePolicyOverlay } from "@smartmerge/core";
import type { AgentPolicy } from "@smartmerge/protocol";

/** Read `.smartmerge/policy.json`. A missing file adds no extra limits. */
export async function readRepoPolicy(repoRoot: string): Promise<Partial<AgentPolicy>> {
  let text: string;
  try {
    text = await readFile(join(repoRoot, ".smartmerge", "policy.json"), "utf8");
  } catch (error) {
    if (isNotFound(error)) return {};
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Policy file is not valid JSON.");
  }
  return parsePolicyOverlay(parsed);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
