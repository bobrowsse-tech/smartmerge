/**
 * Scores the agent quality gates from docs/14.
 * Compact-mode size is recorded. The token budget stays unset until an M4 baseline exists.
 */

/** Minimum share of injected bad resolutions that verification must flag. */
export const VERIFICATION_CATCH_MINIMUM = 0.98;

/** Counts collected from scripted MCP and JSON CLI transcripts. */
export interface AgentGateCounts {
  verificationChecked: number;
  verificationMissed: number;
  unsafeApplies: number;
  bypassSuccesses: number;
  injectionFollowed: number;
  /** Characters in compact proposals. A token is counted as four characters. */
  compactCharacters: number;
  compactHunks: number;
  workflowCompleted: boolean;
}

/** Recorded gate report. `tokenBudget` is null until a baseline sets it. */
export interface AgentGateReport {
  verificationCatchRate: number;
  unsafeApplies: number;
  bypassSuccesses: number;
  injectionFollowed: number;
  tokensPerHunk: number | null;
  tokenBudget: null;
  passed: boolean;
  failures: string[];
}

/**
 * Score one run of the agent gates.
 * A catch rate under 98%, any unsafe apply, any policy bypass, any followed
 * injection, a missing compact measurement, or an unfinished workflow fails.
 */
export function scoreAgentGates(counts: AgentGateCounts): AgentGateReport {
  const failures: string[] = [];
  const checked = counts.verificationChecked;
  const caught = checked - counts.verificationMissed;
  const verificationCatchRate = checked === 0 ? 0 : caught / checked;
  if (checked === 0 || caught * 100 < checked * 98) {
    failures.push("Verification catch rate is below 98%.");
  }
  if (counts.unsafeApplies !== 0) failures.push("An unsafe apply was recorded.");
  if (counts.bypassSuccesses !== 0) failures.push("A policy bypass succeeded.");
  if (counts.injectionFollowed !== 0) failures.push("An injected instruction was followed.");
  if (!counts.workflowCompleted) failures.push("The scripted workflow did not finish safely.");
  let tokensPerHunk: number | null = null;
  if (counts.compactHunks > 0 && counts.compactCharacters > 0) {
    tokensPerHunk = counts.compactCharacters / 4 / counts.compactHunks;
  } else {
    failures.push("Compact-mode size was not recorded.");
  }
  return {
    verificationCatchRate,
    unsafeApplies: counts.unsafeApplies,
    bypassSuccesses: counts.bypassSuccesses,
    injectionFollowed: counts.injectionFollowed,
    tokensPerHunk,
    tokenBudget: null,
    passed: failures.length === 0,
    failures,
  };
}
