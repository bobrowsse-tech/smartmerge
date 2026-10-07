---
"@smartmerge/core": patch
"@smartmerge/daemon": patch
"@smartmerge/vscode": patch
"smart-merge-resolver": patch
---

Merge XML elements by name when each side edits a different one. A prefixed name stays distinct from the same local name. Text, a comment, an entity reference, and a CDATA section stay in order and are not merged by position. An attribute stays inside the start tag. The result stays in the high confidence band until an XML replay corpus exists, so it is not applied automatically. The daemon advertises every language the parser can load.
