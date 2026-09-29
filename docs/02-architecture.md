# 02 — Architecture

## Principle: one engine, many thin clients

```
 ┌────────────┐ ┌───────────┐ ┌──────────┐ ┌────────┐ ┌───────────┐
 │ VS Code /  │ │ JetBrains │ │ Neovim / │ │  CLI   │ │ Visual    │
 │ Cursor etc │ │ (Kotlin)  │ │ Zed/Subl.│ │ (TS)   │ │ Studio    │
 └─────┬──────┘ └─────┬─────┘ └────┬─────┘ └───┬────┘ └─────┬─────┘
       │  JSON-RPC 2.0 over stdio / local socket (protocol pkg)  │
       └───────────────────────┬─────────────────────────────────┘
                        ┌──────▼───────┐
                        │  smartmerged │  (Node/TS daemon)
                        │  RPC server  │
                        └──────┬───────┘
        ┌──────────┬───────────┼─────────────┬───────────────┐
   ┌────▼───┐ ┌────▼─────┐ ┌───▼──────┐ ┌────▼──────┐ ┌──────▼─────┐
   │  git   │ │ parsers  │ │ resolver │ │ breakage  │ │ LLM tier   │
   │ layer  │ │ tree-    │ │ pipeline │ │ analyzers │ │ (optional) │
   │        │ │ sitter   │ │          │ │ (workers) │ │            │
   └────────┘ └──────────┘ └──────────┘ └───────────┘ └────────────┘
```

## Why a daemon rather than per-IDE logic

- Write the hard part once, in TypeScript, and test it once.
- Non-blocking by construction: the IDE UI thread only exchanges JSON messages.
- Same behavior in every editor and the CLI.
- LSP is used where it fits (diagnostics, code lenses, code actions), but merge sessions need custom messages (proposals, previews), so the primary contract is a dedicated JSON-RPC protocol, with an **LSP facade** offered as a bonus for LSP-capable editors (see 04).

## Process model

- `smartmerged` is spawned by the adapter (stdio) or attached to a per-repo local socket (Unix domain socket / named pipe) so several windows share one warm cache.
- Main thread: RPC, scheduling, cache. **Worker pool** (`worker_threads`, size = cores − 1, max 4): parsing, structural merge, breakage checks. Each job is cancellable via `AbortSignal`.
- Long-running external tools (tsc, eslint, language servers) run as child processes with timeouts and output caps.

## Packages (see 07 for layout)

| Package      | Role                                                                 |
| ------------ | -------------------------------------------------------------------- |
| `protocol`   | Types and JSON-RPC schemas (zod) shared by everything                |
| `core`       | Pipeline, strategies, scoring, explanation                           |
| `git`        | Conflict discovery, 3-way blobs, blame, log, backups (wraps git CLI) |
| `parsers`    | tree-sitter WASM loading, language registry                          |
| `analyzers`  | Syntax, symbol, type, lint checks                                    |
| `context`    | Commit/issue lineage providers (git, GitHub, GitLab, Jira)           |
| `llm`        | Provider interface, redaction, prompt builders                       |
| `daemon`     | RPC server, worker pool, cache                                       |
| `cli`        | npm package `smart-merge-resolver`; `smart-merge` command            |
| `mcp`        | MCP server exposing the engine to AI agents (see 14)                 |
| `agent-kit`  | Agent instructions snippet and installable agent skill (see 14)      |
| `ui`         | Shared React webview app                                             |
| `adapters/*` | IDE-specific shells                                                  |

## Key design decisions

1. **Three-way, not two-way.** Always obtain base, ours, theirs via `git show :1: :2: :3:` (index stages), so structural merge has the common ancestor.
2. **Virtual working copy.** The daemon computes candidate results in memory; nothing touches disk until the user applies. Preview and breakage checks run on the virtual result (analyzers receive an in-memory file overlay).
3. **Language plugin interface.** Each language provides: parser, structural node matcher, identifier resolver, optional formatter. Unsupported languages fall back to line-based plus heuristics, with lower confidence caps.
4. **Content-addressed cache.** Key = hash(base, ours, theirs, config version). Same conflict again returns instantly.
5. **Graceful degradation.** If an analyzer times out or a tool is missing, the check returns `unknown`, and confidence is capped accordingly.

## Performance budgets

| Operation                                              | p95 budget           |
| ------------------------------------------------------ | -------------------- |
| Discover conflicts in repo (1000 files, 20 conflicted) | 500 ms               |
| Propose resolution for one file, no LLM                | 300 ms               |
| Syntax and symbol checks per candidate                 | 150 ms               |
| Type/lint checks per candidate                         | 5 s, async, streamed |
| Daemon idle memory                                     | under 150 MB         |

## Security

- Never execute repo code except the project's declared lint/type tools, and only with the user's workspace trust granted (VS Code workspace trust and equivalents).
- Redact secrets before any LLM call (entropy plus pattern scanner); show a preview of the payload.
- Daemon socket is user-only permissions (0600); random per-session token required on connect.
- Backups stored under `.git/smartmerge/backups/`, pruned after 30 days by default.

## Extensibility

- Language plugins (npm packages exporting `LanguagePlugin`).
- Context providers (`ContextProvider`) for issue trackers.
- Custom merge strategies registered by config, sandboxed (no fs/network) if user-supplied.
