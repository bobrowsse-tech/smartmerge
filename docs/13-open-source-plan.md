# 13 — Open Source Plan (free, forever)

Goal: the best merge-resolution tool, free and open source, with no paywalled features.

## Principles

1. **Everything in the product is free**: all languages, all checks, dashboard, CLI, every IDE adapter, private repos, offline use. No accounts, no seat limits, no usage caps.
2. **No bait-and-switch.** The license and a public "Free Forever" charter commit to keeping shipped features free. Any commercial offering must sell things that cost real money to run (hosted services, support), never features of the local tool.
3. **Local-first.** No servers required, so hosting cost is zero. AI features use the user's own keys or a local model.
4. **Transparent.** Public roadmap, public benchmarks, public decisions (ADRs).

## License

Decided in [`docs/decisions/0001-license.md`](decisions/0001-license.md):

- **MPL-2.0** for `packages/core` and `packages/daemon`, so a distributed change to those files stays under the same license.
- **Apache-2.0** for every other package and for the rest of the repository: permissive, with a patent grant, and usable in IDE marketplaces.
- Both licenses are free. Applying them has no fee, no registration, and no paid service.
- DCO sign-off (not CLA) to keep contribution friction low.

## Governance

- Maintainers file, `CODEOWNERS`, `GOVERNANCE.md` (benevolent-maintainer to start, path to a steering group once 5+ regular contributors).
- Code of Conduct (Contributor Covenant).
- `SECURITY.md` with private disclosure address and response SLA.
- Release notes via Changesets; semantic versioning; public deprecation policy.

## Community and contribution design

- **Good first issues** labeled in every package; a `CONTRIBUTING.md` that gets a new contributor from clone to running tests in under 10 minutes (`pnpm i && pnpm dev`).
- **Language plugin template** (`create-smartmerge-language`) so the community can add languages with fixtures and a corpus slice.
- **Context provider and adapter templates** likewise.
- **Corpus contributions**: users can opt in to submit anonymized _structure-only_ conflict shapes (never code) to improve calibration; default off. Also a "report a bad suggestion" button that produces a local, redacted, reviewable bundle the user can attach to an issue.

## Sustainability without paywalls (optional, never gating features)

- GitHub Sponsors and Open Collective for funding.
- Grants and sponsorships from companies that benefit (published transparently).
- Optional paid **support/consulting** for organizations.
- Optional future **hosted, team-shared services** (e.g., shared calibration insights, org policy distribution) that are additive; the local tool remains fully functional without them. Any such offering must be decided publicly and can never remove or restrict existing free capabilities.

## Distribution

- VS Code Marketplace and Open VSX (covers Cursor, Windsurf, VSCodium).
- npm (`smart-merge`), Homebrew, Scoop/winget, Nix, and static binaries via Node SEA.
- JetBrains Marketplace, Visual Studio Marketplace, Neovim via standard plugin managers.
- Reproducible builds, signed artifacts, SBOM.

## Quality bar for a free, open source tool

- Public benchmark dashboard (precision, coverage, latency) updated every release.
- Every claim on the website links to its methodology.
- Regression gates in CI (see 08, 12) so speed and accuracy never quietly decay.
- Docs site with searchable reference, "how it decides" explainer, and a troubleshooting guide.

## Project hygiene checklist (M0)

LICENSE, README with demo GIF, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, GOVERNANCE, issue/PR templates, CI badges, `docs/decisions/`, roadmap board, discussions enabled.
