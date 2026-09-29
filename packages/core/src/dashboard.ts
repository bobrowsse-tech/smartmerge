import type {
  Candidate,
  Check,
  CheckKind,
  CheckStatus,
  ConfidenceBand,
  ConflictSession,
  DashboardRow,
  DashboardSummary,
  ResolutionProposal,
} from "@smartmerge/protocol";

const GROUP_ORDER = { blocked: 0, "needs-review": 1, ready: 2 } as const;
const BAND_RANK: Record<ConfidenceBand, number> = { certain: 0, high: 1, medium: 2, low: 3 };
const STATUS_RANK: Record<CheckStatus, number> = { pass: 0, unknown: 1, fail: 2 };

/**
 * Group conflicted files for the merge dashboard.
 * A file is ready only when every hunk has a certain, non-hazardous recommendation.
 * This does not apply anything.
 */
export function summarizeDashboard(session: ConflictSession): DashboardSummary {
  let safeToAccept = 0;
  const rows = session.files.map((entry) => {
    const row = fileRow(entry);
    if (row.group === "ready" && entry.status !== "resolved") safeToAccept += 1;
    return row;
  });
  rows.sort(
    (left, right) =>
      GROUP_ORDER[left.group] - GROUP_ORDER[right.group] || left.path.localeCompare(right.path),
  );
  const hunks = session.files.reduce((total, entry) => total + entry.file.hunks.length, 0);
  return {
    rows,
    totals: { files: session.files.length, hunks, resolved: session.stats.resolved, safeToAccept },
  };
}

function fileRow(entry: ConflictSession["files"][number]): DashboardRow {
  const chosen = entry.proposals.flatMap((proposal) => {
    const candidate = recommended(proposal);
    return candidate === null ? [] : [candidate];
  });
  const checks = worstChecks(chosen.flatMap((candidate) => candidate.checks));
  const first = chosen[0];
  const shared = {
    path: entry.file.path,
    languageId: entry.file.languageId,
    hunkCount: entry.file.hunks.length,
    topStrategy: first?.strategy ?? null,
    confidence: lowestConfidence(chosen),
    band: worstBand(chosen),
    checks,
  };
  if (entry.status === "resolved") return { ...shared, risk: 0, group: "ready" };
  const blocked = chosen.some(
    (candidate) => candidate.hazardous || candidate.checks.some((check) => check.status === "fail"),
  );
  if (blocked) return { ...shared, risk: 1, group: "blocked" };
  const ready =
    entry.file.hunks.length > 0 &&
    chosen.length === entry.file.hunks.length &&
    chosen.every((candidate) => candidate.band === "certain" && !candidate.hazardous);
  if (ready) return { ...shared, risk: 0, group: "ready" };
  const confidence = shared.confidence;
  return { ...shared, risk: confidence === null ? 0.5 : 1 - confidence, group: "needs-review" };
}

function recommended(proposal: ResolutionProposal): Candidate | null {
  if (proposal.recommended === null) return null;
  return proposal.candidates.find((candidate) => candidate.id === proposal.recommended) ?? null;
}

function lowestConfidence(candidates: readonly Candidate[]): number | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((lowest, candidate) => Math.min(lowest, candidate.confidence), 1);
}

function worstBand(candidates: readonly Candidate[]): ConfidenceBand | null {
  let band: ConfidenceBand | null = null;
  for (const candidate of candidates) {
    if (band === null || BAND_RANK[candidate.band] > BAND_RANK[band]) band = candidate.band;
  }
  return band;
}

function worstChecks(checks: readonly Check[]): Partial<Record<CheckKind, CheckStatus>> {
  const result: Partial<Record<CheckKind, CheckStatus>> = {};
  for (const check of checks) {
    const current = result[check.kind];
    if (current === undefined || STATUS_RANK[check.status] > STATUS_RANK[current]) {
      result[check.kind] = check.status;
    }
  }
  return result;
}
