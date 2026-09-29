import type { DashboardRow, DashboardSummary } from "@smartmerge/protocol";

export const DASHBOARD_ROW_HEIGHT = 32;
export const DASHBOARD_WINDOW = 16;

const GROUP_ORDER = ["blocked", "needs-review", "ready"] as const;

const GROUP_LABEL = {
  blocked: "Blocked",
  "needs-review": "Needs review",
  ready: "Ready to accept",
} as const;

export type DashboardItem =
  | { kind: "header"; group: DashboardRow["group"]; label: string; count: number }
  | { kind: "row"; row: DashboardRow };

/** Flatten grouped rows into the virtual list, headers included. */
export function dashboardItems(summary: DashboardSummary): DashboardItem[] {
  const items: DashboardItem[] = [];
  for (const group of GROUP_ORDER) {
    const rows = summary.rows.filter((row) => row.group === group);
    const label = GROUP_LABEL[group];
    if (rows.length === 0) continue;
    items.push({ kind: "header", group, label, count: rows.length });
    for (const row of rows) items.push({ kind: "row", row });
  }
  return items;
}

/** Text for one check strip. Missing checks stay "not run" so the row height does not change. */
export function checkStrip(checks: DashboardRow["checks"]): string {
  const kinds = ["syntax", "symbols", "types", "lint"] as const;
  return kinds.map((kind) => `${kind} ${checkWord(checks[kind])}`).join(", ");
}

function checkWord(status: DashboardRow["checks"][keyof DashboardRow["checks"]]): string {
  if (status === "pass") return "pass";
  if (status === "fail") return "fail";
  return "not run";
}
