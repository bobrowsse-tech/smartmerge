# Repository access

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context:** The source is meant to be public, and the product is meant to be free once a license is chosen (see 0001). The maintainer also required four controls: `main` cannot be deleted, changes reach `main` only through pull requests, publish runs from git, and people outside the maintainer set cannot open or merge pull requests.
- **Decision:**
  1. The GitHub repository is public. Anyone can read it, clone it, and fork it.
  2. A ruleset on `main` blocks deletion, blocks force-pushes, and requires a pull request. Nobody, including admins, can bypass that ruleset.
  3. Direct pushes to `main` are rejected. Merging a pull request is the only way to change `main`.
  4. A pull request opened by someone who is not a maintainer (write, maintain, or admin) is closed automatically. Issues stay open.
  5. npm publish runs only in GitHub Actions, and only for an annotated-style version tag `vX.Y.Z` whose commit is on `main`. `prepublishOnly` refuses every other context.
- **Consequences:** This is public source with a closed merge gate. It is not an open contribution model. Widening who can open pull requests is a later maintainer decision, recorded by updating this ADR and the workflow that enforces it. Forks remain possible because GitHub does not allow a public repository to disable forks.
