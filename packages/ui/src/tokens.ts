/** Design tokens. Components use these variables and do not set raw colors. */
export const panelCss = `
:root {
  color-scheme: light dark;
  --sm-surface: #ffffff;
  --sm-surface-raised: #f4f4f5;
  --sm-border: #d4d4d8;
  --sm-text: #18181b;
  --sm-text-muted: #3f3f46;
  --sm-current: #1d4ed8;
  --sm-incoming: #6d28d9;
  --sm-base: #52525b;
  --sm-added: #047857;
  --sm-removed: #b45309;
  --sm-modified: #1d4ed8;
  --sm-ok: #047857;
  --sm-warn: #b45309;
  --sm-danger: #b91c1c;
  --sm-unknown: #52525b;
  --sm-accent: #0f766e;
  --sm-space-2: 8px;
  --sm-space-3: 12px;
  --sm-space-4: 16px;
  --sm-space-6: 24px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.45;
}
@media (prefers-color-scheme: dark) {
  :root {
    --sm-surface: #18181b;
    --sm-surface-raised: #27272a;
    --sm-border: #3f3f46;
    --sm-text: #fafafa;
    --sm-text-muted: #d4d4d8;
    --sm-current: #93c5fd;
    --sm-incoming: #c4b5fd;
    --sm-base: #a1a1aa;
    --sm-added: #6ee7b7;
    --sm-removed: #fdba74;
    --sm-modified: #93c5fd;
    --sm-ok: #6ee7b7;
    --sm-warn: #fdba74;
    --sm-danger: #fca5a5;
    --sm-unknown: #d4d4d8;
    --sm-accent: #5eead4;
  }
}
[data-theme="dark"] {
  --sm-surface: #18181b;
  --sm-surface-raised: #27272a;
  --sm-border: #3f3f46;
  --sm-text: #fafafa;
  --sm-text-muted: #d4d4d8;
  --sm-current: #93c5fd;
  --sm-incoming: #c4b5fd;
  --sm-base: #a1a1aa;
  --sm-added: #6ee7b7;
  --sm-removed: #fdba74;
  --sm-modified: #93c5fd;
  --sm-ok: #6ee7b7;
  --sm-warn: #fdba74;
  --sm-danger: #fca5a5;
  --sm-unknown: #d4d4d8;
  --sm-accent: #5eead4;
}
[data-theme="contrast"] {
  --sm-surface: Canvas;
  --sm-surface-raised: Canvas;
  --sm-border: CanvasText;
  --sm-text: CanvasText;
  --sm-text-muted: CanvasText;
  --sm-current: LinkText;
  --sm-incoming: LinkText;
  --sm-base: CanvasText;
  --sm-ok: CanvasText;
  --sm-warn: CanvasText;
  --sm-danger: CanvasText;
  --sm-unknown: CanvasText;
  --sm-accent: LinkText;
}
@media (forced-colors: active) {
  :root {
    --sm-surface: Canvas;
    --sm-surface-raised: Canvas;
    --sm-border: CanvasText;
    --sm-text: CanvasText;
    --sm-text-muted: CanvasText;
    --sm-current: LinkText;
    --sm-incoming: LinkText;
    --sm-base: CanvasText;
    --sm-ok: CanvasText;
    --sm-warn: CanvasText;
    --sm-danger: CanvasText;
    --sm-unknown: CanvasText;
    --sm-accent: LinkText;
  }
}
body { margin: 0; background: var(--sm-surface); color: var(--sm-text); }
.sm-panel { box-sizing: border-box; display: grid; gap: var(--sm-space-6); padding: var(--sm-space-4); width: min(100%, 72ch); max-width: 100%; }
.sm-header, .sm-intent, .sm-result, .sm-actions { display: grid; gap: var(--sm-space-2); min-width: 0; }
.sm-title { margin: 0; font-size: 16px; font-weight: 600; }
.sm-muted { color: var(--sm-text-muted); margin: 0; }
.sm-summary { min-height: 8em; margin: 0; overflow-wrap: anywhere; }
.sm-notes { min-height: 4.35em; }
.sm-sides { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sm-space-3); }
@media (max-width: 40rem) { .sm-sides { grid-template-columns: 1fr; } }
.sm-card { min-width: 0; border: 1px solid var(--sm-border); border-radius: 10px; padding: var(--sm-space-3); background: var(--sm-surface-raised); }
.sm-card h2 { margin: 0 0 var(--sm-space-2); font-size: 14px; font-weight: 600; }
.sm-current h2 { color: var(--sm-current); }
.sm-incoming h2 { color: var(--sm-incoming); }
.sm-base h2 { color: var(--sm-base); }
pre { margin: 0; max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.4 ui-monospace, "Cascadia Code", monospace; }
.sm-actions { display: flex; flex-wrap: wrap; }
button { box-sizing: border-box; max-width: 100%; min-height: 32px; margin-right: var(--sm-space-2); border: 1px solid var(--sm-border); border-radius: 6px; background: var(--sm-surface-raised); color: var(--sm-text); padding: 4px 12px; overflow-wrap: anywhere; }
button.sm-primary { background: var(--sm-accent); color: var(--sm-surface); border-color: var(--sm-accent); }
.sm-danger { color: var(--sm-danger); }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;
