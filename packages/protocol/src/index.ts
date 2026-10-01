/**
 * SmartMergeResolver protocol — single source of truth for all cross-package contracts.
 * Seed `packages/protocol/src/index.ts` with this file verbatim.
 * Transport: JSON-RPC 2.0 over stdio or local socket. Version negotiated in `initialize`.
 */

export const PROTOCOL_VERSION = "1.0.0" as const;

/* ───────────── Primitives ───────────── */

export type ISODateTime = string; // RFC 3339
export type RepoPath = string; // POSIX-style, relative to repo root
export type Confidence = number; // 0..1, calibrated probability

export interface Range {
  /** 1-based inclusive line numbers in the *conflicted working file*. */
  startLine: number;
  endLine: number;
}

/* ───────────── Git / operation context ───────────── */

export type GitOperation = "merge" | "rebase" | "cherry-pick" | "stash-pop" | "revert";

export interface SideInfo {
  /** Human label: branch name or short sha. Never just "ours"/"theirs". */
  label: string;
  /** Raw git role; note that rebase inverts ours/theirs. */
  role: "ours" | "theirs";
  commitSha: string;
}

export interface OperationContext {
  operation: GitOperation;
  current: SideInfo;
  incoming: SideInfo;
  mergeBaseSha: string | null;
}

/* ───────────── Temporal / lineage context ───────────── */

export type ChangeClass =
  "rename" | "formatting" | "add" | "delete" | "move" | "logic" | "dependency-bump" | "comment";

export interface CommitInfo {
  sha: string;
  author: string;
  authoredAt: ISODateTime;
  subject: string;
  body?: string;
  refs: LinkedRef[];
}

export interface LinkedRef {
  kind: "issue" | "pull-request" | "ticket";
  id: string; // "#123", "JIRA-456"
  title?: string;
  url?: string;
  provider?: string;
}

export interface SideContext {
  side: "current" | "incoming" | "base";
  commits: CommitInfo[]; // ordered oldest -> newest, touching the conflict range
  changeClasses: ChangeClass[];
  /** Milliseconds between newest commit on this side and `now`. */
  ageMs: number | null;
  intentSummary?: string; // deterministic (commit subject) or optional LLM
}

export interface TemporalContext {
  current: SideContext;
  incoming: SideContext;
  base: SideContext;
  /** Positive => incoming is newer. Informational; never decisive. */
  incomingNewerByMs: number | null;
}

/* ───────────── Conflicts ───────────── */

export type ConflictKind =
  "content" | "add-add" | "modify-delete" | "rename-rename" | "mode" | "binary";

export interface ConflictHunk {
  id: string;
  range: Range;
  base: string;
  current: string;
  incoming: string;
  temporal: TemporalContext;
  /** Semantic operations per side, for the intent strip and semantic diff. */
  semanticChanges: SemanticChange[];
}

export interface ConflictFile {
  path: RepoPath;
  kind: ConflictKind;
  languageId: string | null;
  hunks: ConflictHunk[];
  operation: OperationContext;
}

/* ───────────── Verification ───────────── */

export type CheckKind = "syntax" | "symbols" | "types" | "lint" | "tests-hint";
export type CheckStatus = "pass" | "fail" | "unknown";

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  path: RepoPath;
  range: Range;
  code?: string;
  source: string;
  /** True when the same diagnostic exists on a pre-merge side (not blamed on candidate). */
  preExisting: boolean;
}

export interface Check {
  kind: CheckKind;
  status: CheckStatus;
  diagnostics: Diagnostic[];
  durationMs: number;
  /** Populated when status is "unknown", e.g. "timeout", "tool-missing". */
  reason?: string;
}

/* ───────────── Candidates and proposals ───────────── */

export type StrategyId =
  | "identical"
  | "one-side-unchanged"
  | "whitespace-format"
  | "structural-3way"
  | "rename-aware"
  | "list-union"
  | "lockfile-regenerate"
  | "llm-assisted"
  | "manual-current"
  | "manual-incoming"
  | "manual-both-current-first"
  | "manual-both-incoming-first";

export interface EvidenceItem {
  /** Stable code for templating and calibration features. */
  code: string;
  text: string;
  weight?: number;
}

export type ConfidenceBand = "certain" | "high" | "medium" | "low";

export interface Candidate {
  id: string;
  hunkId: string;
  strategy: StrategyId;
  /** Full replacement text for the hunk range. */
  result: string;
  checks: Check[];
  hazardous: boolean;
  confidence: Confidence;
  band: ConfidenceBand;
  evidence: EvidenceItem[];
}

