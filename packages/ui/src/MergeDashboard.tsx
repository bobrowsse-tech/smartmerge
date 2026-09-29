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
export function MergeDashboard({ summary }: { summary: DashboardSummary }): ReactElement {
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
        <p className="sm-summary" role="status">
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
                <DashboardItemView key={itemKey(item)} item={item} />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function DashboardItemView({ item }: { item: DashboardItem }): ReactElement {
  if (item.kind === "header") {
    return (
      <h2 className="sm-row">
        <button type="button" data-group={item.group}>
          {item.label} ({item.count})
        </button>
      </h2>
    );
  }
  const { row } = item;
  return (
    <div className="sm-row" data-dashboard-row="true">
      <span className="sm-path">{row.path}</span>
      <span>{row.topStrategy ?? "No recommendation"}</span>
      <span>{row.band ?? "Not scored"}</span>
      <span>{checkStrip(row.checks)}</span>
      <span className="sm-heat" aria-hidden="true">
        <span style={{ width: `${String(Math.round(row.risk * 100))}%` }} />
      </span>
    </div>
  );
}

function itemKey(item: DashboardItem): string {
  return item.kind === "header" ? `header:${item.group}` : item.row.path;
}
