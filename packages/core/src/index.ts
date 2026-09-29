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
export { initParsers, isStructuralLanguage, parseSource, parsersReady } from "./parse.js";
export { summarizeDashboard } from "./dashboard.js";
export { proposeForFile } from "./strategies.js";
export { mergeRegions, onlyImportChanges, renameMerge } from "./structure.js";
export { verifyParsed } from "./verify.js";
export { normalizeWhitespace } from "./whitespace.js";
export { replaceHunk } from "./apply.js";
export { llmPayloadPreview } from "./llm.js";
