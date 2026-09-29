import { chromium, type Browser, type BrowserContext } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DashboardSummary } from "@smartmerge/protocol";
import { renderDashboardDocument } from "./document.js";

describe("merge dashboard", () => {
  let browser: Browser;
  let context: BrowserContext;

  beforeAll(async () => {
    browser = await chromium.launch();
    context = await browser.newContext();
  });

  afterAll(async () => {
    await context.close();
    await browser.close();
  });

  it("windows 500 rows and keeps a scroll frame under 16 ms", async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 720, height: 900 });
    await page.setContent(renderDashboardDocument(manyRows(500)), { waitUntil: "load" });
    const sample = await page.evaluate(() => {
      const scroller = document.querySelector("[data-dashboard-scroll]");
      if (!(scroller instanceof HTMLElement)) throw new Error("dashboard scroller is missing");
      const before = document.querySelector(".sm-path")?.textContent ?? "";
      const samples: number[] = [];
      for (let step = 0; step < 40; step += 1) {
        scroller.scrollTop = step * 64;
        const started = performance.now();
        scroller.dispatchEvent(new Event("scroll"));
        samples.push(performance.now() - started);
      }
      samples.sort((left, right) => left - right);
      const mounted = document.querySelectorAll("[data-dashboard-row]").length;
      const after = document.querySelector(".sm-path")?.textContent ?? "";
      return { mounted, after, before, p95: samples[Math.floor(samples.length * 0.95)] ?? 999 };
    });
    expect(sample.mounted).toBeGreaterThan(0);
    expect(sample.mounted).toBeLessThan(24);
    expect(sample.after).not.toBe(sample.before);
    expect(sample.p95).toBeLessThan(16);
    await page.close();
  }, 30_000);
});

function manyRows(count: number): DashboardSummary {
  const rows = Array.from({ length: count }, (_, index) => ({
    path: `file-${String(index).padStart(3, "0")}.txt`,
    languageId: "plaintext",
    hunkCount: 1,
    topStrategy: "identical" as const,
    confidence: 0.99,
    band: "certain" as const,
    checks: { syntax: "pass" as const, symbols: "pass" as const },
    risk: 0,
    group: "ready" as const,
  }));
  return {
    rows,
    totals: { files: count, hunks: count, resolved: 0, safeToAccept: count },
  };
}
