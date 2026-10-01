export {
  assertCorpusDestination,
  fetchConflictFiles,
  writeConflictFiles,
  type FetchedConflict,
  type FetchConflictsOptions,
} from "./corpus.js";
export {
  findRepoRoot,
  git,
  GitCommandError,
  listUnmerged,
  readOperation,
  type UnmergedFile,
} from "./run.js";
export { enrichLineage, parseCommitLog, readRangeCommits } from "./lineage.js";
export {
  appendAuditRecord,
  appendSessionLog,
  backupWorkingFile,
  commitAtomic,
  readAuditLog,
  readSessionLog,
  readWorkingBytes,
  removeWorkingFile,
  restoreBackup,
  snapshotWorkingFile,
  stageAtomic,
  writeAtomic,
} from "./working-tree.js";
