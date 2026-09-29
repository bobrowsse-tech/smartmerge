import type { DashboardRow } from "@smartmerge/protocol";
import { Box, render, Text, useInput } from "ink";
import { useRef, useState, type ReactElement } from "react";
import { resolveAuto, type CommandResult } from "./resolve.js";
import { loadConflicts } from "./session.js";

export interface TerminalUpdate {
  rows: readonly DashboardRow[];
  message: string;
}

/**
 * Full-screen conflict list. It renders rows it is given and reports key presses.
 * It does not decide whether a row may be written.
 */
export function TerminalApp(props: {
  initial: readonly DashboardRow[];
  onAccept: (path: string) => Promise<TerminalUpdate>;
  onQuit: (remaining: number) => void;
}): ReactElement {
  const [rows, setRows] = useState<readonly DashboardRow[]>(props.initial);
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState("");
  const rowsRef = useRef(rows);
  const selectedRef = useRef(selected);
  const busyRef = useRef(false);
  rowsRef.current = rows;
  selectedRef.current = selected;

  useInput((input, key) => {
    if (busyRef.current) return;
    if (input === "q" || (key.ctrl && input === "c")) {
      props.onQuit(rowsRef.current.length);
      return;
    }
    if (key.upArrow) {
      setSelected((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((current) => Math.min(Math.max(rowsRef.current.length - 1, 0), current + 1));
      return;
    }
    if (!key.return) return;
    const row = rowsRef.current[selectedRef.current];
    if (!row) return;
    busyRef.current = true;
    void props.onAccept(row.path).then(
      (update) => {
        busyRef.current = false;
        if (update.rows.length === 0) {
          props.onQuit(0);
          return;
        }
        setRows(update.rows);
        setMessage(update.message);
        setSelected(0);
      },
      (error: unknown) => {
        busyRef.current = false;
        setMessage(error instanceof Error ? error.message : "The action failed.");
      },
    );
  });

  return (
    <Box flexDirection="column">
      <Text>Merge dashboard</Text>
      {rows.length === 0 ? <Text>This repository has no conflicted files.</Text> : null}
      {rows.map((row, index) => (
        <Box key={row.path} flexDirection="column">
          <Text>
            {index === selected ? "> " : "  "}
            {row.path}
          </Text>
          <Text dimColor>
            {"  "}
            {groupLabel(row.group)} · {row.band ?? "not scored"} ·{" "}
            {row.topStrategy ?? "no recommendation"}
          </Text>
        </Box>
      ))}
      {message.length > 0 ? <Text>{message}</Text> : null}
      <Text dimColor>Up and down move. Enter accepts a certain row.</Text>
      <Text dimColor>q quits.</Text>
    </Box>
  );
}

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

function groupLabel(group: DashboardRow["group"]): string {
  if (group === "blocked") return "blocked";
  if (group === "ready") return "ready to accept";
  return "needs review";
}
