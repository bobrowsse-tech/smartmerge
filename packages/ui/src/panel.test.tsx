import { describe, expect, it } from "vitest";
import { renderPanelDocument } from "./document.js";
import { sampleProposal, sampleSession } from "./fixtures.js";
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
        input: { ...baseInput, session: sampleSession([sampleProposal("medium")]) },
        text: "Review, 80 percent",
      },
      {
        name: "many",
        input: {
          ...baseInput,
          session: sampleSession([sampleProposal("high"), sampleProposal("low")]),
          selectedIndex: 1,
        },
        text: "Conflict 2 of 2",
      },
      {
        name: "high",
        input: { ...baseInput, session: sampleSession([sampleProposal("high")]) },
        text: "High confidence, 94 percent",
      },
      {
        name: "low",
        input: { ...baseInput, session: sampleSession([sampleProposal("low")]) },
        text: "Low confidence, 20 percent",
      },
      {
        name: "hazardous",
        input: {
          ...baseInput,
          session: sampleSession([sampleProposal("low", { hazardous: true, status: "fail" })]),
        },
        text: "Accept anyway",
      },
      {
        name: "unknown",
        input: {
          ...baseInput,
          session: sampleSession([sampleProposal("medium", { status: "unknown" })]),
        },
        text: "Checks have not run.",
      },
      {
        name: "unsupported",
        input: { ...baseInput, session: sampleSession([sampleProposal("medium")], null) },
        text: "line comparison only",
      },
      {
        name: "offline",
        input: { ...baseInput, session: sampleSession([sampleProposal("medium")]) },
        text: "offline",
      },
      {
        name: "llm-off",
        input: { ...baseInput, session: sampleSession([sampleProposal("medium")]) },
        text: "Model assistance is off.",
      },
      {
        name: "llm-on",
        input: {
          ...baseInput,
          llmEnabled: true,
          session: sampleSession([sampleProposal("medium")]),
        },
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
      expect(html, item.name).toContain("min-height: 2.9em");
      expect(html, item.name).not.toMatch(/\bours\b|\btheirs\b/);
    }
  });
});
