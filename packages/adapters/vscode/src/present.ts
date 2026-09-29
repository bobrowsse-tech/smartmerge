import type { ResolutionProposal, UserAction } from "@smartmerge/protocol";

/** Status bar text. Branch names stay in the panel; this line is a count. */
export function statusBarText(total: number, autoResolvable: number, connected: boolean): string {
  if (!connected) return "SmartMergeResolver: daemon disconnected";
  if (total === 0) return "SmartMergeResolver: no conflicts";
  return `SmartMergeResolver: ${String(total)} conflicts, ${String(autoResolvable)} auto-resolvable`;
}

/** CodeLens title taken from the proposal. It does not invent a resolution. */
export function codeLensTitle(proposal: ResolutionProposal | undefined): string {
  if (!proposal?.recommended) return "No recommendation yet";
  const chosen = proposal.candidates.find((candidate) => candidate.id === proposal.recommended);
  if (!chosen) return "No recommendation yet";
  const percent = Math.round(chosen.confidence * 100);
  return `${proposal.explanation.headline} (${String(percent)}%)`;
}

/**
 * Accept the recommended candidate.
 * A hazardous recommendation is not accepted by this action.
 */
export function acceptRecommended(proposal: ResolutionProposal | undefined): UserAction | null {
  if (!proposal?.recommended) return null;
  const chosen = proposal.candidates.find((candidate) => candidate.id === proposal.recommended);
  if (!chosen || chosen.hazardous) return null;
  return { type: "accept", hunkId: proposal.hunkId, candidateId: chosen.id };
}

export interface ExplicitChoice {
  hunkId?: string;
  candidateId?: string;
}

/**
 * Turn a panel or code-lens click into an accept action.
 * A named candidate is an explicit choice, including a hazardous one.
 * A click without a candidate id only accepts a non-hazardous recommendation.
 */
export function acceptChoice(
  proposals: readonly ResolutionProposal[],
  choice?: ExplicitChoice,
): UserAction | null {
  if (choice?.candidateId) {
    const proposal = proposals.find(
      (item) =>
        item.candidates.some((candidate) => candidate.id === choice.candidateId) &&
        (choice.hunkId === undefined || item.hunkId === choice.hunkId),
    );
    const candidate = proposal?.candidates.find((item) => item.id === choice.candidateId);
    if (!proposal || !candidate) return null;
    return {
      type: "accept",
      hunkId: proposal.hunkId,
      candidateId: candidate.id,
      ...(candidate.hazardous ? { acceptHazardous: true } : {}),
    };
  }
  const proposal =
    choice?.hunkId === undefined
      ? proposals[0]
      : proposals.find((item) => item.hunkId === choice.hunkId);
  return acceptRecommended(proposal);
}