export interface ResolutionProposal {
  hunkId: string;
  recommended: string | null; // candidate id; null when band is "low"
  candidates: Candidate[];
  explanation: Explanation;
  autoApplyEligible: boolean;
}

export interface Explanation {
  headline: string; // "Merge both — different functions edited"
  bullets: string[];
  verificationSummary: string;
  temporalSummary: string;
}

/* ───────────── Visual / semantic presentation (docs 05, 11) ───────────── */

export type SemanticOpKind =
  | "rename"
  | "add-param"
  | "remove-param"
  | "add-member"
  | "remove-member"
  | "move"
  | "signature-change"
  | "body-change"
  | "import-change"
  | "formatting-only"
  | "comment-only";

/** A human-readable operation shown as a "change chip" in the intent strip and semantic diff. */
export interface SemanticChange {
  id: string;
  side: "current" | "incoming";
  kind: SemanticOpKind;
  /** e.g. "Renamed `fetchUser` to `loadUser`" */
  label: string;
  symbol?: string;
  range: Range;
}

export type LineOrigin = "current" | "incoming" | "both" | "edited" | "base";

/** Per-line provenance for the result pane gutter. */
export interface ProvenanceSpan {
  resultRange: Range;
  origin: LineOrigin;
  sourceRange?: Range;
}

export interface DashboardRow {
  path: RepoPath;
  languageId: string | null;
  hunkCount: number;
  topStrategy: StrategyId | null;
  confidence: Confidence | null;
  band: ConfidenceBand | null;
  checks: Partial<Record<CheckKind, CheckStatus>>;
  /** 0..1 heat used for the risk bar. */
  risk: number;
  group: "ready" | "needs-review" | "blocked";
}

export interface DashboardSummary {
  rows: DashboardRow[];
  totals: { files: number; hunks: number; resolved: number; safeToAccept: number };
}

export interface ImpactNode {
  symbol: string;
  path: RepoPath;
  touched: boolean;
  newDiagnostics: number;
}

export interface ImpactGraph {
  nodes: ImpactNode[];
  edges: Array<{ from: string; to: string; kind: "imports" | "calls" }>;
  truncated: boolean;
}

/* ───────────── Actors and agent policy (doc 14) ───────────── */

/** Who performed an action. Agents are attributed for audit. */
export type Actor = { kind: "human" } | { kind: "agent"; name: string } | { kind: "ci" };

export interface AgentPolicy {
  mode: "read-only" | "propose-and-verify" | "apply-safe" | "apply-any";
  minBand: "certain" | "high";
  requireVerification: boolean;
  allowLlm: boolean;
  maxFilesPerRun: number;
  protectedPaths: string[];
}

export type ErrorCode =
  | "POLICY_BLOCKED"
  | "VERIFICATION_FAILED"
  | "NOT_FOUND"
  | "STALE_SESSION"
  | "INVALID_INPUT"
  | "TOO_LARGE"
  | "TOOL_MISSING"
  | "INTERNAL";

export interface StructuredError {
  code: ErrorCode;
  message: string;
  hint?: string;
}

/** Marks text originating from repository content; consumers must treat it as data, never instructions. */
export interface Untrusted<T = string> {
  untrusted: true;
  value: T;
}

export interface VerifyRequest {
  sessionId: string;
  path: RepoPath;
  hunkId: string;
  /** Resolution text authored by any actor (human, agent, LLM). */
  resultText: string;
}

export interface VerifyResult {
  checks: Check[];
  hazardous: boolean;
  /** Overall status: "pass" only if every enabled syntax/symbols/types check passed. */
  overall: CheckStatus;
  confidence: Confidence;
  band: ConfidenceBand;
}

/* ───────────── Session ───────────── */

export interface ConflictSession {
  sessionId: string;
  repoRoot: string;
  files: Array<{
    file: ConflictFile;
    proposals: ResolutionProposal[];
    status: "pending" | "analyzing" | "ready" | "resolved" | "error";
  }>;
  stats: { total: number; autoResolvable: number; resolved: number };
}

/* ───────────── Actions ───────────── */

export type UserAction =
  | { type: "accept"; hunkId: string; candidateId: string; acceptHazardous?: boolean }
  | { type: "edit"; hunkId: string; text: string; acceptHazardous?: boolean }
  | { type: "reject"; hunkId: string }
  | { type: "applyAllSafe"; minBand: ConfidenceBand }
  | { type: "undo"; entryId?: string }
  | { type: "markResolved"; path: RepoPath; gitAdd: boolean };

