import type {
  Candidate,
  ConfidenceBand,
  ConflictSession,
  ResolutionProposal,
  StrategyId,
} from "@smartmerge/protocol";

/** What the merge panel is showing. Adapters render this and do not decide a resolution. */
export type PanelModel =
  | { kind: "loading"; title: string }
  | { kind: "disconnected"; title: string; message: string }
  | { kind: "error"; title: string; message: string }
  | { kind: "applying"; title: string; message: string }
  | { kind: "empty"; title: string; message: string }
  | { kind: "applied"; title: string; message: string }
  | { kind: "conflict"; view: ConflictView };

export interface ConflictView {
  title: string;
  headline: string;
  summary: string;
  currentLabel: string;
  incomingLabel: string;
  currentText: string;
  baseText: string;
  incomingText: string;
  currentSubject: string;
  incomingSubject: string;
  result: string;
  notes: string[];
  hazardous: boolean;
  acceptLabel: string;
  /** Repository-relative path of the file this hunk belongs to. */
  path: string;
  hunkId: string;
  /** Recommended candidate, when one exists. Absent when the user must pick a side. */
  acceptCandidateId: string | null;
  alternatives: Array<{ id: string; label: string }>;
}

export interface PanelInput {
  connected: boolean;
  loading: boolean;
  applying: boolean;
  error: string | null;
  llmEnabled: boolean;
  offline: boolean;
  undoAvailable: boolean;
  session: ConflictSession | null;
  /** Zero-based hunk index across every conflicted file. */
  selectedIndex: number;
}

/**
 * Turn a conflict session into the panel state.
 * This chooses what to show. It does not choose how to merge.
 */
export function panelModel(input: PanelInput): PanelModel {
  if (!input.connected) {
    return {
      kind: "disconnected",
      title: "Daemon disconnected",
      message: "The local daemon is not running.",
    };
  }
  if (input.loading) return { kind: "loading", title: "Looking for conflicts" };
  if (input.error) return { kind: "error", title: "Something went wrong", message: input.error };
  if (input.applying) {
    return { kind: "applying", title: "Applying", message: "Writing the choice after a backup." };
  }
  const rows = flatten(input.session);
  if (rows.length === 0) {
    if (input.undoAvailable) {
      return { kind: "applied", title: "Applied", message: "The last choice can be undone." };
    }
    return {
      kind: "empty",
      title: "No conflicts",
      message: "This repository has no conflicted files.",
    };
  }
  const index = clamp(input.selectedIndex, 0, rows.length - 1);
  const row = rows[index];
  if (!row)
    return {
      kind: "empty",
      title: "No conflicts",
      message: "This repository has no conflicted files.",
    };
  return { kind: "conflict", view: conflictView(row, index, rows.length, input) };
}

function flatten(session: ConflictSession | null): FlatHunk[] {
  if (!session) return [];
  const rows: FlatHunk[] = [];
  for (const entry of session.files) {
    for (const hunk of entry.file.hunks) {
      rows.push({
        path: entry.file.path,
        languageId: entry.file.languageId,
        currentLabel: entry.file.operation.current.label,
        incomingLabel: entry.file.operation.incoming.label,
        hunk,
        proposal: entry.proposals.find((item) => item.hunkId === hunk.id),
      });
    }
  }
  return rows;
}

interface FlatHunk {
  path: string;
  languageId: string | null;
  currentLabel: string;
  incomingLabel: string;
  hunk: ConflictSession["files"][number]["file"]["hunks"][number];
  proposal: ResolutionProposal | undefined;
}

function conflictView(
  row: FlatHunk,
  index: number,
  total: number,
  input: PanelInput,
): ConflictView {
  const chosen = recommended(row.proposal);
  const notes: string[] = [];
  if (row.languageId === null) notes.push("This language uses line comparison only.");
  if (input.offline) notes.push("Context providers are offline.");
  notes.push(
    input.llmEnabled
      ? "Model assistance is on. Nothing is sent until you preview it."
      : "Model assistance is off.",
  );
  if (chosen?.hazardous)
    notes.push("A check failed. Accept anyway only if you mean to keep this text.");
  const subject = (side: "current" | "incoming"): string =>
    row.hunk.temporal[side].commits.at(-1)?.subject ?? "No commit subject attached.";
  return {
    title: `Conflict ${String(index + 1)} of ${String(total)} · ${row.path}`,
    headline: row.proposal?.explanation.headline ?? "No recommendation yet",
    summary: summary(chosen, row.proposal),
    currentLabel: row.currentLabel,
    incomingLabel: row.incomingLabel,
    currentText: row.hunk.current,
    baseText: row.hunk.base,
    incomingText: row.hunk.incoming,
    currentSubject: subject("current"),
    incomingSubject: subject("incoming"),
    result: chosen?.result ?? "No result yet.",
    notes,
    hazardous: chosen?.hazardous ?? false,
    acceptLabel: chosen?.hazardous ? "Accept anyway" : "Accept",
    path: row.path,
    hunkId: row.hunk.id,
    acceptCandidateId: chosen?.id ?? null,
    alternatives: (row.proposal?.candidates ?? [])
      .filter((candidate) => candidate.id !== row.proposal?.recommended)
      .map((candidate) => ({ id: candidate.id, label: strategyLabel(candidate.strategy) })),
  };
}

function recommended(proposal: ResolutionProposal | undefined): Candidate | null {
  if (!proposal?.recommended) return null;
  return proposal.candidates.find((candidate) => candidate.id === proposal.recommended) ?? null;
}

function summary(chosen: Candidate | null, proposal: ResolutionProposal | undefined): string {
  if (!chosen || !proposal) return "Checks have not run.";
  const percent = Math.round(chosen.confidence * 100);
  return `${bandWord(chosen.band)}, ${String(percent)} percent. ${checkSentence(chosen)} ${proposal.explanation.verificationSummary}`;
}

function checkSentence(chosen: Candidate): string {
  const syntax = chosen.checks.find((check) => check.kind === "syntax");
  const symbols = chosen.checks.find((check) => check.kind === "symbols");
  if (!syntax || syntax.status === "unknown" || !symbols || symbols.status === "unknown") {
    return "Checks have not run.";
  }
  if (syntax.status === "fail" || symbols.status === "fail") return "A check failed.";
  return "Syntax passed. Symbols passed.";
}

function bandWord(band: ConfidenceBand): string {
  switch (band) {
    case "certain":
      return "Certain";
    case "high":
      return "High confidence";
    case "medium":
      return "Review";
    case "low":
      return "Low confidence";
  }
}

function strategyLabel(strategy: StrategyId): string {
  switch (strategy) {
    case "manual-current":
      return "Keep current";
    case "manual-incoming":
      return "Keep incoming";
    case "manual-both-current-first":
      return "Keep current, then incoming";
    case "manual-both-incoming-first":
      return "Keep incoming, then current";
    case "structural-3way":
      return "Merge both";
    case "list-union":
      return "Keep both import names";
    case "rename-aware":
      return "Apply the rename";
    default:
      return strategy;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
