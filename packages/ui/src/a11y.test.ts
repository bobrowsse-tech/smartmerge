import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderPanelDocument } from "./document.js";
import { sampleProposal, sampleSession } from "./fixtures.js";
import { panelModel, type PanelInput } from "./model.js";

const base: PanelInput = {
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

const conflictHtml = renderPanelDocument(
  panelModel({
    ...base,
    session: sampleSession([sampleProposal("high")]),
  }),
);

describe("panel accessibility and layout", () => {
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

  it("renders a conflict panel in under 200 ms", () => {
    const started = performance.now();
    const html = renderPanelDocument(
      panelModel({ ...base, session: sampleSession([sampleProposal("high")]) }),
    );
    expect(performance.now() - started).toBeLessThan(200);
    expect(html.length).toBeGreaterThan(0);
  });

  it("has no serious accessibility violations", async () => {
    const pages = [
      conflictHtml,
      renderPanelDocument(panelModel(base)),
      renderPanelDocument(panelModel({ ...base, connected: false })),
      renderPanelDocument(panelModel({ ...base, error: "Daemon failed." })),
    ];
    for (const html of pages) {
      const page = await open(context, html, 720);
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter(
        (item) => item.impact === "serious" || item.impact === "critical",
      );
      expect(serious.map((item) => item.id)).toEqual([]);
      await page.close();
    }
  }, 30_000);

  it("keeps controls inside 320, 720, and 1200 px widths and at 200% zoom", async () => {
    for (const width of [320, 720, 1200]) {
      const page = await open(context, conflictHtml, width);
      expect(await clipped(page)).toBe(false);
      await page.close();
    }
    const zoomed = await open(context, conflictHtml, 720);
    await zoomed.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    expect(await clipped(zoomed)).toBe(false);
    await zoomed.close();
  });

  it("does not shift when a check summary arrives", async () => {
    const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
    await page.addInitScript(() => {
      const target = globalThis as { __shifts?: number };
      target.__shifts = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
          if (shift.hadRecentInput !== true && typeof shift.value === "number") {
            target.__shifts = (target.__shifts ?? 0) + shift.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.setContent(conflictHtml, { waitUntil: "load" });
    await page.evaluate(() => {
      const summary = document.querySelector(".sm-summary");
      if (summary) {
        summary.textContent =
          "High confidence, 94 percent. Syntax passed. Symbols passed. Shown for the test.";
      }
    });
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            resolve(undefined);
          });
        }),
    );
    const shift = await page.evaluate(() => (globalThis as { __shifts?: number }).__shifts ?? 0);
    expect(shift).toBe(0);
    await page.close();
  });
});

async function open(context: BrowserContext, html: string, width: number): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(html, { waitUntil: "load" });
  return page;
}

async function clipped(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const view = document.documentElement.clientWidth;
    return [...document.querySelectorAll("button")].some((button) => {
      const box = button.getBoundingClientRect();
      return box.height === 0 || box.left < -1 || box.right > view + 1;
    });
  });
}
