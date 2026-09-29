import { describe, expect, it } from "vitest";
import type {
  Candidate,
  ConflictFile,
  ConflictHunk,
  ConflictSession,
  ResolutionProposal,
} from "@smartmerge/protocol";
import { summarizeDashboard } from "./dashboard.js";

describe("summarizeDashboard", () => {
  it("marks a certain recommendation ready and a failed check blocked", () => {
    const summary = summarizeDashboard(
      session([
        file("src/ready.ts", [proposal("certain", { hazardous: false, status: "pass" })]),
        file("src/blocked.ts", [proposal("certain", { hazardous: false, status: "fail" })]),
        file("src/review.ts", [proposal("medium", { hazardous: false, status: "pass" })]),
        file("src/open.ts", []),
      ]),
    );
    expect(summary.totals).toEqual({ files: 4, hunks: 4, resolved: 0, safeToAccept: 1 });
    expect(summary.rows.map((row) => [row.path, row.group])).toEqual([
      ["src/blocked.ts", "blocked"],
      ["src/open.ts", "needs-review"],
      ["src/review.ts", "needs-review"],
      ["src/ready.ts", "ready"],
    ]);
    expect(summary.rows[0]?.checks.syntax).toBe("fail");
    expect(summary.rows[3]?.risk).toBe(0);
  });

  it("does not count an already resolved file as safe to accept", () => {
    const summary = summarizeDashboard(
      session(
        [
          file(
            "src/done.ts",
            [proposal("certain", { hazardous: false, status: "pass" })],
            "resolved",
          ),
        ],
        {
          resolved: 1,
        },
      ),
    );
    expect(summary.totals.safeToAccept).toBe(0);
    expect(summary.rows[0]?.group).toBe("ready");
  });
});

function session(files: ConflictSession["files"], stats?: { resolved: number }): ConflictSession {
  return {
    sessionId: "session",
    repoRoot: "/repo",
    files,
    stats: { total: files.length, autoResolvable: 0, resolved: stats?.resolved ?? 0 },
  };
}

function file(
  path: string,
  proposals: ResolutionProposal[],
  status: ConflictSession["files"][number]["status"] = "ready",
): ConflictSession["files"][number] {
  const conflict: ConflictFile = {
    path,
    kind: "content",
    languageId: "typescript",
    hunks: proposals.length === 0 ? [hunk("pending")] : proposals.map((item) => hunk(item.hunkId)),
    operation: {
      operation: "merge",
      current: { label: "main", role: "ours", commitSha: "a" },
      incoming: { label: "topic", role: "theirs", commitSha: "b" },
      mergeBaseSha: "c",
    },
  };
  return { file: conflict, proposals, status };
}

function hunk(id: string): ConflictHunk {
  const side = { side: "current" as const, commits: [], changeClasses: [], ageMs: null };
  return {
    id,
    range: { startLine: 1, endLine: 1 },
    base: "base",
    current: "current",
    incoming: "incoming",
    temporal: {
      current: side,
      incoming: { ...side, side: "incoming" },
      base: { ...side, side: "base" },
      incomingNewerByMs: null,
    },
    semanticChanges: [],
  };
}

function proposal(
  band: Candidate["band"],
  options: { hazardous: boolean; status: "pass" | "fail" },
): ResolutionProposal {
  const candidate: Candidate = {
    id: `candidate-${band}-${options.status}`,
    hunkId: `hunk-${band}-${options.status}`,
    strategy: "identical",
    result: "value",
    checks: [
      { kind: "syntax", status: options.status, diagnostics: [], durationMs: 1 },
      { kind: "symbols", status: options.status, diagnostics: [], durationMs: 1 },
    ],
    hazardous: options.hazardous,
    confidence: band === "certain" ? 0.99 : 0.8,
    band,
    evidence: [{ code: "sides-equal", text: "Same change." }],
  };
  return {
    hunkId: candidate.hunkId,
    recommended: candidate.id,
    candidates: [candidate],
    explanation: {
      headline: "Same change.",
      bullets: [],
      verificationSummary: "Checks finished.",
      temporalSummary: "",
    },
    autoApplyEligible: band === "certain" && !options.hazardous,
  };
}
