import { describe, expect, it } from "vitest";
import type { DashboardSummary } from "@smartmerge/protocol";
import { renderDashboardDocument } from "./document.js";

describe("browser document", () => {
  it("adds theme links and file links only for the local browser", () => {
    const browser = renderDashboardDocument(summary(), {
      browser: true,
      linkFiles: true,
      theme: "dark",
      pagePath: "/",
    });
    expect(browser).toContain('data-theme="dark"');
    expect(browser).toContain('data-file-links="true"');
    expect(browser).toContain('href="/?theme=light"');
    expect(browser).toContain('href="/?theme=dark"');
    expect(browser).toContain('href="/?theme=contrast"');
    expect(browser).toContain('href="/panel?path=src%2Fapp.ts&amp;theme=dark"');
    expect(browser).toContain("structural-3way");

    const editor = renderDashboardDocument(summary());
    expect(editor).not.toContain("data-file-links");
    expect(editor).not.toContain("High contrast");
    expect(editor).toContain("<span");
  });
});

function summary(): DashboardSummary {
  return {
    rows: [
      {
        path: "src/app.ts",
        languageId: "typescript",
        hunkCount: 1,
        topStrategy: "structural-3way",
        confidence: 0.99,
        band: "certain",
        checks: { syntax: "pass", symbols: "pass" },
        risk: 0,
        group: "ready",
      },
    ],
    totals: { files: 1, hunks: 1, resolved: 0, safeToAccept: 1 },
  };
}
