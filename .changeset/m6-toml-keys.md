---
"@smartmerge/core": patch
"@smartmerge/daemon": patch
"@smartmerge/vscode": patch
"smart-merge-resolver": patch
---

Merge TOML keys and tables by name when each side edits a different one. A quoted key matches a bare key of the same text. Keys inside a table merge by name. An array and an array of tables stay in order and are not merged by position. The result stays in the high confidence band until a TOML replay corpus exists, so it is not applied automatically. The daemon advertises every language the parser can load.
