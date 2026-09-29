# 04 — IDE Adapters

## Adapter contract

An adapter must do only four things:

1. Locate/spawn the daemon (`smartmerged --stdio`) or attach to its socket.
2. Render a `ConflictSession` (via shared webview UI where possible, native controls otherwise).
3. Forward `UserAction`s (`accept`, `reject`, `edit`, `undo`, `applyAll`).
4. Surface native affordances (gutter marks, status bar, notifications).

No conflict logic, ever.

## Capability matrix

| Adapter                                                             | Language                 | UI approach                                                             | Distribution                   | Priority             |
| ------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------- | ------------------------------ | -------------------- |
| VS Code                                                             | TypeScript               | CodeLens plus webview panel plus Merge Editor integration               | VS Code Marketplace + Open VSX | P0                   |
| VS Code forks (Cursor, Windsurf, VSCodium, Positron, Theia)         | TypeScript               | Same package                                                            | Open VSX                       | P0 (free with above) |
| CLI / git mergetool                                                 | TypeScript               | TUI (Ink) plus optional local browser UI                                | npm (`smart-merge-resolver`)   | P0                   |
| JetBrains (IntelliJ family, WebStorm, PyCharm, GoLand, Rider, etc.) | Kotlin (thin)            | JCEF webview hosting shared UI, integrates with IDE's merge tool window | JetBrains Marketplace          | P1                   |
| Neovim                                                              | Lua (thin)               | Floating windows plus extmarks; optional browser handoff                | GitHub / plugin managers       | P1                   |
| Zed                                                                 | Rust/WASM extension shim | LSP facade (code actions, diagnostics)                                  | Zed extensions                 | P2                   |
| Sublime Text                                                        | Python shim (LSP client) | LSP facade                                                              | Package Control                | P2                   |
| Visual Studio                                                       | C# VSIX (thin)           | WebView2 hosting shared UI                                              | VS Marketplace                 | P2                   |
| Emacs, Helix                                                        | none                     | LSP facade only                                                         | docs                           | P3                   |
| Standalone browser mode                                             | TypeScript               | `smart-merge ui` opens local server plus browser                        | npm                            | P1                   |

## VS Code adapter (P0)

- `packages/adapters/vscode`: extension host code in TypeScript, bundled with esbuild.
- Activates on `workspaceContains:.git` and on `scm` conflict state.
- Spawns daemon as child process (stdio). Uses `vscode-jsonrpc`.
- UI:
  - **Gutter and CodeLens** above each conflict: recommendation, confidence badge, Accept / Compare / Explain.
  - **Merge panel** (webview): 3-way view, result preview, lineage timeline, breakage panel.
  - **Problems integration**: breakage diagnostics appear in the Problems panel with `source: smartmerge`.
  - **Status bar**: "N conflicts, M auto-resolvable".
- Commands: `smartmerge.resolveFile`, `resolveAll`, `explain`, `undo`, `toggleAutoApply`.
- Settings namespace `smartmerge.*` maps to the shared config (see 06).
- Respects Workspace Trust: analyzers requiring project tools disabled in untrusted workspaces.
- Coexists with built-in merge editor: opt-in replacement, never force.

## JetBrains adapter (P1)

- Kotlin plugin; use the platform's `MergeTool`/`DiffRequestFactory` extension points to add a "SmartMergeResolver" resolver action to the conflict dialog.
- Hosts shared UI in JCEF; bridge JS↔Kotlin via `JBCefJSQuery` mapped to protocol messages.
- Daemon is launched as external process using bundled Node or system Node (detect; offer download).
- Keep Kotlin under about 1.5k lines; generated protocol bindings from `06-protocol.types.ts` (via JSON Schema → Kotlin codegen).

## Neovim adapter (P1)

- Lua plugin; talks to daemon over stdio using `vim.system`/jobstart.
- Renders virtual text (confidence, recommendation), extmarks for hunks; commands `:SmartMergeResolve`, `:SmartMergeAcceptAll`.
- Optional integration as `git mergetool` command.
- Heavy UI (3-pane) opens in browser via `smart-merge ui`.

## LSP facade (P2 editors)

`smartmerged --lsp` exposes:

- `textDocument/codeAction`: "Accept recommended", "Accept ours/theirs/both".
- `textDocument/codeLens`: recommendation and confidence.
- `textDocument/publishDiagnostics`: breakage warnings.
- `workspace/executeCommand` for extra actions.
  This gives Zed, Sublime, Helix, Emacs, and any LSP client basic support with zero editor-specific logic.

## Visual Studio adapter (P2)

- C# VSIX; hosts shared UI in WebView2; hooks into Team Explorer/Git Changes conflict flow.
- Same protocol via stdio to bundled daemon.

## CLI (P0)

```
smart-merge status                 # list conflicts with recommendation and confidence
smart-merge resolve [file]         # interactive TUI
smart-merge resolve --auto         # apply only 'certain' verified resolutions
smart-merge explain <file>         # print explanation and evidence
smart-merge ui                     # local browser UI
smart-merge undo                   # restore last backup
smart-merge install-mergetool      # writes git config
smart-merge mcp                    # MCP server for AI agents (see 14)
smart-merge <cmd> --json           # machine-readable output on every command (see 14)
```

Git integration:

```
git config merge.tool smartmerge
git config mergetool.smartmerge.cmd 'smart-merge mergetool "$BASE" "$LOCAL" "$REMOTE" "$MERGED"'
git config mergetool.smartmerge.trustExitCode true
```

Exit codes: `0` resolved, `1` unresolved, `2` error.

## Shared UI package (`packages/ui`)

- React + TypeScript, Vite, state via a small store fed by protocol events.
- Pure presentational; receives `ConflictSession`, emits `UserAction`.
- Host bridge interface `HostBridge { post(msg), onMessage(cb) }` implemented per host (VS Code webview API, JCEF, WebView2, WebSocket for browser mode).
- Themeable through CSS variables mapped from host theme.

## Packaging and versioning

All adapters share the protocol version (`protocolVersion` in `initialize`). Adapters declare a supported range; the daemon negotiates and refuses incompatible clients with a clear upgrade message.
