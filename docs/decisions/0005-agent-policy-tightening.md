# Agent policy can only be tightened by the repository

- **Status:** Accepted
- **Date:** 2026-10-01
- **Context:** Doc 14 says a repository policy can only tighten user policy, and that protected globs are never auto-applied. It does not say whether an explicit `apply_resolution` under `apply-any` may write a protected path, or how an agent process receives the user policy without accepting a mode from tool arguments.
- **Decision:** The person who starts `smart-merge mcp` sets the user policy with `--policy`. Omitting the flag uses the built-in default, `propose-and-verify`. `.smartmerge/policy.json` may only make that policy stricter. Tool arguments cannot set the mode or the actor kind; the actor is always `agent`. An agent never writes a protected path, including an explicit apply. Undo stays available unless the effective mode is `read-only`, because undo restores a backup.
- **Consequences:** A repository cannot grant itself `apply-any`. A protected lockfile or migration stays untouched by agent tools. The quality-gate tests cover path traversal, protected paths, and a repo file that tries to loosen a user policy.
