# 11 — Visual Design System and "Best-in-Class" UI

Goal: the cleanest, most legible conflict-resolution experience available, free and open source. This doc is the visual contract for the UX/UI Agent. It extends `05-ux-spec.md`; where they conflict, this one wins for visuals.

## 1. What "best-in-class" means (measurable)

Public-safe framing: we compare against **common approaches**, never named products (see `10-go-to-market.md`, claims discipline). Private research is in `private/competitive-notes.md` and is never published.

| Dimension                | Common approach in existing tools                               | SmartMergeResolver target                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Understanding a conflict | Side-by-side current/incoming plus output; explanation as text  | **Intent-first view**: each side summarized (what changed, when, why, by whom) before any code is shown; changes shown as _semantic operations_ ("renamed `getUser`", "added param `opts`") not just red/green lines |
| Trust in a suggestion    | Proposals reviewed by the user; low-confidence items flagged    | **Evidence-backed**: each suggestion shows which checks ran and passed (syntax, symbols, types, lint) on the _result_, plus calibrated confidence                                                                    |
| Speed                    | Often depends on network or cloud services                      | Deterministic proposals in under 300 ms, no network, no account; AI only when needed                                                                                                                                 |
| Reach                    | Often tied to one editor or one desktop app                     | Every major IDE plus terminal (see 04)                                                                                                                                                                               |
| Cost and openness        | Advanced features often paid or limited to certain repositories | **All features free, no account, no seat limits, open source**, including private repos and local/offline operation                                                                                                  |
| Whole-merge overview     | Per-file lists                                                  | **Merge Dashboard**: every conflicted file at a glance with strategy, confidence, checks, and risk heat                                                                                                              |

## 2. Design principles

1. **Calm by default.** One primary action per screen. Everything else is one step away, never in your face.
2. **Show meaning, not markers.** Translate diffs into human-readable change chips before showing code.
3. **Motion explains, never decorates.** Transitions (under 150 ms) only to show where content came from or went.
4. **Density is a setting.** Comfortable (default), compact, and spacious.
5. **Keyboard-first, mouse-friendly.** Every action has a shortcut and a visible affordance.

## 3. Visual language

### Spacing and layout

