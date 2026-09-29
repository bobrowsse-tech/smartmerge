# 10 — Go-to-Market (public-safe)

> **Public documentation rule:** no third-party product, company or brand names in public-facing material (docs site, README, store listings, release notes, website, social posts). Describe capabilities generically ("other merge tools", "AI-based resolvers", "single-editor tools"). Private competitive research lives in `private/competitive-notes.md`, which is never published. See `AGENTS.md` rule 14.

## Positioning

"The merge resolver that shows you why, and checks it won't break your build, in the editor you already use. Free and open source."

## Differentiators

1. **Verification before apply**: syntax, symbol, type and lint checks on the virtual result, with baseline diffing.
2. **Calibrated confidence** with explicit bands; opt-in auto-apply gated on verification.
3. **Editor-agnostic**: same engine in the VS Code family, JetBrains, Neovim, the terminal, and any LSP-capable editor.
4. **Local-first and private** by default; AI optional with a payload preview.
5. **Explanations with lineage**: timing, linked issues and per-side intent shown before any code.
6. **Free forever**: every feature, private repositories and offline use included, no account.
7. **Measured claims**: benchmark methodology and results published.

## Claims discipline (legal and trust)

- Compare **capabilities and measurements**, never named products, in public.
- Every public claim links to a methodology or reproducible benchmark in this repository.
- Use factual, verifiable wording ("verifies the merged result with syntax, symbol, type and lint checks") rather than superlatives ("best", "faster than X") unless backed by published data.
- No competitor logos, screenshots, trademarks, or marketing copy.
- Nominative references to **integration targets** (editor names such as "VS Code" or "JetBrains IDEs") are allowed only to state compatibility, with the standard "not affiliated with or endorsed by" disclaimer. Follow each platform's brand guidelines.
- Do not name the project in a way that could be confused with existing products; run a trademark and package-name search before launch (ADR).
- Legal review of all launch copy, website and store listings before publication.

## Target segments

1. Individual developers and small teams with frequent rebases.
2. Teams with monorepos and long-lived branches.
3. Organizations needing local-only operation.

## Pricing

**Everything is free and open source** (see 13). No paid tiers for product features. Sustainability comes from sponsorship, grants and optional support.

## Launch plan

1. Open-source the core engine (license per ADR 0001).
2. Pre-release on VS Code Marketplace and Open VSX; CLI on npm.
3. Publish benchmark methodology and corpus scripts; invite scrutiny.
4. Launch posts with honest metrics and a demo of verification catching a bad resolution.
5. Gather opt-in feedback; iterate before JetBrains launch.

## Messaging guardrails

- Do not claim "90% reduction" unless the user study supports it; phrase as "up to X% on auto-resolvable conflicts" only with published data.
- Never claim "zero-risk". Say "verified" only for checks that actually ran and passed.
- Never disparage other tools.

## Metrics

Activation (first conflict resolved), weekly active resolvers, acceptance rate of recommendations, undo rate (proxy for wrong suggestions), time-to-resolve, retention.
