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
  appendSessionLog,
  backupWorkingFile,
  commitAtomic,
  readSessionLog,
  readWorkingBytes,
  restoreBackup,
  stageAtomic,
  writeAtomic,
} from "./working-tree.js";
