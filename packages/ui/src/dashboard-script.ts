import { DASHBOARD_ROW_HEIGHT } from "./dashboard.js";

/**
 * Scroll window for the dashboard document.
 * Row text is untrusted repository content and is assigned with textContent.
 */
export const dashboardScript = `
const payload = document.getElementById("sm-dashboard-data");
const scroller = document.querySelector("[data-dashboard-scroll]");
const spacer = document.querySelector("[data-dashboard-spacer]");
const list = document.querySelector("[data-dashboard-window]");
if (payload instanceof HTMLElement && payload.textContent && scroller instanceof HTMLElement && spacer instanceof HTMLElement && list instanceof HTMLElement) {
  const summary = JSON.parse(payload.textContent);
  const closed = new Set();
  const rowHeight = ${String(DASHBOARD_ROW_HEIGHT)};
  const labels = { blocked: "Blocked", "needs-review": "Needs review", ready: "Ready to accept" };
  const order = ["blocked", "needs-review", "ready"];
  function checkText(checks) {
    const kinds = ["syntax", "symbols", "types", "lint"];
    return kinds.map((kind) => {
      const status = checks ? checks[kind] : undefined;
      const word = status === "pass" ? "pass" : status === "fail" ? "fail" : "not run";
      return kind + " " + word;
    }).join(", ");
  }
  let cached = [];
  function rebuild() {
    const next = [];
    for (const group of order) {
      const rows = summary.rows.filter((row) => row.group === group);
      if (rows.length === 0) continue;
      next.push({ kind: "header", group, count: rows.length });
      if (!closed.has(group)) {
        for (const row of rows) next.push({ kind: "row", row });
      }
    }
    cached = next;
  }
  let view = scroller.clientHeight || 320;
  window.addEventListener("resize", () => {
    view = scroller.clientHeight || 320;
  });
  function render() {
    const all = cached;
    spacer.style.height = String(all.length * rowHeight) + "px";
    const top = scroller.scrollTop;
    const start = Math.max(0, Math.floor(top / rowHeight) - 2);
    const end = Math.min(all.length, Math.ceil((top + view) / rowHeight) + 2);
    list.style.transform = "translateY(" + String(start * rowHeight) + "px)";
    list.replaceChildren();
    for (let index = start; index < end; index += 1) {
      const item = all[index];
      if (!item) continue;
      if (item.kind === "header") {
        const heading = document.createElement("h2");
        heading.className = "sm-group";
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("data-group", item.group);
        button.textContent = labels[item.group] + " (" + String(item.count) + ")";
        heading.append(button);
        list.append(heading);
      } else {
        const row = document.createElement("div");
        row.className = "sm-file";
        row.setAttribute("data-dashboard-row", "true");
        const path = document.createElement("span");
        path.className = "sm-path";
        path.textContent = item.row.path;
        const band = document.createElement("span");
        band.className = "sm-band";
        band.textContent = item.row.band === null ? "Not scored" : item.row.band;
        const meta = document.createElement("span");
        meta.className = "sm-meta";
        const strategy = document.createElement("span");
        strategy.className = "sm-strategy";
        strategy.textContent = item.row.topStrategy === null ? "No recommendation" : item.row.topStrategy;
        const checks = document.createElement("span");
        checks.className = "sm-checks";
        checks.textContent = checkText(item.row.checks);
        const heat = document.createElement("span");
        heat.className = "sm-heat";
        heat.setAttribute("aria-hidden", "true");
        const fill = document.createElement("span");
        const risk = typeof item.row.risk === "number" ? item.row.risk : 0;
        fill.style.width = String(Math.round(risk * 100)) + "%";
        heat.append(fill);
        path.title = item.row.path;
        strategy.title = strategy.textContent;
        checks.title = checks.textContent;
        meta.append(strategy, checks);
        row.append(path, band, heat, meta);
        list.append(row);
      }
    }
  }
  scroller.addEventListener("scroll", () => { render(); });
  scroller.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-group]") : null;
    if (!(target instanceof HTMLElement)) return;
    const group = target.getAttribute("data-group");
    if (!group) return;
    if (closed.has(group)) closed.delete(group);
    else closed.add(group);
    rebuild();
    render();
  });
  rebuild();
  render();
}
`;
