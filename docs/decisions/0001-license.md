# ADR 0001 — License

- **Status:** Accepted (2026-09-29)
- **Context:** The project is free and open source forever (docs/13). The license must allow broad adoption, IDE marketplace distribution and corporate use, and give contributors a patent grant. The maintainer also required a choice that costs nothing to apply or keep: no license fee, no registration, and no paid legal review.
- **Options:**
  1. Apache-2.0 for all packages (recommended).
  2. MPL-2.0 for `core` and `daemon`, Apache-2.0 for the rest (stronger protection against closed forks of the engine).
  3. Copyleft (GPL/AGPL): strongest openness guarantee, but limits corporate and marketplace adoption.
- **Decision:** Option 2. `packages/core` and `packages/daemon` are MPL-2.0. Every other package, and the rest of this repository, is Apache-2.0. Both are standard free licenses. Exhibit B of the MPL ("Incompatible With Secondary Licenses") is not used. Packages stay `"private": true` until a maintainer publishes them from a `vX.Y.Z` tag on `main`. Choosing the license does not publish anything.
- **Consequences:** The license texts live in `LICENSES/` and are copied to each package `LICENSE`. The root `LICENSE` states which paths use which text. `package.json` uses the SPDX ids above, except the private workspace root, which points at `LICENSE` because one SPDX id would misstate the split. Per-file headers are omitted; the package `LICENSE` is the MPL Exhibit A notice for `core` and `daemon`. Contributions use a Developer Certificate of Origin sign-off (`Signed-off-by`), not a CLA. Store listings, when they exist, must repeat this split. No trademark filing is part of this decision.
- **Project name:** SmartMergeResolver (2026-09-29). This is the name in the README, governance documents, and the GitHub repository description. No trademark application is filed; registering one would cost money and is not required.
- **Identifiers unchanged:** repository `bobrowsse-tech/smartmerge`, scope `@smartmerge/*`, command `smart-merge`, daemon `smartmerged`, and the protocol type `SmartMergeConfig`.
- **Name check on 2026-09-29:** the npm package `smart-merge` is already published by an unrelated project. `smartmergeresolver`, `smart-merge-resolver`, `@smartmergeresolver/protocol`, `smartmerge`, and `@smartmerge/protocol` were unregistered. Several unrelated GitHub repositories already use the SmartMerge name. Do not publish this project as the npm package `smart-merge`.
