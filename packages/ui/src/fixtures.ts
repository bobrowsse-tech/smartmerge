import type {
  Candidate,
  ConflictFile,
  ConflictHunk,
  ConflictSession,
  ResolutionProposal,
} from "@smartmerge/protocol";

/** A sample proposal for panel stories and tests. It does not merge anything. */
export function sampleProposal(
  band: "high" | "medium" | "low",
  options?: { hazardous?: boolean; status?: "pass" | "fail" | "unknown" },
): ResolutionProposal {
  const status = options?.status ?? "pass";
  const confidence = band === "high" ? 0.94 : band === "medium" ? 0.8 : 0.2;
  const candidate: Candidate = {
    id: `hunk:${band}`,
    hunkId: `hunk:${band}`,
    strategy: "structural-3way",
    result: "merged",
    checks: [
      { kind: "syntax", status, diagnostics: [], durationMs: 0 },
      { kind: "symbols", status, diagnostics: [], durationMs: 0 },
    ],
    hazardous: options?.hazardous ?? false,
    confidence,
    band,
    evidence: [{ code: "disjoint-nodes", text: "Different declarations." }],
  };
  return {
    hunkId: candidate.hunkId,
    recommended: candidate.id,
    candidates: [
      candidate,
      {
        ...candidate,
        id: `${candidate.id}:manual-current`,
        strategy: "manual-current",
        result: "current",
        confidence: 0,
        band: "low",
      },
    ],
    explanation: {
      headline: "Merge both — different declarations edited",
      bullets: ["Different declarations."],
      verificationSummary: "Shown for the test.",
      temporalSummary: "Commit history is not attached yet.",
    },
    autoApplyEligible: false,
  };
}

/** A one-file session built from sample proposals. */
export function sampleSession(
  proposals: ResolutionProposal[],
  languageId: string | null = "typescript",
): ConflictSession {
  const file: ConflictFile = {
    path: "src/session.ts",
    kind: "content",
    languageId,
    operation: {
      operation: "merge",
      current: { label: "main", role: "ours", commitSha: "a" },
      incoming: { label: "topic", role: "theirs", commitSha: "b" },
      mergeBaseSha: "c",
    },
    hunks: proposals.map((item, index) => hunk(item.hunkId, index)),
  };
  return {
    sessionId: "s",
    repoRoot: "/repo",
    files: [{ file, proposals, status: "ready" }],
    stats: { total: proposals.length, autoResolvable: 0, resolved: 0 },
  };
}

function hunk(id: string, index: number): ConflictHunk {
  return {
    id,
    range: { startLine: index + 1, endLine: index + 3 },
    base: "base",
    current: "current",
    incoming: "incoming",
    temporal: {
      current: { side: "current", commits: [], changeClasses: [], ageMs: null },
      incoming: { side: "incoming", commits: [], changeClasses: [], ageMs: null },
      base: { side: "base", commits: [], changeClasses: [], ageMs: null },
      incomingNewerByMs: null,
    },
    semanticChanges: [],
  };
}
