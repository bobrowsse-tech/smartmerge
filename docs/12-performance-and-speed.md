# 12 — Performance and Speed

Speed is a feature and a differentiator. These budgets are enforced in CI (see 08 benchmark harness).

## Budgets (p95 unless noted)

| Operation                                   | Budget                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| Extension activation (VS Code)              | under 100 ms to be idle-ready; daemon spawned lazily                      |
| Daemon cold start                           | under 400 ms                                                              |
| First conflict list in repo with 1000 files | under 500 ms                                                              |
| Deterministic proposal per hunk             | under 300 ms (typical under 50 ms)                                        |
| Merge panel first paint after click         | under 200 ms                                                              |
| Dashboard scroll with 500 conflicted files  | 60 fps (virtualized)                                                      |
| Syntax + symbol check per candidate         | under 150 ms                                                              |
| Type/lint checks                            | async, streamed, never blocking the UI                                    |
| Daemon idle memory                          | under 150 MB; under 300 MB with 5 warm language grammars and type program |
| UI bundle (gzipped)                         | under 300 KB initial, lazy-loaded diff renderer                           |

## Techniques

1. **Lazy everything.** Load tree-sitter grammars on first use of a language; spawn workers on demand; start type program only when a TS file is conflicted and the user opens it.
2. **Incremental and cached.** Content-addressed cache keyed by (base, ours, theirs, config version); persist to `.git/smartmerge/cache/` so second runs are instant.
3. **Speculative precompute.** As soon as conflicts are detected, propose for the _next_ conflict while the user reads the current one.
4. **Parallel across files.** Worker pool processes files concurrently, results stream to UI as they finish (the dashboard fills in live).
5. **Cheap-first ordering.** Run cheapest verification first; stop early if a candidate is already hazardous.
6. **No main-thread work.** Parsing, diffing, analysis in workers; UI only renders.
7. **Streaming protocol.** `check/progress` notifications deliver partial results so the UI shows something immediately.
8. **Bounded work.** Files over 1 MB or hunks over 2000 lines skip structural analysis and fall back to line strategies with a visible note.
9. **Cancellation.** Moving to another conflict or file cancels in-flight work via `AbortSignal`.
10. **Avoid heavy dependencies** in the daemon; prefer WASM grammars and native Node APIs.

## Simplicity budget (fewer steps is also faster)

Speed is measured in the user's actions as well as milliseconds. Targets, verified by scripted UI tests and the user study (08):

| Scenario                                            | Budget                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Setup before first use                              | 0 steps: no account, no sign-in, no config file, no API key                                   |
| Auto-resolvable conflict, user-visible actions      | 1 (accept), or 0 with opt-in auto-apply                                                       |
| Typical conflict needing a choice                   | at most 3 (open, accept recommendation, next)                                                 |
| Whole merge of 30 conflicts, mostly safe            | at most 5 (open dashboard, review summary, accept all safe, resolve remaining, mark resolved) |
| Time from "merge failed" to seeing a recommendation | under 1 s                                                                                     |
| Agent resolving a scripted 10-file conflict         | at most 12 tool calls in compact mode                                                         |
| Settings needed for normal use                      | 0 (sensible defaults; every setting optional)                                                 |

Design rules that follow: sensible defaults over options, one primary button, no wizards, no confirmation dialogs except for hazardous actions, and every advanced feature discoverable but out of the way.

## Tooling

- `pnpm bench` runs the latency suite on fixture repos of small/medium/large size; results stored per commit; CI fails on more than 10% regression versus main.
- Tracing: OpenTelemetry-compatible spans written to a local file behind `SMARTMERGE_TRACE=1` (no network).
- Memory profiling job on nightly builds.
