---
"@smartmerge/core": patch
"@smartmerge/daemon": patch
"@smartmerge/vscode": patch
---

Merge Rust functions, methods, modules, types, and enum variants by name when each side edits a different one. The result stays in the high confidence band until a Rust replay corpus exists, so it is not applied automatically. The daemon advertises every language the parser can load.
