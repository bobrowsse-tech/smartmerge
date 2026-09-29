# SmartMerge Spec Package

Intelligent, IDE-agnostic merge conflict resolver. **TypeScript-first.**

## How to use this package (for agents)

1. Read `AGENTS.md` first. It holds the non-negotiable rules and your role's directives.
2. Read the docs in numeric order. Later docs assume earlier ones.
3. `06-protocol.types.ts` is the source of truth for all cross-package contracts. Copy it into `packages/protocol/src/index.ts` verbatim, then extend via PR only.
4. Build in the order of `09-roadmap.md`. Do not start a milestone before the previous one's acceptance criteria pass.

## Index

| File                           | Purpose                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `AGENTS.md`                    | Rules, roles, definition of done                                                      |
| `01-product-brief.md`          | Refined PRD: goals, personas, non-goals, metrics                                      |
| `02-architecture.md`           | Core-plus-thin-adapters design, process model, security                               |
| `03-engine-spec.md`            | Resolution pipeline, temporal context, breakage analysis, scoring, LLM tier           |
| `04-ide-adapters.md`           | VS Code family, JetBrains, Neovim, Zed, Sublime, Visual Studio, CLI, web UI           |
| `05-ux-spec.md`                | Flows, screens, breakage-warning design, accessibility                                |
| `06-protocol.types.ts`         | Data model and JSON-RPC contract                                                      |
| `07-repo-and-tooling.md`       | Monorepo layout, TS config, CI, release                                               |
| `08-testing-and-evaluation.md` | Test pyramid, replay-corpus benchmark, calibration                                    |
| `09-roadmap.md`                | Milestones with acceptance criteria                                                   |
| `10-go-to-market.md`           | Positioning, differentiators, claims discipline (public-safe, no third-party names)   |
| `11-visual-design-system.md`   | Visual language, signature UI (dashboard, intent strip, semantic diff), quality gates |
| `12-performance-and-speed.md`  | Latency and memory budgets, speed techniques, benchmarks                              |
| `13-open-source-plan.md`       | Free-forever charter, license, governance, community, distribution                    |
| `14-ai-agent-interface.md`     | MCP server, JSON CLI, verify-any-resolution API, agent policy and safety              |

## Key changes vs. the original brief

- **One engine, many thin clients.** The brief said "VS Code extension + npm CLI". To cover all major IDEs the logic lives in a standalone TypeScript daemon (`smartmerged`). Every IDE plugin is a thin client.
- **"90% reduction" is a target, not a claim.** It becomes a measured metric (see 01 and 08).
- **Auto-accept is opt-in.** Confidence above 95% never applies silently by default. Only verified, reversible, previewed resolutions are auto-applied, and only if the user enables it.
- **Recency is a signal, not a rule.** Temporal data informs the explanation and scoring but never decides a resolution alone.
- **Local-first and private.** No code leaves the machine unless the user enables an LLM provider.
- **Best-in-class, free and open source.** Visual, fast and clean by explicit design targets (docs 11 and 12); every feature is free with no account (doc 13).
