import type { DashboardRow } from "@smartmerge/protocol";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { TerminalApp } from "./terminal.js";

describe("terminal dashboard", () => {
  it("shows the path, the group, and the full strategy name", () => {
    const view = render(
      <TerminalApp
        initial={[
          row("src/app.ts", "structural-3way", "ready", "certain"),
          row("src/review.ts", "whitespace-format", "needs-review", "medium"),
        ]}
        onAccept={() => Promise.resolve({ rows: [], message: "" })}
        onQuit={() => undefined}
      />,
    );
    const frame = view.lastFrame() ?? "";
    expect(frame).toContain("src/app.ts");
    expect(frame).toContain("structural-3way");
    expect(frame).toContain("ready to accept");
    expect(frame).toContain("whitespace-format");
    view.unmount();
  });

  it("quits without accepting when q is pressed", () => {
    let remaining = -1;
    let accepted = "";
    const view = render(
      <TerminalApp
        initial={[row("src/review.ts", "whitespace-format", "needs-review", "medium")]}
        onAccept={(path) => {
          accepted = path;
          return Promise.resolve({ rows: [], message: "" });
        }}
        onQuit={(count) => {
          remaining = count;
        }}
      />,
    );
    view.stdin.write("q");
    expect(remaining).toBe(1);
    expect(accepted).toBe("");
    view.unmount();
  });
});

function row(
  path: string,
  strategy: DashboardRow["topStrategy"],
  group: DashboardRow["group"],
  band: NonNullable<DashboardRow["band"]>,
): DashboardRow {
  return {
    path,
    languageId: "typescript",
    hunkCount: 1,
    topStrategy: strategy,
    confidence: group === "ready" ? 0.99 : 0.8,
    band,
    checks: { syntax: "pass", symbols: "pass" },
    risk: group === "ready" ? 0 : 0.2,
    group,
  };
}
