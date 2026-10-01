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
  restoreBackup,
  stageAtomic,
  writeAtomic,
} from "./working-tree.js";
