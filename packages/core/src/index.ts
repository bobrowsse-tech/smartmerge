export {
  buildConflict,
  defaultConfig,
  parseConflictHunks,
  recoverHunkBase,
  splitLines,
  stubProposals,
  toConflictFile,
  type BuiltConflict,
  type ConflictSource,
  type StageText,
} from "./conflicts.js";
export { classifyConflict, mentionsRenameConflict, type ConflictFacts } from "./classify.js";
export { proposeForFile } from "./strategies.js";
export { normalizeWhitespace } from "./whitespace.js";
export { replaceHunk } from "./apply.js";
export { llmPayloadPreview } from "./llm.js";