export interface SessionLogEntry {
  id: string;
  at: ISODateTime;
  actor: Actor;
  path: RepoPath;
  hunkId: string;
  action: "accepted" | "edited" | "auto-applied" | "undone";
  candidateId?: string;
  strategy?: StrategyId;
  backupId: string;
  /** True when the path did not exist before the write. Undo removes the file. */
  absentBefore?: boolean;
}

/** One local audit line. This file never leaves the machine. */
export interface AuditRecord {
  id: string;
  at: ISODateTime;
  actor: Actor;
  tool: string;
  outcome: "ok" | "blocked" | "error";
  message: string;
  path?: RepoPath;
  hunkId?: string;
}

/* ───────────── Configuration ───────────── */

export interface SmartMergeConfig {
  autoApply: { enabled: boolean; minBand: "certain" | "high" };
  checks: { enabled: CheckKind[]; timeoutMs: Partial<Record<CheckKind, number>> };
  llm:
    | { enabled: false }
    | {
        enabled: true;
        provider: "anthropic" | "openai" | "ollama" | (string & {});
        model: string;
        previewPayload: boolean;
        maxContextLines: number;
      };
  context: { providers: string[]; offline: boolean };
  agent: AgentPolicy;
  backups: { retentionDays: number };
  telemetry: { enabled: false } | { enabled: true; fields: string[] };
}

/* ───────────── JSON-RPC methods ───────────── */

export interface InitializeParams {
  clientName: string;
  clientVersion: string;
  protocolRange: string; // semver range
  repoRoot: string;
  workspaceTrusted: boolean;
  capabilities: { supportsWebview: boolean; supportsDiagnostics: boolean };
}

export interface InitializeResult {
  serverVersion: string;
  protocolVersion: typeof PROTOCOL_VERSION;
  supportedLanguages: string[];
  config: SmartMergeConfig;
}

export interface RpcMethods {
  initialize: { params: InitializeParams; result: InitializeResult };
  shutdown: { params: void; result: void };
  "conflicts/list": { params: { repoRoot: string }; result: ConflictSession };
  "resolution/propose": {
    params: { sessionId: string; path: RepoPath };
    result: ResolutionProposal[];
  };
  "resolution/act": {
    params: { sessionId: string; action: UserAction; actor?: Actor };
    result: { log: SessionLogEntry[]; session: ConflictSession };
  };
  "candidate/verify": { params: VerifyRequest; result: VerifyResult };
  "preview/render": {
    params: { sessionId: string; path: RepoPath; candidateIds: Record<string, string> };
    result: {
      content: string;
      diagnostics: Diagnostic[];
      provenance: ProvenanceSpan[];
      impact: ImpactGraph;
    };
  };
  "dashboard/get": { params: { sessionId: string }; result: DashboardSummary };
  "llm/payloadPreview": {
    params: { sessionId: string; hunkId: string };
    result: { redactedPayload: string; redactions: number };
  };
  "config/get": { params: void; result: SmartMergeConfig };
  "config/set": { params: Partial<SmartMergeConfig>; result: SmartMergeConfig };
}

export interface RpcNotifications {
  "session/updated": { session: ConflictSession };
  "check/progress": { hunkId: string; candidateId: string; check: Check };
  "dashboard/updated": { summary: DashboardSummary };
  "daemon/log": { level: "debug" | "info" | "warn" | "error"; message: string };
}

export type RpcMethodName = keyof RpcMethods;

/* ───────────── Extension points ───────────── */

export interface LanguagePlugin {
  languageIds: string[];
  parse(source: string): Promise<SyntaxTree>;
  structuralMerge?(input: {
    base: SyntaxTree;
    current: SyntaxTree;
    incoming: SyntaxTree;
  }): Promise<string | null>;
  analyzeSymbols?(tree: SyntaxTree): Promise<Diagnostic[]>;
  format?(source: string): Promise<string>;
}

export interface SyntaxTree {
  readonly languageId: string;
  readonly hasErrors: boolean;
  readonly source: string;
}

export interface ContextProvider {
  id: string;
  resolveRefs(refs: LinkedRef[], signal: AbortSignal): Promise<LinkedRef[]>;
}

export interface LlmProvider {
  id: string;
  propose(req: {
    base: string;
    current: string;
    incoming: string;
    languageId: string | null;
    commitSubjects: string[];
    signal: AbortSignal;
  }): Promise<Array<{ text: string; rationale: string }>>;
}
