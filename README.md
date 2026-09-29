# SmartMergeResolver

SmartMergeResolver is being built as a free, IDE-agnostic merge conflict resolver. It explains each conflict, proposes a resolution, and checks the merged result before you apply it.

> **Status:** walking skeleton. `smart-merge status` lists conflicted files in a git repository. Specifications live in [`docs/`](docs/README.md). Nothing here is released yet. The npm package name is `smart-merge-resolver`. All performance and accuracy figures in the docs are targets, not measurements.
>
> **License:** [`packages/core`](packages/core) and [`packages/daemon`](packages/daemon) are MPL-2.0. Everything else in this repository is Apache-2.0. See [`LICENSE`](LICENSE).

## Goals

- Show what each side changed, when and why, before showing code.
- Verify the merged result (syntax, symbols, types, lint) before applying.
- Work in every major editor, the terminal, and for AI agents.
- Local-first and private. No feature of the local tool is planned as a paid gate.

## Repository access

The repository is public. `main` cannot be deleted, and it changes only through pull requests. People who are not maintainers cannot open pull requests that stay open; please use issues. Publishing runs from a git tag on `main`, not from a local publish. Details: [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/decisions/0002-repository-access.md`](docs/decisions/0002-repository-access.md).

## Contributing

Read [`AGENTS.md`](AGENTS.md) for the rules every contributor and coding agent follows, then [`docs/README.md`](docs/README.md).

Not affiliated with or endorsed by any editor or platform vendor mentioned for compatibility purposes.
