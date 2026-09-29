# 05 — UX Specification

## Design principles

1. **Recommendation first.** Lead with what the tool suggests and why, not raw diffs.
2. **Progressive disclosure.** Summary, then details, then raw. Breakage warnings are quiet until relevant.
3. **Never surprising.** Every change is previewed and undoable.
4. **Same mental model everywhere** (IDE, CLI, browser).

## Core flow

1. Conflicts detected, status bar and file badge show "3 conflicts, 2 auto-resolvable".
2. User opens the file, sees a CodeLens per conflict: `✓ Recommended: merge both (94%) · Compare · Explain`.
3. **Accept** applies the recommendation, with undo toast. **Compare** opens the merge panel.
4. After the last conflict, "Mark resolved" (runs `git add` if user allows).

## Merge panel layout

```
┌──────────────────────────────────────────────────────────────┐
│ Conflict 2 of 3 · src/auth/session.ts:41-68     [◀] [▶]      │
├──────────────────────────────────────────────────────────────┤
│ RECOMMENDATION  Merge both · High confidence (94%)   [Accept]│
│ Why: different functions edited; rename applied to both.     │
├───────────────┬───────────────┬──────────────────────────────┤
│ feature/login │ BASE (abc123) │ main                         │
│ 3 h ago       │ 3 weeks ago   │ 2 weeks ago                  │
│ Ana: "Add…"   │               │ Bo: "Rename…" #482           │
│ (diff view)   │ (diff view)   │ (diff view)                  │
├───────────────┴───────────────┴──────────────────────────────┤
│ RESULT (editable)                          ● 2 checks passed │
│ …                                                            │
├──────────────────────────────────────────────────────────────┤
│ Alternatives: Ours · Theirs · Both (A→B) · Both (B→A)        │
└──────────────────────────────────────────────────────────────┘
```

Sides are labeled with **branch names**, never "ours/theirs" alone (rebase inverts them).

## Temporal display

- Relative time as primary ("3 h ago"), absolute on hover.
- A slim timeline shows base, side commits in order. Newer is **not** shown as "better"; neutral styling.
- Lineage chips: PR/issue title, author, commit subject. Click opens in the provider.

## Predictive breakage: low-clutter design

Problem: warnings can flood the UI. Solution: a tiered, opt-in-detail system.

| Tier | Surface                                                                                              | When                                      |
| ---- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 0    | Nothing                                                                                              | All checks pass or `unknown` with no risk |
| 1    | Small confidence-dot on candidate chip (green/amber/red)                                             | Default                                   |
| 2    | One-line inline summary under recommendation: "Would break: `getUser` called with 2 args, expects 1" | Any `fail`                                |
| 3    | Breakage drawer with full diagnostics, click to jump                                                 | User expands                              |
| 4    | Problems-panel entries (IDE only)                                                                    | After apply, for remaining issues         |

Rules:

- Max one inline warning line per candidate; extra collapse into "+2 more".
- A hazardous candidate is de-emphasized (dimmed, "Accept" replaced by "Accept anyway…" with confirmation), never hidden.
- `unknown` is shown as a neutral gray dot with tooltip "Not verified: type check timed out". No green without evidence.
- Checks stream in; a subtle spinner per check, results never shift layout (reserved space).

## Impact preview

- "Preview file" toggle shows final file with changed regions highlighted.
- "Dependencies" tab lists importers/callers of touched symbols (top 10) with their diagnostics under the candidate.

## Bulk flow

"Resolve all safe conflicts" shows a summary table (file, strategy, confidence, checks) with checkboxes, then applies selected. Session log lists everything with per-item undo.

## States to design (Storybook stories required)

Loading, no conflicts, single conflict, many conflicts, high/medium/low confidence, hazardous candidate, unknown checks, unsupported language, offline provider, LLM disabled/enabled with payload preview, applying, applied with undo, error, daemon disconnected.

## Accessibility

- Keyboard: `Alt+A` accept, `Alt+N/P` next/previous, `Alt+E` explain, all rebindable.
- Screen-reader labels for confidence and check status ("High confidence, 94 percent, 2 of 2 checks passed").
- Never rely on color alone (icons plus text). WCAG 2.2 AA contrast; respect reduced motion.

## Copy guidelines

Plain, specific, no hype. Say "Merge both", not "Smart magic". Confidence words match bands in 03.

## Settings surface (minimal)

Auto-apply (off), threshold, LLM provider (off), context providers, checks to run, backup retention.
