import type { ConflictKind } from "@smartmerge/protocol";

/** Facts git can see without parsing conflict markers. */
export interface ConflictFacts {
  binary: boolean;
  basePresent: boolean;
  oursPresent: boolean;
  theirsPresent: boolean;
  /** Stage 2 and stage 3 modes differ. */
  modeDiffers: boolean;
  /** Stage 2 and stage 3 blob text are equal. */
  contentSame: boolean;
  /** `MERGE_MSG` reports a rename/rename that names this path. */
  renameRename: boolean;
}

/**
 * Classify an unmerged path.
 * Mode, rename/rename, binary, add/add, and modify/delete are surfaced for the user.
 * Content conflicts are the ones the deterministic strategies can read.
 */
export function classifyConflict(facts: ConflictFacts): ConflictKind {
  if (facts.binary) return "binary";
  if (facts.renameRename) return "rename-rename";
  if (facts.modeDiffers && facts.contentSame && facts.oursPresent && facts.theirsPresent) {
    return "mode";
  }
  if (!facts.basePresent && facts.oursPresent && facts.theirsPresent) return "add-add";
  if (!facts.oursPresent || !facts.theirsPresent) return "modify-delete";
  return "content";
}

/**
 * True when git's merge message reports a rename/rename for `path`.
 * The message is git's own English text, not translated UI status.
 */
export function mentionsRenameConflict(message: string, path: string): boolean {
  if (!message.includes("rename/rename")) return false;
  return message.includes(path);
}
