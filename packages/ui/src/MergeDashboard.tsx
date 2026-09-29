import type { ReactElement } from "react";
import type { DashboardSummary } from "@smartmerge/protocol";
import {
  DASHBOARD_ROW_HEIGHT,
  DASHBOARD_WINDOW,
  checkStrip,
  dashboardItems,
  type DashboardItem,
} from "./dashboard.js";

/** Presentational merge dashboard. It does not choose or apply a resolution. */
export function MergeDashboard({
  summary,
  linkFiles = false,
  theme,
}: {
  summary: DashboardSummary;
  /** When set, each file path opens that conflict. The editor leaves this off. */
  linkFiles?: boolean;
  theme?: "light" | "dark" | "contrast" | undefined;
}): ReactElement {
  const items = dashboardItems(summary);
  const visible = items.slice(0, DASHBOARD_WINDOW);
  const hunks = summary.totals.hunks;
  const resolved = summary.totals.resolved;
  const safe = summary.totals.safeToAccept;
  const progress = hunks === 0 ? 0 : Math.round((resolved / hunks) * 100);
  return (
    <section className="sm-panel sm-dashboard" aria-label="Merge dashboard">
      <header className="sm-header">
        <h1 className="sm-title">Merge dashboard</h1>
        <p className="sm-muted" role="status">
          {resolved} of {hunks} conflicts resolved
        </p>
        <div
          className="sm-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={Math.max(hunks, 1)}
          aria-valuenow={resolved}
          aria-label="Conflicts resolved"
        >
          <span style={{ width: `${String(progress)}%` }} />
        </div>
      </header>
      {safe > 0 ? (
        <button className="sm-primary" type="button" data-action="applyAllSafe">
          {`Accept ${String(safe)} safe resolutions`}
        </button>
      ) : (
        <p className="sm-muted">No resolution is safe to accept.</p>
      )}
      {items.length === 0 ? (
        <p className="sm-muted">This repository has no conflicted files.</p>
      ) : (
        <div className="sm-scroll" data-dashboard-scroll>
          <div
            className="sm-spacer"
            data-dashboard-spacer
            style={{ height: items.length * DASHBOARD_ROW_HEIGHT }}
          >
            <div className="sm-window" data-dashboard-window>
              {visible.map((item) => (
                <DashboardItemView
                  key={itemKey(item)}
                  item={item}
                  linkFiles={linkFiles}
                  theme={theme}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function DashboardItemView({
  item,
  linkFiles,
  theme,
}: {
  item: DashboardItem;
  linkFiles: boolean;
  theme?: "light" | "dark" | "contrast" | undefined;
}): ReactElement {
  if (item.kind === "header") {
    return (
      <h2 className="sm-group">
        <button type="button" data-group={item.group}>
          {item.label} ({item.count})
        </button>
      </h2>
    );
  }
  const { row } = item;
  const checks = checkStrip(row.checks);
  const strategy = row.topStrategy ?? "No recommendation";
  const band = row.band ?? "Not scored";
  return (
    <div className="sm-file" data-dashboard-row="true">
      {linkFiles ? (
        <a className="sm-path" href={fileHref(row.path, theme)} title={row.path}>
          {row.path}
        </a>
      ) : (
        <span className="sm-path" title={row.path}>
          {row.path}
        </span>
      )}
      <span className="sm-band">{band}</span>
      <span className="sm-heat" aria-hidden="true">
        <span style={{ width: `${String(Math.round(row.risk * 100))}%` }} />
      </span>
      <span className="sm-meta">
        <span className="sm-strategy" title={strategy}>
          {strategy}
        </span>
        <span className="sm-checks" title={checks}>
          {checks}
        </span>
      </span>
    </div>
  );
}

function itemKey(item: DashboardItem): string {
  return item.kind === "header" ? `header:${item.group}` : item.row.path;
}

function fileHref(path: string, theme: "light" | "dark" | "contrast" | undefined): string {
  const params = new URLSearchParams();
  params.set("path", path);
  if (theme !== undefined) params.set("theme", theme);
  return `/panel?${params.toString()}`;
}
