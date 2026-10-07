# 03 — Engine Specification

## Pipeline

```
ConflictFile ──► 1 Discover ──► 2 Enrich ──► 3 Generate candidates ──► 4 Verify ──► 5 Score ──► 6 Explain ──► ResolutionProposal
```

### 1. Discover

- Source: `git ls-files -u` and `git diff --name-only --diff-filter=U`.
- Load stages 1/2/3 blobs (base/ours/theirs). Also parse in-file markers (`<<<<<<<`, `|||||||` diff3, `=======`, `>>>>>>>`) to map hunks to line ranges.
- Handle: add/add, modify/delete, rename/rename, mode conflicts (surface, delegate to user), binary (skip).
- Detect operation context: merge, rebase (note ours/theirs inversion!), cherry-pick, stash pop. The UI must label sides by branch name, not "ours/theirs".

### 2. Enrich (temporal and lineage context)

For each side and the base, gather:

- Commits touching the conflicted line range since merge-base (`git log -L`, `git blame` on the range).
- Author, commit time, relative time delta, message, PR/issue refs parsed from message (`#123`, `JIRA-456`).
- Provider lookups (optional, cached, offline-tolerant): PR title/description, issue title.
- **Intent summary**: deterministic first (commit subject), optional LLM summary.
- Change class per side: `rename | formatting | add | delete | move | logic | dependency-bump | comment`.

### 3. Generate candidates (strategy chain)

Each strategy yields zero or more `Candidate` objects with `strategy`, `result`, `evidence[]`.

| Order | Strategy              | Handles                                                                                                                             |
| ----- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `identical`           | Both sides made same change                                                                                                         |
| 2     | `one-side-unchanged`  | Only one side differs from base                                                                                                     |
| 3     | `whitespace-format`   | Differences vanish after formatter normalization                                                                                    |
| 4     | `structural-3way`     | AST-level merge: disjoint node edits, added members on both sides, import list unions, JSON/YAML key merges                         |
| 5     | `rename-aware`        | Rename on one side plus edits using the old name on the other; apply rename across other side's edits (verified by symbol analysis) |
| 6     | `list-union`          | Order-insensitive lists (imports, exports, enum members, dependency maps), sorted per project convention                            |
| 7     | `lockfile-regenerate` | Delegates to package manager regen (opt-in)                                                                                         |
| 8     | `llm-assisted`        | Only when 1–7 yield nothing usable; see below                                                                                       |
| —     | `manual`              | Always available: ours, theirs, both (ordered), edit                                                                                |

Rules:

- Strategies are pure functions of `(base, ours, theirs, ctx)`, so they are cacheable and testable.
- Structural merge must preserve comments and formatting of untouched regions (use concrete syntax positions, not pretty-printing the whole file).

### 4. Verify (predictive breakage analysis)

Run on the _virtual result_ of each candidate. Layers, cheapest first, each returns `Check { kind, status: 'pass'|'fail'|'unknown', diagnostics[], durationMs }`.

| Layer        | Method                                                                                                             | Notes                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `syntax`     | tree-sitter parse: zero `ERROR`/`MISSING` nodes in the touched range                                               | Always run                                   |
| `symbols`    | Scope analysis: undeclared identifiers, duplicate declarations, missing imports, changed call arity vs. definition | Per-language plugin                          |
| `types`      | Project's TypeScript program (incremental) or language server diagnostics diffed against baseline                  | Only new diagnostics count against candidate |
| `lint`       | Project lint config on virtual file, diagnostics diffed against baseline                                           | Optional                                     |
| `tests-hint` | Map touched symbols to test files (naming plus import graph); suggest, do not run                                  | Optional                                     |

Baseline diffing: run the same check on `ours` and `theirs` sides so pre-existing errors are not blamed on the candidate.

Type checks use the bundled compiler on the candidate and both sides. When the conflict is a hunk inside a larger file, the check uses that file with the hunk replaced, so names declared outside the hunk stay visible. They do not load a project program or project plugins. Project lint config is applied only when initialization marked the workspace trusted, and inline lint directives in the file are ignored because the file is untrusted. Otherwise the lint check stays unknown.

