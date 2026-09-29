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
2. Find historical merge commits with conflicts: re-run `git merge-tree`/`git merge` of the two parents; if it conflicts, the committed merge result is the **human ground truth**.
3. Store `(base, ours, theirs, human_result, language, metadata)` per hunk. Data is fetched by script, not committed (license hygiene).
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
2. Fit logistic regression on train; apply isotonic/Platt calibration on validation.
3. Export coefficients as versioned JSON (`scoring-model-vX.json`) loaded by core.
4. CI recomputes metrics; fail if precision or ECE gate regresses.

## Safety tests (must always pass)

- Applying then undoing restores byte-identical file.
- Kill daemon mid-apply: working file is either old or fully new, never partial (atomic write plus fsync, temp file rename).
- Untrusted workspace: no project tools executed.
- LLM disabled: zero network calls (asserted via network stub).
- Secrets in hunks never appear in LLM payload preview.

## User study (pre-v1)

Task-based comparison versus built-in merge tooling, 15–20 developers, 6 conflict scenarios of increasing difficulty. Measure time-to-resolve, error rate (build failing after resolution), and subjective confidence. This is what validates or revises the "90%" aspiration. The session shape and the scorer are in `docs/study-protocol.md`. A score is recorded only after those sessions exist.

## Agent interface tests

The agent quality gates in `14-ai-agent-interface.md` (verification catch rate, zero unsafe applies, policy-bypass and prompt-injection suites, token budgets) run in CI against the MCP server and JSON CLI using scripted agent transcripts, so no live LLM is needed for the gates.

## Fuzzing

Fuzz marker parser and structural merge with random edits on valid ASTs; invariant: result parses whenever both inputs parse and edits are disjoint.
