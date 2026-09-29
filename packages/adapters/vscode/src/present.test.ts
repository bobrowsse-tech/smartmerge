import type { ResolutionProposal } from "@smartmerge/protocol";
import { describe, expect, it } from "vitest";
import {
  acceptChoice,
  acceptRecommended,
  codeLensTitle,
  problemEntries,
  statusBarText,
} from "./present.js";

const proposal: ResolutionProposal = {
  hunkId: "hunk:1",
  recommended: "hunk:1:one-side-unchanged",
  candidates: [
    {
      id: "hunk:1:one-side-unchanged",
      hunkId: "hunk:1",
      strategy: "one-side-unchanged",
      result: "incoming",
      checks: [
        { kind: "syntax", status: "unknown", diagnostics: [], durationMs: 0, reason: "not-run" },
        { kind: "symbols", status: "unknown", diagnostics: [], durationMs: 0, reason: "not-run" },
      ],
      hazardous: false,
      confidence: 0.8,
      band: "medium",
      evidence: [{ code: "current-unchanged", text: "Only topic changed." }],
    },
  ],
  explanation: {
    headline: "Only one side changed",
    bullets: ["Only topic changed."],
    verificationSummary: "Checks have not run.",
    temporalSummary: "Commit history is not attached yet.",
  },
  autoApplyEligible: false,
};

describe("editor presentation", () => {
  it("counts conflicts without calling them ours or theirs", () => {
    expect(statusBarText(2, 1, true)).toBe("SmartMergeResolver: 2 conflicts, 1 auto-resolvable");
    expect(statusBarText(0, 0, true)).toBe("SmartMergeResolver: no conflicts");
    expect(statusBarText(1, 0, false)).toBe("SmartMergeResolver: daemon disconnected");
  });

  it("shows the recommendation and refuses a hazardous accept", () => {
    expect(codeLensTitle(proposal)).toBe("Only one side changed (80%)");
    expect(acceptRecommended(proposal)).toEqual({
      type: "accept",
      hunkId: "hunk:1",
      candidateId: "hunk:1:one-side-unchanged",
    });
    const current = proposal.candidates[0];
    if (!current) throw new Error("expected a candidate");
    const hazardous: ResolutionProposal = {
      ...proposal,
      candidates: [{ ...current, hazardous: true }],
    };
    expect(acceptRecommended(hazardous)).toBeNull();
    expect(acceptRecommended(undefined)).toBeNull();
    expect(acceptChoice([hazardous], { candidateId: current.id })).toEqual({
      type: "accept",
      hunkId: "hunk:1",
      candidateId: current.id,
      acceptHazardous: true,
    });
    expect(acceptChoice([proposal], { hunkId: "missing" })).toBeNull();
  });

  it("sends only new failed diagnostics to the problems list", () => {
    const current = proposal.candidates[0];
    if (!current) throw new Error("expected a candidate");
    const broken: ResolutionProposal = {
      ...proposal,
      candidates: [
        {
          ...current,
          checks: [
            {
              kind: "syntax",
              status: "fail",
              durationMs: 1,
              diagnostics: [
                {
                  severity: "error",
                  message: "Missing closing brace.",
                  path: "src/session.ts",
                  range: { startLine: 4, endLine: 4 },
                  source: "smartmerge",
                  preExisting: false,
                  code: "syntax",
                },
                {
                  severity: "warning",
                  message: "Already on one side.",
                  path: "src/session.ts",
                  range: { startLine: 1, endLine: 1 },
                  source: "smartmerge",
                  preExisting: true,
                },
              ],
            },
          ],
        },
      ],
    };
    expect(problemEntries([broken])).toEqual([
      {
        path: "src/session.ts",
        message: "Missing closing brace.",
        severity: "error",
        startLine: 4,
        endLine: 4,
        code: "syntax",
      },
    ]);
    expect(problemEntries([proposal])).toEqual([]);
  });
});