A candidate with any `fail` in syntax/symbols/types is marked `hazardous` and can never be auto-applied.

### 5. Score (confidence)

Confidence is a probability in [0,1] from a logistic model over features, trained and calibrated on the replay corpus (see 08).

Features (initial):

- strategy id (one-hot), tier (deterministic vs LLM)
- verification results per layer (pass/fail/unknown counts)
- change-class pair (e.g. rename × add)
- size of conflict region, number of hunks
- whether both sides touched same AST node type
- test-coverage hint present
- LLM self-agreement (multi-sample) if used
- recency delta (weak feature)

Caps: any `unknown` in syntax/symbols caps at 0.80; unsupported language caps at 0.70; LLM-only candidates cap at 0.85 unless verified by ≥ syntax+symbols pass.

Bands:

| Band      | Range                      | Behavior                           |
| --------- | -------------------------- | ---------------------------------- |
| `certain` | ≥ 0.98 and all checks pass | Eligible for opt-in auto-apply     |
| `high`    | 0.90–0.98                  | Recommended, one click to accept   |
| `medium`  | 0.60–0.90                  | Recommended with "review" emphasis |
| `low`     | < 0.60                     | Present choices, no recommendation |

Default: auto-apply disabled. When enabled, applies only `certain`, writes backup, adds a reversible entry to session log.

### 6. Explain

Every proposal carries `explanation`: strategy in plain words, evidence bullets (e.g. "Both sides edited different functions"), verification summary, time-delta and lineage lines. Explanations are generated from structured evidence templates, not free LLM text, unless the user enables LLM narration.

## LLM tier (optional)

- Interface `LlmProvider { propose(req): Promise<LlmCandidate[]> }`; adapters for Anthropic, OpenAI, local (Ollama) supplied via config.
- Input: base/ours/theirs hunks plus limited surrounding context and commit messages. Pass through redaction (secrets, emails, tokens) and size limits.
- Output must be structured JSON (candidate text plus rationale); reject anything that fails parsing.
- Always verified by step 4; never trusted directly.
- Multi-sample agreement improves confidence; disagreement lowers it.
- Per-repo opt-in, with a payload preview.

## Language support plan

Tier 1: TypeScript/JavaScript (incl. TSX/JSX), JSON/JSONC, YAML, Markdown.

JSON objects merge by key. A comma is inserted when two keys become neighbors, and a comma left behind by a deleted first key is dropped. Arrays stay order-sensitive, so a change on both sides is not combined. Escaped key spellings match after decoding. A clean JSON structural result stays in the high confidence band until a JSON replay corpus exists, so it is not marked certain and is not eligible for automatic apply.

YAML mappings merge by key the same way. Sequences stay order-sensitive. A plain key and a quoted spelling of the same text match, including a hex escape in a double-quoted key. An added key in a flow mapping stays before a trailing comment. A clean YAML structural result stays in the high confidence band until a YAML replay corpus exists, so it is not marked certain and is not eligible for automatic apply.

Python functions and classes merge by name. Methods added on each side of the same class are kept. A function or class that both sides change is left alone. Assignments and other statements are not merged by position. A clean Python structural result stays in the high confidence band until a Python replay corpus exists, so it is not marked certain and is not eligible for automatic apply.

Go functions merge by name. Methods merge by receiver type and name, so two methods with the same name on different types stay distinct. A function or method that both sides change is left alone. Statements and short declarations are not merged by position. A clean Go structural result stays in the high confidence band until a Go replay corpus exists, so it is not marked certain and is not eligible for automatic apply.

Java classes, interfaces, and enums merge by name. A nested type includes its enclosing type, so two nested types with the same simple name stay distinct. Methods and constructors merge by enclosing type and name. A method or constructor that both sides change is left alone, including two overloads of the same name. Fields and statements are not merged by position. A clean Java structural result stays in the high confidence band until a Java replay corpus exists, so it is not marked certain and is not eligible for automatic apply.

