---
"@smartmerge/core": patch
"@smartmerge/daemon": patch
"@smartmerge/vscode": patch
---

Merge C++ functions, methods, classes, structs, namespaces, enums, constructors, and destructors by name when each side edits a different one. Overloads stay distinct by parameter types. The result stays in the high confidence band until a C++ replay corpus exists, so it is not applied automatically. The daemon advertises every language the parser can load.
