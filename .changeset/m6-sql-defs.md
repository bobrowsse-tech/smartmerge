---
"@smartmerge/core": patch
"@smartmerge/daemon": patch
"@smartmerge/vscode": patch
"smart-merge-resolver": patch
---

Merge SQL tables, views, and functions by name when each side edits a different one. A materialized view stays distinct from a view. Columns inside a table merge by name. The result stays in the high confidence band until a SQL replay corpus exists, so it is not applied automatically. The daemon advertises every language the parser can load.