Kotlin classes, interfaces, and objects merge by name. A nested type includes its enclosing type. Functions merge by name, and a function inside a type includes that type. A function that both sides change is left alone. Properties and statements are not merged by position. A clean Kotlin structural result stays in the high confidence band until a Kotlin replay corpus exists, so it is not marked certain and is not eligible for automatic apply.

C# classes, interfaces, structs, and enums merge by name. A namespace stays named, and types inside a block namespace merge. A nested type includes its enclosing type. Methods and constructors merge by enclosing type and name. A method or constructor that both sides change is left alone, including two overloads of the same name. Fields and statements are not merged by position. A clean C# structural result stays in the high confidence band until a C# replay corpus exists, so it is not marked certain and is not eligible for automatic apply.

Rust functions and methods merge by name. A method includes its impl, so an inherent method and a trait method with the same name stay distinct. Modules, structs, unions, traits, and enum variants merge by name. A function, variant, or other item that both sides change is left alone. Fields and let bindings are not merged by position. A clean Rust structural result stays in the high confidence band until a Rust replay corpus exists, so it is not marked certain and is not eligible for automatic apply.

C functions and prototypes merge by name. A prototype and a definition of the same name stay distinct. Structs, unions, enums, typedefs, and macros merge by name. Enumerators merge by name inside their enum. A function or other item that both sides change is left alone. Fields and statements are not merged by position. A function wrapped in a preprocessor condition is not merged by name. A clean C structural result stays in the high confidence band until a C replay corpus exists, so it is not marked certain and is not eligible for automatic apply.

C++ functions and methods merge by name. Overloads stay distinct by parameter types, not parameter names. Classes, structs, namespaces, and enums merge by name. Constructors and destructors merge by name. A function or other item that both sides change is left alone. Fields and statements are not merged by position. A clean C++ structural result stays in the high confidence band until a C++ replay corpus exists, so it is not marked certain and is not eligible for automatic apply.

PHP functions and methods merge by name. Classes, interfaces, traits, and enums merge by name. A braced namespace is named, and the functions and classes inside it merge. A constant with one name merges by that name. A function or other item that both sides change is left alone. Properties, statements, and use declarations are not merged by position. A clean PHP structural result stays in the high confidence band until a PHP replay corpus exists, so it is not marked certain and is not eligible for automatic apply.

Ruby methods merge by name. Classes and modules merge by name. A method includes its class or module. A singleton method stays distinct from an instance method of the same name. A method that both sides change is left alone. Assignments, statements, and require, include, and extend calls are not merged by position. A clean Ruby structural result stays in the high confidence band until a Ruby replay corpus exists, so it is not marked certain and is not eligible for automatic apply.

Swift functions and methods merge by name. Classes, structs, enums, and protocols merge by name. A method includes its enclosing type. Enum cases merge by name inside their enum. An initializer is left alone. A function or other item that both sides change is left alone. Assignments, statements, and import declarations are not merged by position. A clean Swift structural result stays in the high confidence band until a Swift replay corpus exists, so it is not marked certain and is not eligible for automatic apply.

SQL tables, views, and functions merge by name. A name keeps its schema qualification. A materialized view stays distinct from a view of the same name. Columns merge by name inside their table. A function body is left alone. A statement that both sides change is left alone. Inserts, assignments, and other statements are not merged by position. A clean SQL structural result stays in the high confidence band until a SQL replay corpus exists, so it is not marked certain and is not eligible for automatic apply.

Tier 2: Python functions and classes, Go functions and methods, Java types and methods, Kotlin types and functions, C# types and methods, and Rust items are covered above.
Tier 3: C, C++, PHP, Ruby, Swift, and SQL are covered above. TOML and XML remain.
Unsupported: line-based strategies only, confidence caps apply.

## Failure handling

Every stage is time-boxed and cancellable. On timeout, stage output is `unknown`, and the proposal is still returned with reduced confidence and a visible note.
