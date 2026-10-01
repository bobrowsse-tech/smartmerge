import { stat } from "node:fs/promises";
import { replayConflicts, type ReplayReport } from "@smartmerge/core";
import { fetchClonedConflicts, fetchConflictFiles, type FetchedConflict } from "./corpus.js";

/** One repository to fetch. `name` is the label stored on rows, not a commit message. */
export interface MeasureSource {
  name: string;
  source: string;
}

/**
 * Read a local source list.
 * A source is a repository URL or a local path. This does not score calibration.
 */
export function parseMeasureSources(input: unknown): MeasureSource[] {
  if (!Array.isArray(input)) throw new Error("Sources must be an array.");
  if (input.length === 0) throw new Error("At least one source is required.");
  if (input.length > 50) throw new Error("At most 50 sources can be measured in one run.");
  return input.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("Each source must be an object.");
    }
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const source = typeof record.source === "string" ? record.source.trim() : "";
    if (name.length === 0 || name.length > 200) {
      throw new Error("Each source name must be 1 to 200 characters.");
    }
    if (source.length === 0) throw new Error("Each source needs a repository URL or a local path.");
    return { name, source };
  });
}

/**
 * Fetch conflicted files from each source.
 * A URL is cloned into a temporary directory and deleted. A local path is only read.
 */
/** A URL or a `user@host:path` source is cloned. Anything else is a local repository path. */
export function isCloneSource(source: string): boolean {
  if (source.includes("://")) return true;
  return /^[^\s@]+@[^\s:]+:\S+$/.test(source);
}

export async function collectMeasuredConflicts(
  sources: readonly MeasureSource[],
  limit: number,
): Promise<FetchedConflict[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("The merge limit must be an integer from 1 to 500.");
  }
  const found: FetchedConflict[] = [];
  for (const source of sources) {
    found.push(...(await conflictsFromSource(source, limit)));
  }
  return found;
}

async function conflictsFromSource(
  source: MeasureSource,
  limit: number,
): Promise<FetchedConflict[]> {
  if (isCloneSource(source.source)) {
    return await fetchClonedConflicts(source.source, source.name, limit);
  }
  try {
    if ((await stat(source.source)).isDirectory()) {
      return await fetchConflictFiles({ repoRoot: source.source, repository: source.name, limit });
    }
  } catch {
    // A missing path is reported below.
  }
  throw new Error("Each source needs a repository URL or a local path.");
}

/** Turn fetched files into fixed-score prediction rows. This does not score calibration. */
export async function replayMeasuredConflicts(
  conflicts: readonly FetchedConflict[],
): Promise<ReplayReport> {
  return replayConflicts(
    conflicts.map((conflict) => ({
      repository: conflict.repository,
      path: conflict.path,
      conflicted: conflict.conflicted,
      base: conflict.base,
      humanResult: conflict.humanResult,
    })),
  );
}
