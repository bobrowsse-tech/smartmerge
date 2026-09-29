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
  const rowHeight = 32;
  const labels = { blocked: "Blocked", "needs-review": "Needs review", ready: "Ready to accept" };
  const order = ["blocked", "needs-review", "ready"];
  function items() {
    const next = [];
    for (const group of order) {
      const rows = summary.rows.filter((row) => row.group === group);
      if (rows.length === 0) continue;
      next.push({ kind: "header", group, count: rows.length });
      if (!closed.has(group)) {
        for (const row of rows) next.push({ kind: "row", row });
      }
    }
    return next;
  }
  function render() {
    const all = items();
    spacer.style.height = String(all.length * rowHeight) + "px";
    const top = scroller.scrollTop;
    const view = scroller.clientHeight || 320;
    const start = Math.max(0, Math.floor(top / rowHeight) - 2);
    const end = Math.min(all.length, Math.ceil((top + view) / rowHeight) + 2);
    list.style.transform = "translateY(" + String(start * rowHeight) + "px)";
    list.replaceChildren();
    for (let index = start; index < end; index += 1) {
      const item = all[index];
      if (!item) continue;
      if (item.kind === "header") {
        const heading = document.createElement("h2");
        heading.className = "sm-row";
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("data-group", item.group);
        button.textContent = labels[item.group] + " (" + String(item.count) + ")";
        heading.append(button);
        list.append(heading);
      } else {
        const row = document.createElement("div");
        row.className = "sm-row";
        row.setAttribute("data-dashboard-row", "true");
        const path = document.createElement("span");
        path.className = "sm-path";
        path.textContent = item.row.path;
        const band = document.createElement("span");
        band.textContent = item.row.band === null ? "Not scored" : item.row.band;
        row.append(path, band);
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
    render();
  });
  render();
}
`;
