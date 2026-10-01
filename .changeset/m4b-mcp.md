---
"@smartmerge/protocol": patch
"@smartmerge/core": patch
"@smartmerge/git": patch
"@smartmerge/daemon": patch
"@smartmerge/mcp": minor
"smart-merge-resolver": minor
---

Add an MCP server that lists, verifies, and applies conflict resolutions under agent policy. Writes stay off unless the process is started with an apply policy, and each action is recorded in the local audit log.
