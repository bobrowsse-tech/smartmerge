---
"@smartmerge/core": patch
"@smartmerge/daemon": patch
"@smartmerge/vscode": patch
"smart-merge-resolver": patch
---

Merge JSONC objects by key when each side edits a different one. A comment is not a key. A trailing comma is a syntax error, so that file is not merged and the comma is not rewritten. Arrays stay in order. The result stays in the high confidence band until a JSONC replay corpus exists, so it is not applied automatically. The daemon advertises every language the parser can load. No new grammar file is copied.
