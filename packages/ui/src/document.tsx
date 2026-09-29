import type { DashboardSummary } from "@smartmerge/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { dashboardScript } from "./dashboard-script.js";
import { MergeDashboard } from "./MergeDashboard.js";
import { MergePanel } from "./MergePanel.js";
import type { PanelModel } from "./model.js";
import { panelCss } from "./tokens.js";

export type DocumentTheme = "light" | "dark" | "contrast";

/** Chrome for the local browser. The editor document leaves this unset. */
export interface DocumentView {
  browser?: boolean;
  theme?: DocumentTheme;
  linkFiles?: boolean;
  showHome?: boolean;
  pagePath?: string;
  notice?: string;
}

/** Full document for a webview. User text is escaped by the renderer. */
export function renderPanelDocument(model: PanelModel, view?: DocumentView): string {
  const body = renderToStaticMarkup(<MergePanel model={model} />);
  return documentShell(body, webviewScript, view);
}

/** Dashboard document. The scroll window is presentation; it does not apply a resolution. */
export function renderDashboardDocument(summary: DashboardSummary, view?: DocumentView): string {
  const body = renderToStaticMarkup(
    <MergeDashboard summary={summary} linkFiles={view?.linkFiles ?? false} theme={view?.theme} />,
  );
  const payload = JSON.stringify(summary).replaceAll("<", "\\u003c");
  return documentShell(
    `${body}<script type="application/json" id="sm-dashboard-data">${payload}</script>`,
    `${webviewScript}\n${dashboardScript}`,
    view,
  );
}

function documentShell(body: string, script: string, view?: DocumentView): string {
  const theme = view?.theme;
  const attrs = [
    theme ? ` data-theme="${theme}"` : "",
    view?.linkFiles ? ` data-file-links="true"` : "",
  ].join("");
  const chrome = view?.browser ? browserChrome(view) : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SmartMergeResolver</title><style>${panelCss}</style></head><body${attrs}>${chrome}${body}<script>${script}</script></body></html>`;
}

function browserChrome(view: DocumentView): string {
  const page = view.pagePath ?? "/";
  const links = [
    view.showHome ? `<a href="${escapeAttr(withTheme("/", view.theme))}">All conflicts</a>` : "",
    `<a href="${escapeAttr(withTheme(page, "light"))}">Light</a>`,
    `<a href="${escapeAttr(withTheme(page, "dark"))}">Dark</a>`,
    `<a href="${escapeAttr(withTheme(page, "contrast"))}">High contrast</a>`,
  ].filter((item) => item.length > 0);
  const notice =
    view.notice === undefined
      ? ""
      : `<p class="sm-muted" role="status">${escapeAttr(view.notice)}</p>`;
  return `<nav class="sm-nav" aria-label="View">${links.join("")}</nav>${notice}`;
}

function withTheme(pagePath: string, theme: DocumentTheme | undefined): string {
  const url = new URL(pagePath, "http://127.0.0.1");
  if (theme === undefined) url.searchParams.delete("theme");
  else url.searchParams.set("theme", theme);
  const query = url.searchParams.toString();
  return query.length === 0 ? url.pathname : `${url.pathname}?${query}`;
}

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

const webviewScript = `
document.body.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
  if (!target) return;
  const message = {
    action: target.getAttribute("data-action"),
    candidateId: target.getAttribute("data-candidate"),
    hunkId: target.getAttribute("data-hunk"),
    path: target.getAttribute("data-path"),
    next: location.pathname + location.search
  };
  const host = globalThis.acquireVsCodeApi;
  if (typeof host === "function") {
    host().postMessage(message);
    return;
  }
  void fetch("/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message)
  }).then(async (response) => {
    const payload = await response.json();
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The action failed.");
    if (typeof payload.next === "string" && payload.next.startsWith("/") && !payload.next.startsWith("//")) {
      location.href = payload.next;
    }
  }).catch((error) => {
    const node = document.createElement("p");
    node.className = "sm-danger";
    node.setAttribute("role", "alert");
    node.textContent = error instanceof Error ? error.message : "The action failed.";
    document.body.prepend(node);
  });
});
`;
