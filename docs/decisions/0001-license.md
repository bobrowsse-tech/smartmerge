# ADR 0001 — License

- **Status:** Proposed (needs maintainer decision and legal review before first public release)
- **Context:** The project is free and open source forever (docs/13). The license must allow broad adoption, IDE marketplace distribution and corporate use, and give contributors a patent grant.
- **Options:**
  1. Apache-2.0 for all packages (recommended).
  2. MPL-2.0 for `core` and `daemon`, Apache-2.0 for the rest (stronger protection against closed forks of the engine).
  3. Copyleft (GPL/AGPL): strongest openness guarantee, but limits corporate and marketplace adoption.
- **Decision:** _pending_
- **Consequences:** Record the chosen license in `LICENSE`, every `package.json`, and store listings. Use DCO sign-off, not a CLA.
- **Also decide here:** project name and package-name availability (trademark and npm/marketplace search) before launch.
- **Name check on 2026-09-29 (not a decision):** the npm package `smart-merge` is already published by an unrelated project. The npm names `smartmerge` and `@smartmerge/protocol` were unregistered. Several unrelated GitHub repositories already use the SmartMerge name. Do not treat the working title as cleared for trademark or for the CLI package name.
