# 01 — Product Brief (refined)

## Vision

Turn merge-conflict resolution from a text-comparison chore into a fast, context-aware decision, in whatever editor the developer already uses.

## Problem

IDE tooling shows only "Current vs Incoming" text. Developers must rebuild context (what each side intended, which came first, what will break) by hand. This causes broken builds, silently dropped logic, and wasted time, especially in rebases and long-lived branches.

## Personas

| Persona             | Need                                                           |
| ------------------- | -------------------------------------------------------------- |
| Feature-branch dev  | Resolve conflicts quickly on rebase without breaking the build |
| Reviewer/maintainer | Trust that an automatic resolution is safe and inspectable     |
| CLI-first dev       | Same power from `git mergetool`, no IDE needed                 |
| Team lead           | Fewer merge-related regressions and less lost time             |

## Goals

1. Resolve trivial and structurally-independent conflicts automatically, with verification.
2. For the rest, present a ranked, explained recommendation with minimal clicks.
3. Detect resolutions that would break the build before they are committed.
4. Work in all major IDEs and the terminal with identical behavior.

5. Be visibly better than existing tools on clarity, trust, speed and reach, while being **completely free and open source** (see 10, 11, 12, 13).

## Non-goals (v1)

- Replacing code review or CI.
- Resolving semantic conflicts that no static analysis can detect (flag them, don't pretend).
- Hosting or a mandatory cloud service.
- Binary or generated-file conflict resolution beyond delegating to configured drivers.

## Feature pillars

Same four pillars as the original brief, with these clarifications.

**A. Temporal and lineage context.** Show commit time, author, message, linked issue for both sides and the merge base. Recency is displayed and used as one scoring signal; it never decides alone (a newer change is not automatically right).

**B. Predictive breakage analysis.** Layered checks, cheapest first: syntax (parse errors), scope/symbol (undeclared or duplicate identifiers), types (project's own TS/tsc or language server when available), lint (project config), optional test-impact hint. Each check reports `pass | fail | unknown`; never claim safety from `unknown`.

**C. Semantic merging and confidence.** Structural 3-way merge on the AST. Confidence is a calibrated probability that the resolution matches what an expert would choose, backed by evidence items. Auto-apply thresholds are configurable and off by default.

**D. Low-clutter UI.** Replace raw markers with a 3-pane logical view, a result preview and inline explanations. Show the recommendation first, with alternatives one click away.

## Success metrics

| Metric                              | Target                                                                                   | How measured                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Median time-to-resolve per conflict | at least 50% lower than baseline at v1, aspiration 90% for auto-resolvable classes       | Instrumented user study plus opt-in local timing |
| Auto-resolution precision           | at least 99% agreement with human resolution on the replay corpus for auto-applied class | Corpus benchmark                                 |
| Breakage false-negative rate        | under 2% for syntax/symbol checks                                                        | Corpus with injected bad resolutions             |
| Calibration error (ECE)             | under 0.03                                                                               | Reliability diagram on corpus                    |
| Daemon p95 latency                  | under 300 ms per conflict (no LLM)                                                       | Benchmark suite                                  |

## Privacy and trust principles

Local by default, transparent about any data sent, reversible everywhere, explanations always available.
