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
export { verifyParsed, verifyResolution } from "./verify.js";
export { normalizeWhitespace } from "./whitespace.js";
export { replaceHunk } from "./apply.js";
export { llmPayloadPreview } from "./llm.js";
export {
  decideCandidate,
  decideLlm,
  decideWriteGate,
  parsePolicyOverlay,
  pathIsProtected,
  repoRelativePath,
  tightenPolicy,
  type PolicyDecision,
  type PolicyDenial,
} from "./policy.js";
export { redactSecrets } from "./redact.js";
export { REPLAY_CASES, replayPath, type ReplayCase } from "./corpus.js";
export {
  CHANGE_CLASSES,
  FEATURE_NAMES,
  SCORING_L2,
  candidateBand,
  confidenceCap,
  fitScoringModel,
  parseScoringModel,
  parseTrainingExamples,
  scoreFeatures,
  type ChangeClass,
  type PlattScale,
  type ScoreCheck,
  type ScoreFeatures,
  type ScoredConfidence,
  type ScoringModel,
  type TrainingExample,
} from "./logistic.js";
