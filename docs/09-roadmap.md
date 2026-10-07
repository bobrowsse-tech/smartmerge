# 09 — Roadmap and Milestones

Each milestone has acceptance criteria (AC). Do not start the next until all AC pass.

## M0 — Foundations (week 1–2)

- Monorepo, tsconfig, lint, CI, `protocol` package from 06.
- Open-source hygiene files and license ADR (13); benchmark harness skeleton (12).
- Daemon walking skeleton: `initialize`, `conflicts/list`, stub `resolution/propose`.
- **AC:** `smart-merge status` lists real conflicts in a scripted temp repo; CI green on 3 OSes.

## M1 — Deterministic core (week 3–6)

- Marker and diff3 parsing, 3-way blob loading, operation detection (merge/rebase inversion handled).
- Strategies 1–3 (`identical`, `one-side-unchanged`, `whitespace-format`), manual candidates.
- Backup and atomic apply plus undo.
- **AC:** safety tests in 08 pass; golden fixtures for all three strategies; rebase labeling correct.

## M2 — Structural engine, TS/JS (week 7–12)

- tree-sitter integration, TS/JS/TSX language plugin.
- `structural-3way`, `list-union`, `rename-aware`.
- Syntax and symbol checks; baseline diffing.
- Temporal and lineage enrichment from git.
- **AC:** replay corpus (TS/JS) built; auto-apply precision ≥ 99% on `certain`; breakage false negatives under 2% on injected set.

## M3 — VS Code adapter + shared UI (week 10–15, overlaps M2)

- Extension, CodeLens, merge panel, Problems integration, status bar.
- Storybook stories for every state in 05.
- **AC:** end-to-end test resolves a real conflict in VS Code; a11y checks pass; UX quality gates in 11 §8 met (SUS, CLS = 0, axe clean); performance budgets in 12 met; extension published to Marketplace + Open VSX as pre-release.

## M4 — CLI and git mergetool (week 12–16)

- TUI, `resolve --auto`, `install-mergetool`, browser UI mode.
- **AC:** `git mergetool` flow verified with exit codes; works headless over SSH (TUI).

## M4b — AI agent interface (week 14–18)

- `--json` on every CLI command, structured errors and exit codes, `verify` command and `candidate/verify` RPC.
- MCP server with tool annotations, agent policy enforcement, actor attribution and audit log.
- Agent kit (instructions snippet, installable skill) and CI mode.
- **AC:** agent quality gates in 14 pass (verification catches at least 98% of injected bad resolutions; zero unsafe applies; zero policy bypasses; zero followed injected instructions); an end-to-end agent run resolves a scripted multi-file conflict via MCP using only documented tools.

## M5 — Scoring calibration and type checks (week 15–20)

- Logistic model plus calibration pipeline; TS program type checks with baseline diff; lint layer.
- **AC:** ECE under 0.03 on held-out; CI gates active.

## M6 — Language expansion (week 18–26)

- Python, Go, Java, Kotlin, C#, Rust plugins; JSON/YAML structural merge.
- JSON object keys, YAML mapping keys, Python functions and classes, Go functions and methods, Java types and methods, Kotlin types and functions, C# types and methods, and Rust items merge structurally. Those results stay in the high band until a replay corpus exists.
- **AC:** each language has corpus slice and meets precision gate, or is capped at `high` band with documented reason. The JSON, YAML, Python, Go, Java, Kotlin, C#, and Rust caps are the reason in the line above.
- C functions, types, and macros use the same high-band cap. C++ uses the same high-band cap. PHP uses the same high-band cap. Ruby uses the same high-band cap. Swift uses the same high-band cap. SQL uses the same high-band cap. TOML uses the same high-band cap. XML remains open.

## M7 — More IDEs (week 20–30)

- JetBrains (JCEF), Neovim, LSP facade (unlocks Zed/Sublime/Helix/Emacs), Visual Studio.
- **AC:** each adapter passes the adapter contract test suite (`packages/adapter-contract-tests`), containing no conflict logic (checked by lint rule on imports).

## M8 — Optional LLM tier and providers (week 24–30)

- Provider interface, redaction, payload preview, multi-sample agreement, GitHub/GitLab/Jira context providers.
- **AC:** LLM disabled produces zero network calls; redaction tests pass; LLM candidates always verified.

## M9 — Beta and study (week 28–34)

- User study per 08, private beta, telemetry (opt-in) design review.
- **AC:** measured time-to-resolve reported honestly; decision recorded on whether 90% claim is supportable for any conflict class.

## M10 — 1.0 (week 34+)

- Docs site, signed releases, SBOM, support process.

## Risks and mitigations

| Risk                                   | Mitigation                                                               |
| -------------------------------------- | ------------------------------------------------------------------------ |
| Incorrect auto-resolution erodes trust | Auto-apply off by default, verification gate, backups, calibration gates |
| Language breadth explodes scope        | Plugin interface; confidence caps for weakly supported languages         |
| Type/lint checks slow or flaky         | Async, baseline diff, timeouts to `unknown`                              |
| IDE API churn                          | Thin adapters, contract tests, LSP facade fallback                       |
| LLM privacy concerns                   | Off by default, redaction, preview, local model option                   |
| Competing with built-ins that improve  | Focus on verification and explanation as differentiators                 |
