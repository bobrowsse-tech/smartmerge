import type {
  Candidate,
  ConflictFile,
  ConflictHunk,
  ConflictSession,
  ResolutionProposal,
} from "@smartmerge/protocol";
import { describe, expect, it } from "vitest";
import { renderPanelDocument } from "./document.js";
import { panelModel, type PanelInput } from "./model.js";

const baseInput: PanelInput = {
  connected: true,
  loading: false,
  applying: false,
  error: null,
  llmEnabled: false,
  offline: true,
  undoAvailable: false,
  session: null,
  selectedIndex: 0,
};

describe("panel states", () => {
  it("covers every required state in the rendered document", () => {
    const cases: Array<{ name: string; input: PanelInput; text: string }> = [
      { name: "loading", input: { ...baseInput, loading: true }, text: "Looking for conflicts" },
      { name: "empty", input: baseInput, text: "No conflicts" },
      {
        name: "disconnected",
        input: { ...baseInput, connected: false },
        text: "Daemon disconnected",
      },
      { name: "error", input: { ...baseInput, error: "Daemon failed." }, text: "Daemon failed." },
      {
        name: "applying",
        input: { ...baseInput, applying: true },
        text: "Writing the choice after a backup.",
      },
      {
        name: "applied",
        input: { ...baseInput, undoAvailable: true },
        text: "The last choice can be undone.",
      },
      {
        name: "single",
        input: { ...baseInput, session: session([proposal("medium")]) },
        text: "Review, 80 percent",
      },
      {
        name: "many",
        input: {
          ...baseInput,
          session: session([proposal("high"), proposal("low")]),
          selectedIndex: 1,
        },
        text: "Conflict 2 of 2",
      },
      {
        name: "high",
        input: { ...baseInput, session: session([proposal("high")]) },
        text: "High confidence, 94 percent",
      },
      {
        name: "low",
        input: { ...baseInput, session: session([proposal("low")]) },
        text: "Low confidence, 20 percent",
      },
      {
        name: "hazardous",
        input: {
          ...baseInput,
          session: session([proposal("low", { hazardous: true, status: "fail" })]),
        },
        text: "Accept anyway",
      },
      {
        name: "unknown",
        input: { ...baseInput, session: session([proposal("medium", { status: "unknown" })]) },
        text: "Checks have not run.",
      },
      {
        name: "unsupported",
        input: { ...baseInput, session: session([proposal("medium")], null) },
        text: "line comparison only",
      },
      {
        name: "offline",
        input: { ...baseInput, session: session([proposal("medium")]) },
        text: "offline",
      },
      {
        name: "llm-off",
        input: { ...baseInput, session: session([proposal("medium")]) },
        text: "Model assistance is off.",
      },
      {
        name: "llm-on",
        input: { ...baseInput, llmEnabled: true, session: session([proposal("medium")]) },
        text: "Nothing is sent until you preview it.",
      },
    ];
    expect(cases).toHaveLength(16);
    for (const item of cases) {
      const model = panelModel(item.input);
      const html = renderPanelDocument(model);
      expect(html, item.name).toContain(item.text);
      expect(html, item.name).toContain("--sm-text");
      expect(html, item.name).toContain("@media (max-width: 40rem)");
      expect(html, item.name).not.toMatch(/\bours\b|\btheirs\b/);
    }
  });
});

function session(
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

function proposal(
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
