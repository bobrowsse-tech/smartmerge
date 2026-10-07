---
"@smartmerge/core": patch
"@smartmerge/daemon": patch
"@smartmerge/vscode": patch
"smart-merge-resolver": patch
---

Merge Markdown sections by heading when each side edits a different one. The heading is the text stored for an ATX heading, so a closing hash stays part of the name. A paragraph, a list, a code block, a quote, a table, and a setext heading stay in order and are not merged by position. The result stays in the high confidence band until a Markdown replay corpus exists, so it is not applied automatically. The daemon advertises every language the parser can load.
