import { describe, expect, it } from "vitest";
import { panelCss } from "./tokens.js";

/** WCAG relative luminance for a #rrggbb color. */
function luminance(hex: string): number {
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset + 1, offset + 3), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const red = channels[0];
  const green = channels[1];
  const blue = channels[2];
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`invalid color ${hex}`);
  }
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("panel contrast", () => {
  it("keeps text pairs at WCAG AA and reserves check space", () => {
    const pairs: Array<[string, string]> = [
      ["#18181b", "#ffffff"],
      ["#3f3f46", "#ffffff"],
      ["#ffffff", "#0f766e"],
      ["#fafafa", "#18181b"],
      ["#d4d4d8", "#18181b"],
      ["#18181b", "#5eead4"],
    ];
    for (const [foreground, background] of pairs) {
      expect(panelCss).toContain(foreground);
      expect(panelCss).toContain(background);
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(panelCss).toContain("min-height: 8em");
    expect(panelCss).toContain("min-height: 4.35em");
    expect(panelCss).toContain("prefers-reduced-motion");
  });
});