- 4 px base grid; spacing scale: 4, 8, 12, 16, 24, 32, 48.
- Panel padding 16 px (comfortable). Vertical rhythm between sections 24 px. Never less than 8 px between interactive elements.
- Max line length for prose 72 characters; code uses editor font at editor size.
- Layout regions have fixed jobs: **Header** (where am I), **Intent strip** (what happened), **Compare** (the code), **Result** (what you'll get), **Action bar** (what to do).

### Typography

- UI: system font stack (`system-ui`, `-apple-system`, `Segoe UI`); code: the user's editor font.
- Scale: 12 (meta), 13 (body), 14 (emphasis), 16 (section title), 20 (page title). Two weights only: 400 and 600.

### Color (semantic tokens, never raw hex in components)

Use CSS variables mapped from the host theme so the UI matches every IDE:

```
--sm-surface, --sm-surface-raised, --sm-border, --sm-text, --sm-text-muted
--sm-current, --sm-incoming, --sm-base            /* side identity: blue, violet, gray */
--sm-added, --sm-removed, --sm-modified            /* diff semantics */
--sm-ok, --sm-warn, --sm-danger, --sm-unknown      /* verification states */
--sm-accent                                        /* single brand accent, used sparingly */
```

Rules:

- Side identity colors (current/incoming) are **never** the same as diff colors (added/removed) to avoid the "red means wrong" trap.
- Every status has color **plus** icon **plus** text. WCAG 2.2 AA minimum, AAA for body text where feasible.
- Light, dark, and high-contrast themes are first-class; test all three in Storybook.

### Iconography and shape

- One icon set (Lucide or Codicons where hosted in VS Code), 16 px, 1.5 px stroke.
- Radius: 6 px controls, 10 px cards. Shadows only for floating layers (popovers, dialogs).

## 4. Signature visuals (what makes it feel best-in-class)

### 4.1 Merge Dashboard

A one-screen overview of the whole merge/rebase.

- Rows: file name, language, hunks count, **strategy chip**, **confidence ring**, **checks strip** (four small dots: syntax, symbols, types, lint), risk heat bar.
- Group by: ready to accept, needs review, blocked. Collapsible.
- Primary action: **"Accept N safe resolutions"** with a preview sheet listing exactly what will change.
- Progress header: "12 of 31 conflicts resolved", with an animated but subtle progress bar.

### 4.2 Intent strip (top of every conflict)

Three cards left to right: **current branch**, **base**, **incoming branch**.
Each card: avatar and author, relative time (absolute on hover), commit subject, linked issue/PR chip, and **change chips** (`renamed`, `added param`, `moved`, `formatting only`).
A thin timeline under the cards places both sides relative to the merge base, with neutral styling (newer is not "better").

### 4.3 Semantic diff view

- Default view shows **operations**, not lines: "Current: added `retries` option. Incoming: renamed `fetchUser` to `loadUser`." Click a chip to jump to the code.
- Code view: word-level and token-level highlighting inside changed lines; moved blocks shown with a connector line rather than delete-plus-add.
- Toggle: **Semantic / Line**.

### 4.4 Result pane with provenance

- The result is editable; every line has a subtle gutter tag showing its origin (current, incoming, both, edited).
- Hovering a line highlights its source lines in the compare panes.
- A live **verification bar** under the result: `Syntax ✓  Symbols ✓  Types …  Lint —`. Pending checks show a spinner in reserved space (no layout shift). `—` means not run, gray, never green.

### 4.5 Confidence ring

Small circular gauge with the band word ("High") and percentage on hover. Color from semantic tokens. Shape differs per band so it works without color (full ring, three-quarter, half, quarter).

### 4.6 Breakage callouts (uncluttered)

Follows the tiering in 05. Visual specifics: a single one-line callout under the recommendation with a warning icon, the specific problem in plain English, and a "Show" link that opens the drawer. Hazardous candidates render at reduced contrast with an "Accept anyway…" secondary button.

### 4.7 Impact preview

Split view: final file on the left, **impact graph** on the right: touched symbols as nodes, importers/callers as edges, red outline on nodes that would gain diagnostics. Limit to two hops; "Show more" expands. Keyboard navigable list alternative for accessibility.

### 4.8 Undo and session log

Persistent, unobtrusive "History" drawer: each applied resolution with one-click undo, plus a global "Undo last". Toasts are brief (4 s) and never block.

## 5. Interaction details

- **Accept recommended** is the only filled/primary button. Everything else is outline or text buttons.
- Next/previous conflict via `Alt+N` / `Alt+P`; accept `Alt+A`; explain `Alt+E`; toggle semantic/line `Alt+S`.
- Optimistic UI: accepting shows the result instantly; disk write happens after, with rollback on failure and a visible error.
- Empty state after last resolution: a calm summary ("All conflicts resolved. 31 resolved, 24 automatically. Nothing broken.") plus a single "Mark resolved and stage" button.
- No modal dialogs except destructive or hazardous confirmation.

## 6. Onboarding

- Zero-config first run: works without any account or setup.
- A 3-step optional tour (dashboard, intent strip, verification bar), skippable and never repeated.
- Sample conflict included ("Try it on a demo conflict") so users see the value before they need it.

## 7. Implementation requirements for `packages/ui`

- React + TypeScript, CSS variables plus CSS modules (no heavy runtime CSS-in-JS; keep bundle small).
- Headless accessible primitives (Radix UI or React Aria) for popovers, menus, dialogs, tabs.
- Virtualized lists for dashboard and large diffs (`@tanstack/virtual`); diff rendering via a lightweight custom renderer or CodeMirror 6 merge view. Do **not** embed Monaco in webviews unless bundle-size budget allows (see 12).
- Storybook: every component and every state from 05, in light/dark/high-contrast, at three widths (narrow sidebar 320 px, standard 720 px, wide 1200 px).
- Visual regression via Playwright screenshots; a11y via axe in CI.
- Design tokens defined once in `packages/ui/src/tokens.ts` (TypeScript) and emitted to CSS variables.

## 8. UX quality gates (must pass before 1.0)

| Gate                                                           | Threshold                       |
| -------------------------------------------------------------- | ------------------------------- |
| Usability test: novice resolves scripted conflict without docs | at least 90% success            |
| System Usability Scale (SUS)                                   | at least 85                     |
| Time to first meaningful paint of merge panel                  | under 200 ms after daemon reply |
| Zero layout shift while checks stream in                       | CLS = 0 in tests                |
| Axe violations                                                 | 0 serious/critical              |
| Works at 200% zoom and 320 px wide sidebar                     | no clipped controls             |
