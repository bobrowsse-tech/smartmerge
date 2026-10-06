# Contributing

SmartMergeResolver is public so people can read, clone, and fork the source. Changing this repository is limited to maintainers.

## Who can change `main`

- `main` cannot be deleted or force-pushed.
- Nobody pushes straight to `main`. A pull request is the only way in.
- Pull requests from people who are not maintainers are closed by automation. Please open an issue instead.
- Maintainers are GitHub accounts with write, maintain, or admin on this repository.

## Maintainer setup

Requirements: Node.js 24 (current LTS), pnpm 12.6.0, and git.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm lint
SMARTMERGE_FORBIDDEN_NAMES_FILE=private/forbidden-names.json pnpm check:public
```

`private/` is gitignored and stays on the maintainer machine. CI reads the same list from the `SMARTMERGE_FORBIDDEN_NAMES` Actions secret. The dependency-update workflow cannot read Actions secrets, so it reads a secret of the same name from its own secret store.

## Publishing

Publishing is a git operation, not a laptop `npm publish`.

1. Land the change through a pull request.
2. After it is on `main`, push a tag `vX.Y.Z` that points at that commit.
3. The Publish workflow checks that the tag is on `main`, builds, and publishes any package that is not `"private": true`.

The public npm package is `smart-merge-resolver` (`packages/cli`). Packages stay `"private": true` until a maintainer removes that flag on purpose. `prepublishOnly` exits if it is not running inside that tag workflow. Accepting the license does not publish a package.

## License

`packages/core` and `packages/daemon` are Mozilla Public License 2.0. Every other file in this repository is Apache License 2.0. The texts are in [`LICENSE`](LICENSE) and [`LICENSES/`](LICENSES). Both are free: no fee and no registration.

Maintainers add a `Signed-off-by` line to each commit, certifying the [Developer Certificate of Origin](https://developercertificate.org/). There is no contributor license agreement.
