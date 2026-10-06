# SmartMergeResolver

<p align="center">
  <img src="assets/logo.png" width="64" height="64" alt="SmartMergeResolver">
</p>

SmartMergeResolver is being built as a free, IDE-agnostic merge conflict resolver. It explains each conflict, proposes a resolution, and checks the merged result before you apply it.

> **Status:** structural core for TypeScript and JavaScript, plus a shared merge panel and an editor adapter. `smart-merge status` lists conflicted files and recommends a resolution when both sides match, only one side changed, the difference is trailing whitespace, or the two sides edited different declarations, import names, or a rename. The editor adapter shows that recommendation and can accept it or undo it. Nothing is applied automatically. Pre-release 0.1.6 of the editor adapter is published ([marketplace listing](https://marketplace.visualstudio.com/items?itemName=bobrowsse-tech.smartmerge-resolver), [open registry](https://open-vsx.org/extension/bobrowsse-tech/smartmerge-resolver), [GitHub release](https://github.com/bobrowsse-tech/smartmerge/releases/tag/v0.1.6)). Specifications live in [`docs/`](docs/README.md). The npm package name is `smart-merge-resolver`; workspace packages stay private, so that package is not on the npm registry. All performance and accuracy figures in the docs are targets, not measurements.
>
> **License:** [`packages/core`](packages/core) and [`packages/daemon`](packages/daemon) are MPL-2.0. Everything else in this repository is Apache-2.0. See [`LICENSE`](LICENSE).

## How to use

Install pre-release 0.1.6 of the editor adapter from the marketplace listing or the open registry linked above.

1. Open a git repository that is in the middle of a merge or rebase, so a file still contains conflict markers.
2. Open that file, or run **Refresh conflicts**. The status bar shows the conflict count. Click that status item, or run **Open the merge panel**, to read the recommendation.
3. Run **Accept the recommended resolution** to write that recommendation. A backup is kept. Run **Undo the last resolution** to restore it. Nothing is applied automatically. Saved automatic apply stays off.
4. Run **Explain the recommendation** to open the panel on the current conflict. **Show the next conflict** and **Show the previous conflict** move through the list. **Open the merge dashboard** lists every conflicted file.

When the editor has focus, Alt+A accepts the recommendation, Alt+E explains it, Alt+N shows the next conflict, and Alt+P shows the previous one.

## Goals

- Show what each side changed, when and why, before showing code.
- Verify the merged result (syntax, symbols, types, lint) before applying.
- Work in every major editor, the terminal, and for AI agents.
- Local-first and private. No feature of the local tool is planned as a paid gate.

## Repository access

The repository is public. `main` cannot be deleted, and it changes only through pull requests. People who are not maintainers cannot open pull requests that stay open; please use issues. Publishing runs from a git tag on `main`, not from a local publish. Details: [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/decisions/0002-repository-access.md`](docs/decisions/0002-repository-access.md).

## Contributing

Read [`AGENTS.md`](AGENTS.md) for the rules every contributor and coding agent follows, then [`docs/README.md`](docs/README.md).

Developed by [Bob Rowsse Walakira](https://bobrowsse.com). Contact: [hello@bobrowsse.com](mailto:hello@bobrowsse.com).

Not affiliated with or endorsed by any editor or platform vendor mentioned for compatibility purposes.
