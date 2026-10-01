# 08 — Testing and Evaluation

## Test pyramid

| Level       | Scope                                                                  | Tooling                             |
| ----------- | ---------------------------------------------------------------------- | ----------------------------------- |
| Unit        | Strategies, scoring, marker parsing, redaction                         | vitest, property-based (fast-check) |
| Golden      | Fixture triples (base/ours/theirs → expected) per language             | vitest snapshots                    |
| Integration | Daemon RPC against real temp git repos with scripted conflicts         | vitest + git fixtures               |
| Adapter     | VS Code extension host tests; JetBrains platform tests; Neovim plenary | per-platform                        |
| UI          | Storybook stories plus Playwright visual/a11y (axe)                    | Playwright                          |
| Benchmark   | Replay corpus (below)                                                  | custom harness in `corpus/`         |

## Replay corpus

Purpose: measure real-world precision, calibrate confidence, prevent regressions.

Construction:

1. Select permissively licensed open-source repos across target languages.
2. Find historical merge commits with conflicts: re-run `git merge-tree` of the two parents; if it conflicts, the committed merge result is the **human ground truth**.
3. Store `(base, ours, theirs, human_result, language, metadata)` for each conflicted text file. `tsx packages/git/src/corpus-main.ts --repo <path> --out <dir>` reads a local repository. `--clone <url>` downloads a repository into a temporary directory and deletes that clone after reading it. Either way the JSON is written outside the source. If that destination is inside a repository, the file has to be ignored. The committed file is the ground truth for the whole file; the command does not slice it into hunks. Data is fetched by script, not committed (license hygiene). The command does not score calibration. `tsx packages/git/src/replay-main.ts conflicts.json --out <dir>` applies the current proposal to those files and writes one row per file that has a recommendation for every hunk. The confidence on that row is the fixed proposal score, not a fitted model. Files with no recommendation are counted and omitted. The command does not score calibration and does not commit the rows.
4. Split: 70% train (calibration), 15% validation, 15% held-out test. Split by repository, not by commit, to avoid leakage.

Metrics on held-out test:

- **Exact/semantic match rate**: candidate equals human result (exact, or AST-equal after formatting).
- **Auto-apply precision** for `certain` band (target ≥ 99%).
- **Coverage**: share of hunks reaching `certain`/`high`.
- **Breakage false negatives**: inject known-bad resolutions (dropped brace, undeclared symbol, wrong arity); target under 2% missed by syntax/symbols/types.
- **Calibration**: reliability diagram and expected calibration error (target ECE under 0.03) per band.
- **Latency** against budgets in 02.

## Calibration procedure

1. Extract features per candidate (see 03 §5).
2. Fit logistic regression on labeled train examples. `tsx packages/core/src/scoring-main.ts train.json [validation.json]` writes coefficient JSON to stdout. An empty train file does not produce a model. When the validation file has examples, Platt scaling is fit on it. Isotonic calibration is not part of this step yet.
3. `parseScoringModel` in core loads that JSON. `scoreFeatures` turns it into a probability, applies the confidence caps, and assigns a band. Certain still requires syntax, symbols, types, and lint to pass. No coefficient file is committed. Proposal confidence stays on the existing fixed values until a caller loads a fitted model. CI does not fit a model.
4. CI recomputes metrics; fail if precision or ECE gate regresses. `tools/calibration/score.ts` is covered by the tool tests in CI. `tsx tools/calibration/main.ts outcomes.json` scores a held-out file when one is supplied. An empty set does not pass and does not record an error. When outcomes exist, every populated confidence band must stay under 0.03. `tsx tools/calibration/heldout-main.ts rows.json` scores only the repositories in the held-out share of a 70/15/15 split. Train and validation rows are ignored. An empty held-out split does not pass and does not record an error. CI does not generate held-out outcomes, does not fetch repositories, and does not replay them.

## Safety tests (must always pass)

- Applying then undoing restores byte-identical file.
- Kill daemon mid-apply: working file is either old or fully new, never partial (atomic write plus fsync, temp file rename).
- Untrusted workspace: no project tools executed. The bundled type checker is not a project tool. Project lint is skipped unless the caller marks the workspace trusted.
- LLM disabled: zero network calls (asserted via network stub).
- Secrets in hunks never appear in LLM payload preview.

## User study (pre-v1)

Task-based comparison versus built-in merge tooling, 15–20 developers, 6 conflict scenarios of increasing difficulty. Measure time-to-resolve, error rate (build failing after resolution), and subjective confidence. This is what validates or revises the "90%" aspiration. The session shape and the scorer are in `docs/study-protocol.md`. A score is recorded only after those sessions exist.

## Agent interface tests

The agent quality gates in `14-ai-agent-interface.md` (verification catch rate, zero unsafe applies, policy-bypass and prompt-injection suites, token budgets) run in CI against the MCP server and JSON CLI using scripted agent transcripts, so no live LLM is needed for the gates. `packages/mcp/src/gates.ts` scores that run. Compact-mode size is recorded as characters divided by four. The token budget stays unset until an M4 baseline exists.

## Fuzzing

Fuzz marker parser and structural merge with random edits on valid ASTs; invariant: result parses whenever both inputs parse and edits are disjoint.
