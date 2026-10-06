# 07 — Repo and Tooling

## Monorepo layout (pnpm workspaces + Turborepo)

```
smartmerge/
├─ AGENTS.md
├─ docs/                     # this spec package + ADRs (docs/decisions/)
├─ packages/
│  ├─ protocol/              # types + zod schemas (from 06)
│  ├─ core/                  # pipeline, strategies, scoring
│  ├─ git/                   # git CLI wrapper
│  ├─ parsers/               # tree-sitter WASM + registry
│  ├─ analyzers/             # syntax, symbols, types, lint
│  ├─ context/               # lineage providers
│  ├─ llm/                   # providers, redaction, prompts
│  ├─ daemon/                # smartmerged
│  ├─ cli/                   # npm: smart-merge-resolver
│  ├─ ui/                    # React shared webview
│  └─ adapters/
│     ├─ vscode/
│     ├─ jetbrains/          # Kotlin (Gradle), generated bindings
│     ├─ neovim/             # Lua
│     └─ visualstudio/       # C# VSIX
├─ corpus/                   # replay corpus tooling (data fetched, not committed)
├─ tools/                    # codegen, release scripts (TypeScript)
├─ tsconfig.base.json
├─ pnpm-workspace.yaml
├─ turbo.json
└─ .changeset/
```

## TypeScript configuration (`tsconfig.base.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "declaration": true,
    "composite": true,
    "skipLibCheck": true
  }
}
```

- Project references between packages; `tsc -b` for typecheck, `tsup`/`esbuild` for bundling.
- ESLint flat config with `typescript-eslint` strict-type-checked; rule `@typescript-eslint/no-explicit-any: error`.
- Prettier for formatting.

## Key dependencies (verify current versions at install time)

| Need    | Choice                                                     |
| ------- | ---------------------------------------------------------- |
| Parsing | `web-tree-sitter` + language WASM grammars                 |
| RPC     | `vscode-jsonrpc` (works outside VS Code)                   |
| Schemas | `zod` (generate JSON Schema for Kotlin/C# codegen)         |
| Git     | system `git` via `execa`; no libgit2                       |
| Workers | Node `worker_threads` (`piscina` optional)                 |
| TUI     | `ink`                                                      |
| UI      | React, Vite, Storybook                                     |
| Tests   | `vitest`, `@vscode/test-electron`, Playwright for UI       |
| Release | Changesets, `vsce`/`ovsx`, Gradle publish, `nvim` via tags |

## Codegen

`tools/codegen.ts`: protocol zod schemas → JSON Schema → Kotlin data classes (quicktype) and C# classes. Generated files are committed and checked in CI for drift.

## CI (GitHub Actions)

- Matrix: linux/macos/windows × Node LTS.
- Jobs: typecheck, lint, unit, corpus-benchmark (nightly plus on `core` changes), UI Storybook visual tests, adapter integration tests, codegen drift check.
- Gates: corpus precision/ECE thresholds from 08; bundle size budget for daemon (under 25 MB including WASM grammars, lazily loaded).
- **Public-content guard** (`tools/check-public-content.ts`): fails the build if any published surface (docs site, README, package READMEs, store listing text, UI strings, release notes) contains a name on `private/forbidden-names.json` (or the file named by `SMARTMERGE_FORBIDDEN_NAMES_FILE`; never committed) (competitor products and brands, maintained privately by the Go-to-Market Agent), or if `private/` would be included in a public docs build or package tarball. Also runs on PR titles and commit messages. The dependency-update workflow cannot read Actions secrets, so it reads a secret of the same name from its own secret store.

## Release

- Independent versioning with Changesets; protocol package versions drive compatibility.
- Daemon shipped inside each adapter (bundled single-file plus WASM) and separately on npm.
- Signed releases; SBOM generated.

## Conventions

- Conventional commits; ADRs in `docs/decisions/`.
- Public APIs documented with TSDoc; no default exports.
- Errors are typed (`Result<T, E>` utility) in core; exceptions only at boundaries.
