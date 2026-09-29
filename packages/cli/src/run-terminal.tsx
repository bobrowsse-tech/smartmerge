import type { DashboardRow } from "@smartmerge/protocol";
import { render } from "ink";
import { resolveAuto, type CommandResult } from "./resolve.js";
import { loadConflicts } from "./session.js";
import { TerminalApp, type TerminalUpdate } from "./terminal.js";

/**
 * Show the conflict list on a terminal and accept a certain row when asked.
 * A row that is not ready is left unchanged. This does not enable automatic apply.
 */
export async function runTerminal(start: string, file?: string): Promise<CommandResult> {
  const loaded = await loadConflicts(start);
  const rows = visibleRows(loaded.summary.rows, file);
  if (file !== undefined && rows.length === 0) throw new Error(`No conflicted file at ${file}`);
  if (rows.length === 0) return { code: 0, text: "No conflicts.\n" };

  return new Promise((resolvePromise) => {
    let finished = false;
    const screen: { current?: ReturnType<typeof render> } = {};
    const finish = (result: CommandResult): void => {
      if (finished) return;
      finished = true;
      screen.current?.unmount();
      resolvePromise(result);
    };
    screen.current = render(
      <TerminalApp
        initial={rows}
        onAccept={(path) => acceptRow(start, file, path)}
        onQuit={(remaining) => {
          finish(
            remaining === 0
              ? { code: 0, text: "No conflicts.\n" }
              : { code: 1, text: "Conflicts remain.\n" },
          );
        }}
      />,
      { exitOnCtrlC: false },
    );
  });
}

async function acceptRow(
  start: string,
  file: string | undefined,
  path: string,
): Promise<TerminalUpdate> {
  const current = await loadConflicts(start);
  const row = current.summary.rows.find((item) => item.path === path);
  if (row?.group !== "ready") {
    return {
      rows: visibleRows(current.summary.rows, file),
      message: "This row is not a certain resolution. Nothing was written.",
    };
  }
  const result = await resolveAuto(start, path);
  const next = await loadConflicts(start);
  return {
    rows: visibleRows(next.summary.rows, file),
    message: result.text.trim(),
  };
}

function visibleRows(rows: readonly DashboardRow[], file: string | undefined): DashboardRow[] {
  return rows.filter((row) => file === undefined || row.path === file);
}
