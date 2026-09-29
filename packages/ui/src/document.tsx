import { renderToStaticMarkup } from "react-dom/server";
import { MergePanel } from "./MergePanel.js";
import type { PanelModel } from "./model.js";
import { panelCss } from "./tokens.js";

/** Full document for a webview. User text is escaped by the renderer. */
export function renderPanelDocument(model: PanelModel): string {
  const body = renderToStaticMarkup(<MergePanel model={model} />);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>SmartMergeResolver</title><style>${panelCss}</style></head><body>${body}<script>${webviewScript}</script></body></html>`;
}

const webviewScript = `
document.body.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
  if (!target) return;
  const message = {
    action: target.getAttribute("data-action"),
    candidateId: target.getAttribute("data-candidate"),
    hunkId: target.getAttribute("data-hunk"),
    path: target.getAttribute("data-path")
  };
  const host = globalThis.acquireVsCodeApi;
  if (typeof host === "function") host().postMessage(message);
});
`;
