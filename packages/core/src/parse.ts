import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Language, Parser, type Node as SyntaxNode } from "web-tree-sitter";

const require = createRequire(import.meta.url);

/** A packaged daemon keeps grammars beside the bundle. A workspace install resolves the packages. */
function grammar(specifier: string, fileName: string): string {
  const beside = fileURLToPath(new URL(`./wasm/${fileName}`, import.meta.url));
  if (existsSync(beside)) return beside;
  return require.resolve(specifier);
}

/** A named syntax token, in source order, used to detect a pure rename. */
export interface IdentifierSpan {
  text: string;
  start: number;
  end: number;
}

/** One syntax or symbol problem, before baseline comparison. */
export interface ParseIssue {
  line: number;
  message: string;
  code: string;
}

/**
 * One concrete syntax node plus the trivia that precedes it.
 * `slice` is copied into a merge result; the node is never reprinted.
 */
export interface ConcreteNode {
  key: string;
  stable: boolean;
  type: string;
  /**
   * When false, an unstable node is not aligned by position.
   * Python, Go, Java, Kotlin, C#, Rust, C, C++, PHP, Ruby, Swift, SQL, TOML, XML, and Markdown statements use this so two assignments are not merged just because they line up.
   */
  positional: boolean;
  /**
   * When true, a following pair needs a comma.
   * TOML pairs use this only inside an inline table.
   */
  flow: boolean;
  body: string;
  slice: string;
  /** Text from the start of `body` through the opening delimiter of `children`. */
  prefix: string;
  /** Text from the end of `children` through the end of `body`. */
  suffix: string;
  children: ConcreteRegion | null;
}

/** Sibling nodes and the text that follows the last of them. */
export interface ConcreteRegion {
  nodes: ConcreteNode[];
  trailing: string;
}

/** A parsed hunk side. `null` from {@link parseSource} means the parser is not loaded. */
export interface ParsedSource {
  hasErrors: boolean;
  region: ConcreteRegion;
  syntaxIssues: ParseIssue[];
  symbolIssues: ParseIssue[];
  identifiers: IdentifierSpan[];
}

/** Language ids with a structural parser, in advertisement order. */
export const STRUCTURAL_LANGUAGES = [
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
  "json",
  "yaml",
  "python",
  "go",
  "java",
  "kotlin",
  "csharp",
  "rust",
  "c",
  "cpp",
  "php",
  "ruby",
  "swift",
  "sql",
  "toml",
  "xml",
  "markdown",
] as const;

const SUPPORTED = new Set<string>(STRUCTURAL_LANGUAGES);

const GLOBALS = new Set([
  "Array",
  "BigInt",
  "Boolean",
  "Buffer",
  "Date",
  "Error",
  "Infinity",
  "Intl",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "Promise",
  "Proxy",
  "Reflect",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "TextDecoder",
  "TextEncoder",
  "URL",
  "URLSearchParams",
  "WeakMap",
  "WeakSet",
  "arguments",
  "atob",
  "btoa",
  "clearInterval",
  "clearTimeout",
  "console",
  "crypto",
  "decodeURIComponent",
  "document",
  "encodeURIComponent",
  "exports",
  "fetch",
  "globalThis",
  "isNaN",
  "module",
  "parseFloat",
  "parseInt",
  "process",
  "queueMicrotask",
  "require",
  "setInterval",
  "setTimeout",
  "structuredClone",
  "undefined",
  "window",
]);

let ready: Promise<void> | null = null;
let languages: Map<string, Language> | null = null;
const parsers = new Map<string, Parser>();

/** True when `languageId` has a structural parser. */
export function isStructuralLanguage(languageId: string | null): boolean {
  return languageId !== null && SUPPORTED.has(languageId);
}

/** True after {@link initParsers} has finished. */
export function parsersReady(): boolean {
  return languages !== null;
}

/**
 * Load the syntax parsers once. Safe to call from several workers.
 * A failed load leaves structural strategies unavailable; line strategies still run.
 */
export function initParsers(): Promise<void> {
  ready ??= loadParsers().catch((error: unknown) => {
    ready = null;
    throw error;
  });
  return ready;
}

async function loadParsers(): Promise<void> {
  const runtime = fileURLToPath(new URL("./web-tree-sitter.wasm", import.meta.url));
  if (existsSync(runtime)) await Parser.init({ locateFile: () => runtime });
  else await Parser.init();
  const typescript = await Language.load(
    grammar("tree-sitter-typescript/tree-sitter-typescript.wasm", "tree-sitter-typescript.wasm"),
  );
  const tsx = await Language.load(
    grammar("tree-sitter-typescript/tree-sitter-tsx.wasm", "tree-sitter-tsx.wasm"),
  );
  const javascript = await Language.load(
    grammar("tree-sitter-javascript/tree-sitter-javascript.wasm", "tree-sitter-javascript.wasm"),
  );
  const json = await Language.load(
    grammar("tree-sitter-json/tree-sitter-json.wasm", "tree-sitter-json.wasm"),
  );
  const yaml = await Language.load(
    grammar(
      "@tree-sitter-grammars/tree-sitter-yaml/tree-sitter-yaml.wasm",
      "tree-sitter-yaml.wasm",
    ),
  );
  const python = await Language.load(
    grammar("tree-sitter-python/tree-sitter-python.wasm", "tree-sitter-python.wasm"),
  );
  const go = await Language.load(
    grammar("tree-sitter-go/tree-sitter-go.wasm", "tree-sitter-go.wasm"),
  );
  const java = await Language.load(
    grammar("tree-sitter-java/tree-sitter-java.wasm", "tree-sitter-java.wasm"),
  );
  const kotlin = await Language.load(
    grammar(
      "@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm",
      "tree-sitter-kotlin.wasm",
    ),
  );
  const csharp = await Language.load(
    grammar("tree-sitter-c-sharp/tree-sitter-c_sharp.wasm", "tree-sitter-c_sharp.wasm"),
  );
  const rust = await Language.load(
    grammar("tree-sitter-rust/tree-sitter-rust.wasm", "tree-sitter-rust.wasm"),
  );
  const c = await Language.load(grammar("tree-sitter-c/tree-sitter-c.wasm", "tree-sitter-c.wasm"));
  const cpp = await Language.load(
    grammar("tree-sitter-cpp/tree-sitter-cpp.wasm", "tree-sitter-cpp.wasm"),
  );
  const php = await Language.load(
    grammar("tree-sitter-php/tree-sitter-php_only.wasm", "tree-sitter-php_only.wasm"),
  );
  const ruby = await Language.load(
    grammar("tree-sitter-ruby/tree-sitter-ruby.wasm", "tree-sitter-ruby.wasm"),
  );
  const swift = await Language.load(
    grammar("@binclusive/tree-sitter-swift-wasm/tree-sitter-swift.wasm", "tree-sitter-swift.wasm"),
  );
  const sql = await Language.load(
    grammar("@l1xnan/tree-sitter-sql/tree-sitter-sql.wasm", "tree-sitter-sql.wasm"),
  );
  const toml = await Language.load(
    grammar(
      "@tree-sitter-grammars/tree-sitter-toml/tree-sitter-toml.wasm",
      "tree-sitter-toml.wasm",
    ),
  );
  const xml = await Language.load(
    grammar("@cursorless/tree-sitter-wasms/out/tree-sitter-xml.wasm", "tree-sitter-xml.wasm"),
  );
  const markdown = await Language.load(
    grammar(
      "@cursorless/tree-sitter-wasms/out/tree-sitter-markdown.wasm",
      "tree-sitter-markdown.wasm",
    ),
  );
  languages = new Map<string, Language>([
    ["typescript", typescript],
    ["typescriptreact", tsx],
    ["javascript", javascript],
    ["javascriptreact", javascript],
    ["json", json],
    ["yaml", yaml],
    ["python", python],
    ["go", go],
    ["java", java],
    ["kotlin", kotlin],
    ["csharp", csharp],
    ["rust", rust],
    ["c", c],
    ["cpp", cpp],
    ["php", php],
    ["ruby", ruby],
    ["swift", swift],
    ["sql", sql],
    ["toml", toml],
    ["xml", xml],
    ["markdown", markdown],
  ]);
}

/**
 * Parse `source` with the grammar for `languageId`.
 * Returns null when parsers are not loaded or the language has no grammar yet.
 */
export function parseSource(languageId: string, source: string): ParsedSource | null {
  const language = languages?.get(languageId);
  if (!language) return null;
  let parser = parsers.get(languageId);
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(language);
    parsers.set(languageId, parser);
  }
  const tree = parser.parse(source);
  if (!tree) return null;
  const root = tree.rootNode;
  const parsed: ParsedSource = {
    hasErrors: false,
    region: regionOf(languageId, source, root, root.startIndex, root.endIndex),
    syntaxIssues: collectSyntax(root),
    symbolIssues: collectSymbols(languageId, root),
    identifiers: collectIdentifiers(root),
  };
  parsed.hasErrors = parsed.syntaxIssues.length > 0;
  tree.delete();
  return parsed;
}

function regionOf(
  languageId: string,
  source: string,
  parent: SyntaxNode,
  start: number,
  end: number,
): ConcreteRegion {
  const children = parent.namedChildren.filter(
    (child) => child.startIndex >= start && child.endIndex <= end,
  );
  const nodes: ConcreteNode[] = [];
  let cursor = start;
  for (const child of children) {
    nodes.push(toNode(languageId, source, child, source.slice(cursor, child.endIndex)));
    cursor = child.endIndex;
  }
  return { nodes, trailing: source.slice(cursor, end) };
}

function toNode(languageId: string, source: string, node: SyntaxNode, slice: string): ConcreteNode {
  const declared = node.type === "export_statement" ? (innerDeclaration(node) ?? node) : node;
  const key = keyFor(languageId, declared);
  const body = source.slice(node.startIndex, node.endIndex);
  const inner = containerRange(languageId, declared);
  if (!inner) {
    return {
      key: key.key,
      stable: key.stable,
      type: declared.type,
      positional: statementPositional(languageId, key.stable),
      flow: tomlFlow(languageId, declared),
      body,
      slice,
      prefix: "",
      suffix: "",
      children: null,
    };
  }
  return {
    key: key.key,
    stable: key.stable,
    type: declared.type,
    positional: statementPositional(languageId, key.stable),
    flow: tomlFlow(languageId, declared),
    body,
    slice,
    prefix: source.slice(node.startIndex, inner.start),
    suffix: source.slice(inner.end, node.endIndex),
    children: regionOf(languageId, source, inner.parent, inner.start, inner.end),
  };
}

function innerDeclaration(node: SyntaxNode): SyntaxNode | null {
  return node.namedChildren.find((child) => child.type !== "comment") ?? null;
}

function keyFor(languageId: string, node: SyntaxNode): { key: string; stable: boolean } {
  if (languageId === "toml") {
    const tomlKey = tomlDefinitionKey(node);
    if (tomlKey !== null) return { key: tomlKey, stable: true };
    return { key: node.type, stable: false };
  }
  if (languageId === "xml") {
    const xmlKey = xmlDefinitionKey(node);
    if (xmlKey !== null) return { key: xmlKey, stable: true };
    return { key: node.type, stable: false };
  }
  if (languageId === "markdown") {
    const markdownKey = markdownDefinitionKey(node);
    if (markdownKey !== null) return { key: markdownKey, stable: true };
    return { key: node.type, stable: false };
  }
  if (node.type === "pair") {
    const key = node.childForFieldName("key");
    const raw = key?.text ?? "";
    const text = languageId === "json" ? (decodeJsonString(raw) ?? raw) : raw;
    return { key: `pair:${text}`, stable: text.length > 0 };
  }
  if (node.type === "block_mapping_pair" || node.type === "flow_pair") {
    const key = node.childForFieldName("key");
    const text = key ? yamlKeyText(key) : "";
    if (text === null || text.length === 0) return { key: "yaml:unparsed", stable: false };
    return { key: `yaml:${text}`, stable: true };
  }
  if (node.type === "import_statement") {
    const moduleName = node.descendantsOfType("string")[0];
    return { key: `import:${moduleName?.text ?? ""}`, stable: true };
  }
  if (node.type === "import_specifier") {
    const local = node.childForFieldName("alias") ?? node.childForFieldName("name");
    if (local) return { key: `import_specifier:${local.text}`, stable: true };
  }
  const goKey = languageId === "go" ? goDefinitionKey(node) : null;
  if (goKey !== null) return { key: goKey, stable: true };
  if (languageId === "java") {
    const javaKey = javaDefinitionKey(node);
    if (javaKey !== null) return { key: javaKey, stable: true };
    return { key: node.type, stable: false };
  }
  if (languageId === "kotlin") {
    const kotlinKey = kotlinDefinitionKey(node);
    if (kotlinKey !== null) return { key: kotlinKey, stable: true };
    return { key: node.type, stable: false };
  }
  if (languageId === "csharp") {
    const csharpKey = csharpDefinitionKey(node);
    if (csharpKey !== null) return { key: csharpKey, stable: true };
    return { key: node.type, stable: false };
  }
  if (languageId === "rust") {
    const rustKey = rustDefinitionKey(node);
    if (rustKey !== null) return { key: rustKey, stable: true };
    return { key: node.type, stable: false };
  }
  if (languageId === "c") {
    const cKey = cDefinitionKey(node);
    if (cKey !== null) return { key: cKey, stable: true };
    return { key: node.type, stable: false };
  }
  if (languageId === "cpp") {
    const cppKey = cppDefinitionKey(node);
    if (cppKey !== null) return { key: cppKey, stable: true };
    return { key: node.type, stable: false };
  }
  if (languageId === "php") {
    const phpKey = phpDefinitionKey(node);
    if (phpKey !== null) return { key: phpKey, stable: true };
    return { key: node.type, stable: false };
  }
  if (languageId === "ruby") {
    const rubyKey = rubyDefinitionKey(node);
    if (rubyKey !== null) return { key: rubyKey, stable: true };
    return { key: node.type, stable: false };
  }
  if (languageId === "swift") {
    const swiftKey = swiftDefinitionKey(node);
    if (swiftKey !== null) return { key: swiftKey, stable: true };
    return { key: node.type, stable: false };
  }
  if (languageId === "sql") {
    const sqlKey = sqlDefinitionKey(node);
    if (sqlKey !== null) return { key: sqlKey, stable: true };
    return { key: node.type, stable: false };
  }
  const defined = pythonDefinition(node);
  if (defined) {
    const definitionName = defined.childForFieldName("name");
    const text = definitionName?.text ?? "";
    if (text.length === 0) return { key: defined.type, stable: false };
    const kind = defined.type === "class_definition" ? "class" : "def";
    return { key: `${kind}:${text}`, stable: true };
  }
  const name = node.childForFieldName("name");
  if (name && name.text.length > 0) return { key: `${node.type}:${name.text}`, stable: true };
  if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
    const binding = node.descendantsOfType("identifier")[0];
    if (binding) return { key: `${node.type}:${binding.text}`, stable: true };
  }
  return { key: node.type, stable: false };
}

function mappingInterior(
  mapping: SyntaxNode | null,
): { parent: SyntaxNode; start: number; end: number } | null {
  if (!mapping) return null;
  if (mapping.type === "block_mapping") {
    if (mapping.endIndex <= mapping.startIndex) return null;
    return { parent: mapping, start: mapping.startIndex, end: mapping.endIndex };
  }
  if (mapping.type === "flow_mapping" && mapping.endIndex - mapping.startIndex >= 2) {
    return { parent: mapping, start: mapping.startIndex + 1, end: mapping.endIndex - 1 };
  }
  return null;
}

/** The mapping a document or value directly contains. A sequence is not opened. */
function nestedMapping(value: SyntaxNode | null): SyntaxNode | null {
  if (!value) return null;
  if (value.type === "block_mapping" || value.type === "flow_mapping") return value;
  if (value.type === "block_sequence" || value.type === "flow_sequence") return null;
  if (
    value.type !== "document" &&
    value.type !== "block_node" &&
    value.type !== "flow_node" &&
    value.type !== "stream"
  ) {
    return null;
  }
  for (const child of value.namedChildren) {
    const found = nestedMapping(child);
    if (found) return found;
  }
  return null;
}

function objectInterior(
  object: SyntaxNode,
): { parent: SyntaxNode; start: number; end: number } | null {
  if (object.type !== "object" || object.endIndex - object.startIndex < 2) return null;
  return { parent: object, start: object.startIndex + 1, end: object.endIndex - 1 };
}

function containerRange(
  languageId: string,
  node: SyntaxNode,
): { parent: SyntaxNode; start: number; end: number } | null {
  if (languageId === "toml") return tomlItemBody(node);
  if (languageId === "xml") return xmlItemBody(node);
  if (languageId === "markdown") return markdownItemBody(node);
  if (languageId === "cpp") {
    const cppBody = cppItemBody(node);
    if (cppBody) return cppBody;
  }
  if (languageId === "php") {
    const phpBody = phpItemBody(node);
    if (phpBody) return phpBody;
  }
  if (languageId === "ruby") {
    const rubyBody = rubyItemBody(node);
    if (rubyBody) return rubyBody;
  }
  if (languageId === "swift") return swiftItemBody(node);
  if (languageId === "sql") return sqlItemBody(node);
  const cBody = cItemBody(node);
  if (cBody) return cBody;
  const rustBody = rustItemBody(node);
  if (rustBody) return rustBody;
  const kotlinBody = kotlinTypeBody(node);
  if (kotlinBody) return kotlinBody;
  const csharpBody = csharpTypeBody(node);
  if (csharpBody) return csharpBody;
  const defined = pythonDefinition(node);
  if (defined?.type === "class_definition") {
    const body = defined.childForFieldName("body");
    if (!body || body.type !== "block" || body.endIndex <= body.startIndex) return null;
    return { parent: body, start: body.startIndex, end: body.endIndex };
  }
  if (node.type === "block_mapping" || node.type === "flow_mapping") return mappingInterior(node);
  if (node.type === "document" || node.type === "block_node" || node.type === "flow_node") {
    return mappingInterior(nestedMapping(node));
  }
  if (node.type === "block_mapping_pair" || node.type === "flow_pair") {
    return mappingInterior(nestedMapping(node.childForFieldName("value")));
  }
  if (node.type === "object") return objectInterior(node);
  if (node.type === "pair") {
    const value = node.childForFieldName("value");
    if (!value || value.type !== "object") return null;
    return objectInterior(value);
  }
  if (node.type === "import_statement") {
    const named = node.descendantsOfType("named_imports")[0];
    if (!named) return null;
    const open = named.text.indexOf("{");
    const close = named.text.lastIndexOf("}");
    if (open < 0 || close <= open) return null;
    return {
      parent: named,
      start: named.startIndex + open + 1,
      end: named.startIndex + close,
    };
  }
  const body = node.childForFieldName("body");
  if (!body) return null;
  if (
    body.type !== "statement_block" &&
    body.type !== "class_body" &&
    body.type !== "interface_body" &&
    body.type !== "enum_body"
  ) {
    return null;
  }
  if (body.endIndex - body.startIndex < 2) return null;
  return { parent: body, start: body.startIndex + 1, end: body.endIndex - 1 };
}

function collectSyntax(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  walk(root, (node) => {
    if (node.isError || node.type === "ERROR") {
      issues.push({
        line: node.startPosition.row + 1,
        message: "Syntax error",
        code: "syntax-error",
      });
    } else if (node.isMissing) {
      issues.push({
        line: node.startPosition.row + 1,
        message: "Missing syntax",
        code: "syntax-missing",
      });
    }
  });
  return issues;
}

function collectIdentifiers(root: SyntaxNode): IdentifierSpan[] {
  return root
    .descendantsOfType(["identifier", "type_identifier", "property_identifier"])
    .map((node) => ({ text: node.text, start: node.startIndex, end: node.endIndex }))
    .sort((left, right) => left.start - right.start);
}

interface Binding {
  arity: number | null;
}

const YAML_SCALARS = new Set([
  "plain_scalar",
  "string_scalar",
  "double_quote_scalar",
  "single_quote_scalar",
  "integer_scalar",
  "float_scalar",
  "boolean_scalar",
  "null_scalar",
  "block_scalar",
]);

function yamlKeyText(key: SyntaxNode): string | null {
  const scalar = deepestScalar(key) ?? key;
  if (scalar.type === "double_quote_scalar") return decodeYamlDoubleQuote(scalar.text);
  if (scalar.type === "single_quote_scalar") {
    const token = scalar.text;
    if (token.length < 2 || !token.startsWith("'") || !token.endsWith("'")) return token;
    return token.slice(1, -1).replace(/''/g, "'");
  }
  return scalar.text;
}

function deepestScalar(node: SyntaxNode): SyntaxNode | null {
  let found: SyntaxNode | null = YAML_SCALARS.has(node.type) ? node : null;
  for (const child of node.namedChildren) {
    const nested = deepestScalar(child);
    if (nested) found = nested;
  }
  return found;
}

const YAML_ESCAPES: Readonly<Record<string, string>> = {
  "0": "\0",
  a: "\u0007",
  b: "\b",
  t: "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\u001b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\u0085",
  _: "\u00a0",
  L: "\u2028",
  P: "\u2029",
};

/** Decode a YAML double-quoted scalar. Returns null when an escape is unsupported. */
function decodeYamlDoubleQuote(token: string): string | null {
  if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"')) return null;
  const body = token.slice(1, -1);
  let out = "";
  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index];
    if (ch === undefined) return null;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = body[index + 1];
    if (next === undefined) return null;
    if (next === "\n" || next === "\r") {
      index += 1;
      if (next === "\r" && body[index + 1] === "\n") index += 1;
      while (body[index + 1] === " " || body[index + 1] === "\t") index += 1;
      continue;
    }
    if (next === "x" || next === "u" || next === "U") {
      const width = next === "x" ? 2 : next === "u" ? 4 : 8;
      const hex = body.slice(index + 2, index + 2 + width);
      if (hex.length !== width || !/^[0-9a-fA-F]+$/.test(hex)) return null;
      const code = Number.parseInt(hex, 16);
      if (code > 0x10ffff) return null;
      out += String.fromCodePoint(code);
      index += 1 + width;
      continue;
    }
    const mapped = YAML_ESCAPES[next];
    if (mapped === undefined) return null;
    out += mapped;
    index += 1;
  }
  return out;
}

/** Decode a JSON string token. Returns null when the token is not a JSON string. */
function decodeJsonString(token: string): string | null {
  if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"')) return null;
  try {
    const value: unknown = JSON.parse(token);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function statementPositional(languageId: string, stable: boolean): boolean {
  if (stable) return true;
  return (
    languageId !== "python" &&
    languageId !== "go" &&
    languageId !== "java" &&
    languageId !== "kotlin" &&
    languageId !== "csharp" &&
    languageId !== "rust" &&
    languageId !== "c" &&
    languageId !== "cpp" &&
    languageId !== "php" &&
    languageId !== "ruby" &&
    languageId !== "swift" &&
    languageId !== "sql" &&
    languageId !== "toml" &&
    languageId !== "xml" &&
    languageId !== "markdown"
  );
}

function goReceiverType(receiver: SyntaxNode): string {
  const declared = receiver.namedChildren[0];
  const typeNode = declared?.childForFieldName("type");
  if (!typeNode) return "";
  if (typeNode.type === "pointer_type") {
    const name = typeNode.namedChildren[0]?.text ?? "";
    return name.length > 0 ? `*${name}` : "";
  }
  return typeNode.text;
}

/** Stable key for a Go function or method. Methods include the receiver type. */
function goDefinitionKey(node: SyntaxNode): string | null {
  if (node.type === "function_declaration") {
    const name = node.childForFieldName("name")?.text ?? "";
    return name.length > 0 ? `func:${name}` : null;
  }
  if (node.type !== "method_declaration") return null;
  const name = node.childForFieldName("name")?.text ?? "";
  const receiver = node.childForFieldName("receiver");
  const typeName = receiver ? goReceiverType(receiver) : "";
  if (name.length === 0 || typeName.length === 0) return null;
  return `method:${typeName}.${name}`;
}

const JAVA_TYPE_DECLARATIONS = new Set([
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
]);

function javaTypeKind(type: string): string {
  if (type === "interface_declaration") return "interface";
  if (type === "enum_declaration") return "enum";
  return "class";
}

/** Enclosing class, interface, and enum names, outer first. */
function javaEnclosingType(node: SyntaxNode): string {
  const parts: string[] = [];
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (JAVA_TYPE_DECLARATIONS.has(current.type)) {
      const name = current.childForFieldName("name")?.text ?? "";
      if (name.length > 0) parts.unshift(name);
    }
    current = current.parent;
  }
  return parts.join(".");
}

/** Stable key for a Java type, method, or constructor. Nested types keep their parent. */
function javaDefinitionKey(node: SyntaxNode): string | null {
  const name = node.childForFieldName("name")?.text ?? "";
  if (name.length === 0) return null;
  if (JAVA_TYPE_DECLARATIONS.has(node.type)) {
    const parent = javaEnclosingType(node);
    const label = parent.length > 0 ? `${parent}.${name}` : name;
    return `${javaTypeKind(node.type)}:${label}`;
  }
  if (node.type !== "method_declaration" && node.type !== "constructor_declaration") return null;
  const owner = javaEnclosingType(node);
  if (owner.length === 0) return null;
  const kind = node.type === "constructor_declaration" ? "constructor" : "method";
  return `${kind}:${owner}.${name}`;
}

const KOTLIN_TYPE_DECLARATIONS = new Set(["class_declaration", "object_declaration"]);

function kotlinKeyword(node: SyntaxNode): string {
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (!child) continue;
    if (child.type === "class" || child.type === "interface") return child.type;
  }
  return "class";
}

/** Enclosing class and object names, outer first. An interface is a class declaration. */
function kotlinEnclosingType(node: SyntaxNode): string {
  const parts: string[] = [];
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (KOTLIN_TYPE_DECLARATIONS.has(current.type)) {
      const name = current.childForFieldName("name")?.text ?? "";
      if (name.length > 0) parts.unshift(name);
    }
    current = current.parent;
  }
  return parts.join(".");
}

function kotlinTypeBody(
  node: SyntaxNode,
): { parent: SyntaxNode; start: number; end: number } | null {
  if (!KOTLIN_TYPE_DECLARATIONS.has(node.type)) return null;
  const body = node.namedChildren.find((child) => child.type === "class_body");
  if (!body || body.endIndex - body.startIndex < 2) return null;
  return { parent: body, start: body.startIndex + 1, end: body.endIndex - 1 };
}

/** Stable key for a Kotlin type or function. Nested types keep their parent. */
function kotlinDefinitionKey(node: SyntaxNode): string | null {
  const name = node.childForFieldName("name")?.text ?? "";
  if (name.length === 0) return null;
  if (KOTLIN_TYPE_DECLARATIONS.has(node.type)) {
    const parent = kotlinEnclosingType(node);
    const label = parent.length > 0 ? `${parent}.${name}` : name;
    const kind =
      node.type === "object_declaration"
        ? "object"
        : kotlinKeyword(node) === "interface"
          ? "interface"
          : "class";
    return `${kind}:${label}`;
  }
  if (node.type !== "function_declaration") return null;
  const owner = kotlinEnclosingType(node);
  return owner.length > 0 ? `fun:${owner}.${name}` : `fun:${name}`;
}

const CSHARP_TYPE_DECLARATIONS = new Set([
  "class_declaration",
  "interface_declaration",
  "struct_declaration",
  "enum_declaration",
]);

function csharpKind(type: string): string {
  if (type === "interface_declaration") return "interface";
  if (type === "struct_declaration") return "struct";
  if (type === "enum_declaration") return "enum";
  return "class";
}

/** Enclosing namespace and type names, outer first. */
function csharpEnclosingName(node: SyntaxNode): string {
  const parts: string[] = [];
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (CSHARP_TYPE_DECLARATIONS.has(current.type) || current.type === "namespace_declaration") {
      const name = current.childForFieldName("name")?.text ?? "";
      if (name.length > 0) parts.unshift(name);
    }
    current = current.parent;
  }
  return parts.join(".");
}

function csharpTypeBody(
  node: SyntaxNode,
): { parent: SyntaxNode; start: number; end: number } | null {
  if (!CSHARP_TYPE_DECLARATIONS.has(node.type) && node.type !== "namespace_declaration")
    return null;
  if (node.type === "enum_declaration") return null;
  const body = node.childForFieldName("body");
  if (!body || body.type !== "declaration_list" || body.endIndex - body.startIndex < 2) return null;
  return { parent: body, start: body.startIndex + 1, end: body.endIndex - 1 };
}

/** Stable key for a C# type, namespace, method, or constructor. Nested names keep their parent. */
function csharpDefinitionKey(node: SyntaxNode): string | null {
  const name = node.childForFieldName("name")?.text ?? "";
  if (name.length === 0) return null;
  const owner = csharpEnclosingName(node);
  const label = owner.length > 0 ? `${owner}.${name}` : name;
  if (node.type === "namespace_declaration" || node.type === "file_scoped_namespace_declaration") {
    return `namespace:${label}`;
  }
  if (CSHARP_TYPE_DECLARATIONS.has(node.type)) return `${csharpKind(node.type)}:${label}`;
  if (node.type !== "method_declaration" && node.type !== "constructor_declaration") return null;
  if (owner.length === 0) return null;
  const kind = node.type === "constructor_declaration" ? "constructor" : "method";
  return `${kind}:${label}`;
}

function pythonDefinition(node: SyntaxNode): SyntaxNode | null {
  if (node.type === "function_definition" || node.type === "class_definition") return node;
  if (node.type !== "decorated_definition") return null;
  return (
    node.namedChildren.find(
      (child) => child.type === "function_definition" || child.type === "class_definition",
    ) ?? null
  );
}

function collectPythonSymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const visit = (node: SyntaxNode, scope: Set<string>): void => {
    const defined = pythonDefinition(node);
    if (defined) {
      const name = defined.childForFieldName("name");
      const text = name?.text ?? "";
      if (text.length > 0 && scope.has(text)) {
        issues.push({
          line: defined.startPosition.row + 1,
          message: `Duplicate declaration ${text}`,
          code: "duplicate",
        });
      }
      if (text.length > 0) scope.add(text);
      const body = defined.childForFieldName("body");
      if (body) visit(body, new Set());
      return;
    }
    for (const child of node.namedChildren) visit(child, scope);
  };
  visit(root, new Set());
  return issues;
}

function collectGoSymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  const visit = (node: SyntaxNode): void => {
    const key = goDefinitionKey(node);
    if (key !== null) {
      if (seen.has(key)) {
        const label = key.slice(key.indexOf(":") + 1);
        issues.push({
          line: node.startPosition.row + 1,
          message: `Duplicate declaration ${label}`,
          code: "duplicate",
        });
      }
      seen.add(key);
      return;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return issues;
}

function collectJavaSymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  const visit = (node: SyntaxNode): void => {
    const key = javaDefinitionKey(node);
    if (key !== null) {
      if (seen.has(key)) {
        const label = key.slice(key.indexOf(":") + 1);
        issues.push({
          line: node.startPosition.row + 1,
          message: `Duplicate declaration ${label}`,
          code: "duplicate",
        });
      }
      seen.add(key);
      if (node.type === "method_declaration" || node.type === "constructor_declaration") return;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return issues;
}

function collectKotlinSymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  const visit = (node: SyntaxNode): void => {
    const key = kotlinDefinitionKey(node);
    if (key !== null) {
      if (seen.has(key)) {
        const label = key.slice(key.indexOf(":") + 1);
        issues.push({
          line: node.startPosition.row + 1,
          message: `Duplicate declaration ${label}`,
          code: "duplicate",
        });
      }
      seen.add(key);
      if (node.type === "function_declaration") return;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return issues;
}

function collectCsharpSymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  const visit = (node: SyntaxNode): void => {
    const key = csharpDefinitionKey(node);
    if (key !== null) {
      if (seen.has(key)) {
        const label = key.slice(key.indexOf(":") + 1);
        issues.push({
          line: node.startPosition.row + 1,
          message: `Duplicate declaration ${label}`,
          code: "duplicate",
        });
      }
      seen.add(key);
      if (node.type === "method_declaration" || node.type === "constructor_declaration") return;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return issues;
}

const RUST_OPEN_DECLARATION = new Set(["impl_item", "trait_item", "mod_item", "foreign_mod_item"]);

function rustKind(type: string): string | null {
  switch (type) {
    case "function_item":
    case "function_signature_item":
      return "fn";
    case "struct_item":
      return "struct";
    case "union_item":
      return "union";
    case "enum_item":
      return "enum";
    case "enum_variant":
      return "variant";
    case "trait_item":
      return "trait";
    case "mod_item":
      return "mod";
    case "const_item":
      return "const";
    case "static_item":
      return "static";
    case "type_item":
      return "type";
    case "associated_type":
      return "assoc";
    case "macro_definition":
      return "macro";
    default:
      return null;
  }
}

/** Type label for an impl, including the trait when this impl is for a trait. */
function rustImplLabel(node: SyntaxNode): string {
  const typeName = node.childForFieldName("type")?.text ?? "";
  if (typeName.length === 0) return "";
  const traitName = node.childForFieldName("trait")?.text ?? "";
  return traitName.length > 0 ? `${traitName}.for.${typeName}` : typeName;
}

/** Enclosing module, trait, impl, enum, and extern names, outer first. */
function rustEnclosingName(node: SyntaxNode): string {
  const parts: string[] = [];
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (
      current.type === "mod_item" ||
      current.type === "trait_item" ||
      current.type === "enum_item"
    ) {
      const name = current.childForFieldName("name")?.text ?? "";
      if (name.length > 0) parts.unshift(name);
    } else if (current.type === "impl_item") {
      const label = rustImplLabel(current);
      if (label.length > 0) parts.unshift(label);
    } else if (current.type === "foreign_mod_item") {
      parts.unshift("extern");
    }
    current = current.parent;
  }
  return parts.join(".");
}

function rustQualified(node: SyntaxNode, name: string): string {
  const owner = rustEnclosingName(node);
  return owner.length > 0 ? `${owner}.${name}` : name;
}

function rustItemBody(node: SyntaxNode): { parent: SyntaxNode; start: number; end: number } | null {
  const opened = RUST_OPEN_DECLARATION.has(node.type)
    ? "declaration_list"
    : node.type === "enum_item"
      ? "enum_variant_list"
      : null;
  if (opened === null) return null;
  const body = node.childForFieldName("body");
  if (!body || body.type !== opened || body.endIndex - body.startIndex < 2) return null;
  return { parent: body, start: body.startIndex + 1, end: body.endIndex - 1 };
}

/** Stable key for a Rust item. Fields, lets, and statements stay unnamed. */
function rustDefinitionKey(node: SyntaxNode): string | null {
  if (node.type === "impl_item") {
    const own = rustImplLabel(node);
    if (own.length === 0) return null;
    return `impl:${rustQualified(node, own)}`;
  }
  if (node.type === "foreign_mod_item") {
    const owner = rustEnclosingName(node);
    return owner.length > 0 ? `mod:${owner}.extern` : "mod:extern";
  }
  const kind = rustKind(node.type);
  if (kind === null) return null;
  const name = node.childForFieldName("name")?.text ?? "";
  if (name.length === 0) return null;
  return `${kind}:${rustQualified(node, name)}`;
}

function collectRustSymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  const visit = (node: SyntaxNode): void => {
    const key = rustDefinitionKey(node);
    if (key !== null) {
      const repeated = node.type !== "impl_item" && node.type !== "foreign_mod_item";
      if (repeated && seen.has(key)) {
        const label = key.slice(key.indexOf(":") + 1);
        issues.push({
          line: node.startPosition.row + 1,
          message: `Duplicate declaration ${label}`,
          code: "duplicate",
        });
      }
      if (repeated) seen.add(key);
      if (node.type === "function_item" || node.type === "function_signature_item") return;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return issues;
}

/** Name carried by a declarator, unwrapping pointers and parentheses. */
function cNamedDeclarator(node: SyntaxNode | null): string {
  let current = node;
  while (current) {
    if (current.type === "identifier" || current.type === "type_identifier") return current.text;
    if (
      current.type === "pointer_declarator" ||
      current.type === "init_declarator" ||
      current.type === "array_declarator" ||
      current.type === "parenthesized_declarator"
    ) {
      current = current.childForFieldName("declarator") ?? current.namedChildren[0] ?? null;
      continue;
    }
    return "";
  }
  return "";
}

/**
 * Function name when the declarator is a function, not a function-pointer variable.
 * A parenthesized declarator under the function declarator is a pointer variable.
 */
function cFunctionName(declarator: SyntaxNode | null): string | null {
  let current = declarator;
  while (current) {
    if (
      current.type === "pointer_declarator" ||
      current.type === "init_declarator" ||
      current.type === "array_declarator"
    ) {
      current = current.childForFieldName("declarator");
      continue;
    }
    if (current.type !== "function_declarator") return null;
    const inner = current.childForFieldName("declarator");
    if (!inner || inner.type === "parenthesized_declarator") return null;
    const name = cNamedDeclarator(inner);
    return name.length > 0 ? name : null;
  }
  return null;
}

function cEnclosingEnum(node: SyntaxNode): string {
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (current.type === "enum_specifier") return current.childForFieldName("name")?.text ?? "";
    current = current.parent;
  }
  return "";
}

function cItemBody(node: SyntaxNode): { parent: SyntaxNode; start: number; end: number } | null {
  if (node.type !== "enum_specifier") return null;
  const name = node.childForFieldName("name")?.text ?? "";
  if (name.length === 0) return null;
  const body = node.childForFieldName("body");
  if (!body || body.type !== "enumerator_list" || body.endIndex - body.startIndex < 2) return null;
  return { parent: body, start: body.startIndex + 1, end: body.endIndex - 1 };
}

/** Stable key for a C function, type, enumerator, or macro. Statements stay unnamed. */
function cDefinitionKey(node: SyntaxNode): string | null {
  if (node.type === "function_definition") {
    const name = cFunctionName(node.childForFieldName("declarator"));
    return name === null ? null : `fn:${name}`;
  }
  if (node.type === "declaration") {
    const name = cFunctionName(node.childForFieldName("declarator"));
    return name === null ? null : `proto:${name}`;
  }
  if (
    node.type === "struct_specifier" ||
    node.type === "union_specifier" ||
    node.type === "enum_specifier"
  ) {
    const name = node.childForFieldName("name")?.text ?? "";
    if (name.length === 0) return null;
    const kind =
      node.type === "struct_specifier"
        ? "struct"
        : node.type === "union_specifier"
          ? "union"
          : "enum";
    return `${kind}:${name}`;
  }
  if (node.type === "enumerator") {
    const name = node.childForFieldName("name")?.text ?? "";
    if (name.length === 0) return null;
    const owner = cEnclosingEnum(node);
    return owner.length > 0 ? `enumerator:${owner}.${name}` : `enumerator:${name}`;
  }
  if (node.type === "type_definition") {
    const name = cNamedDeclarator(node.childForFieldName("declarator"));
    return name.length > 0 ? `type:${name}` : null;
  }
  if (node.type === "preproc_def" || node.type === "preproc_function_def") {
    const name = node.childForFieldName("name")?.text ?? "";
    return name.length > 0 ? `macro:${name}` : null;
  }
  return null;
}

function collectCSymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  const visit = (node: SyntaxNode): void => {
    const key = cDefinitionKey(node);
    if (key !== null) {
      const repeatedFunction = key.startsWith("fn:");
      if (repeatedFunction && seen.has(key)) {
        const label = key.slice(key.indexOf(":") + 1);
        issues.push({
          line: node.startPosition.row + 1,
          message: `Duplicate declaration ${label}`,
          code: "duplicate",
        });
      }
      if (repeatedFunction) seen.add(key);
      if (node.type === "function_definition" || node.type === "declaration") return;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return issues;
}

/** Item wrapped by a template. The template itself has no name. */
function cppInnerItem(node: SyntaxNode): SyntaxNode | null {
  if (node.type !== "template_declaration") return null;
  return (
    node.namedChildren.find(
      (child) =>
        child.type === "class_specifier" ||
        child.type === "struct_specifier" ||
        child.type === "function_definition" ||
        child.type === "alias_declaration",
    ) ?? null
  );
}

/** Function name when the declarator is a function, not a function-pointer variable. */
function cppFunctionName(declarator: SyntaxNode | null): string | null {
  let current = declarator;
  while (current) {
    if (
      current.type === "pointer_declarator" ||
      current.type === "reference_declarator" ||
      current.type === "init_declarator" ||
      current.type === "array_declarator"
    ) {
      current = current.childForFieldName("declarator");
      continue;
    }
    if (current.type !== "function_declarator") return null;
    const inner = current.childForFieldName("declarator");
    if (!inner || inner.type === "parenthesized_declarator") return null;
    if (
      inner.type === "identifier" ||
      inner.type === "field_identifier" ||
      inner.type === "destructor_name" ||
      inner.type === "operator_name"
    ) {
      return inner.text;
    }
    return null;
  }
  return null;
}

function cppFunctionDeclarator(declarator: SyntaxNode | null): SyntaxNode | null {
  let current = declarator;
  while (current) {
    if (current.type === "function_declarator") return current;
    if (
      current.type === "pointer_declarator" ||
      current.type === "reference_declarator" ||
      current.type === "init_declarator" ||
      current.type === "array_declarator"
    ) {
      current = current.childForFieldName("declarator");
      continue;
    }
    return null;
  }
  return null;
}

/** Parameter name token, so the signature can keep the type and drop the name. */
function cppParameterName(declarator: SyntaxNode | null): SyntaxNode | null {
  let current = declarator;
  while (current) {
    if (current.type === "identifier" || current.type === "field_identifier") return current;
    const next = current.childForFieldName("declarator") ?? current.namedChildren[0] ?? null;
    if (!next || next === current) return null;
    current = next;
  }
  return null;
}

/**
 * Parameter type spelling with the name removed.
 * The type field alone drops const and references, so `int` and `const int&` would collide.
 */
function cppParameterType(parameter: SyntaxNode): string {
  const name = cppParameterName(parameter.childForFieldName("declarator"));
  if (!name) return parameter.text.replace(/\s+/g, "");
  const start = name.startIndex - parameter.startIndex;
  const end = name.endIndex - parameter.startIndex;
  if (start < 0 || end > parameter.text.length) return parameter.text.replace(/\s+/g, "");
  return (parameter.text.slice(0, start) + parameter.text.slice(end)).replace(/\s+/g, "");
}

function cppSignature(declarator: SyntaxNode | null): string {
  const list = cppFunctionDeclarator(declarator)?.childForFieldName("parameters");
  if (!list) return "()";
  const types: string[] = [];
  for (const child of list.namedChildren) {
    if (child.type !== "parameter_declaration") continue;
    types.push(cppParameterType(child));
  }
  return `(${types.join(",")})`;
}

function cppEnclosingName(node: SyntaxNode): string {
  const parts: string[] = [];
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (
      current.type === "namespace_definition" ||
      current.type === "class_specifier" ||
      current.type === "struct_specifier" ||
      current.type === "enum_specifier"
    ) {
      const name = current.childForFieldName("name")?.text ?? "";
      if (name.length > 0) parts.unshift(name);
    }
    current = current.parent;
  }
  return parts.join(".");
}

function cppQualified(node: SyntaxNode, name: string): string {
  const owner = cppEnclosingName(node);
  return owner.length > 0 ? `${owner}.${name}` : name;
}

function cppInnermostType(node: SyntaxNode): string {
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (current.type === "class_specifier" || current.type === "struct_specifier") {
      return current.childForFieldName("name")?.text ?? "";
    }
    current = current.parent;
  }
  return "";
}

function cppFunctionKey(node: SyntaxNode, prototype: boolean): string | null {
  const declarator = node.childForFieldName("declarator");
  const name = cppFunctionName(declarator);
  if (name === null) return null;
  const signature = cppSignature(declarator);
  const qualified = cppQualified(node, name);
  if (prototype) return `proto:${qualified}${signature}`;
  if (name.startsWith("~")) return `destructor:${qualified}${signature}`;
  const owner = cppInnermostType(node);
  if (owner.length > 0 && name === owner) return `constructor:${qualified}${signature}`;
  return `fn:${qualified}${signature}`;
}

function cppOpenedBody(
  node: SyntaxNode,
  bodyType: string,
): { parent: SyntaxNode; start: number; end: number } | null {
  const name = node.childForFieldName("name")?.text ?? "";
  if (name.length === 0) return null;
  const body = node.childForFieldName("body");
  if (!body || body.type !== bodyType || body.endIndex - body.startIndex < 2) return null;
  return { parent: body, start: body.startIndex + 1, end: body.endIndex - 1 };
}

function cppItemBody(node: SyntaxNode): { parent: SyntaxNode; start: number; end: number } | null {
  const target = node.type === "template_declaration" ? cppInnerItem(node) : node;
  if (!target) return null;
  if (target.type === "class_specifier" || target.type === "struct_specifier") {
    return cppOpenedBody(target, "field_declaration_list");
  }
  if (target.type === "namespace_definition") return cppOpenedBody(target, "declaration_list");
  if (target.type === "enum_specifier") return cppOpenedBody(target, "enumerator_list");
  return null;
}

/** Stable key for a C++ type, function, enumerator, or macro. Fields and statements stay unnamed. */
function cppDefinitionKey(node: SyntaxNode): string | null {
  if (node.type === "template_declaration") {
    const inner = cppInnerItem(node);
    return inner ? cppDefinitionKey(inner) : null;
  }
  if (node.type === "function_definition") return cppFunctionKey(node, false);
  if (node.type === "declaration" || node.type === "field_declaration") {
    return cppFunctionKey(node, true);
  }
  if (node.type === "class_specifier" || node.type === "struct_specifier") {
    const name = node.childForFieldName("name")?.text ?? "";
    if (name.length === 0) return null;
    const kind = node.type === "class_specifier" ? "class" : "struct";
    return `${kind}:${cppQualified(node, name)}`;
  }
  if (node.type === "namespace_definition") {
    const name = node.childForFieldName("name")?.text ?? "";
    return name.length > 0 ? `namespace:${cppQualified(node, name)}` : null;
  }
  if (node.type === "enum_specifier") {
    const name = node.childForFieldName("name")?.text ?? "";
    return name.length > 0 ? `enum:${cppQualified(node, name)}` : null;
  }
  if (node.type === "enumerator") {
    const name = node.childForFieldName("name")?.text ?? "";
    return name.length > 0 ? `enumerator:${cppQualified(node, name)}` : null;
  }
  if (node.type === "alias_declaration") {
    const name = node.childForFieldName("name")?.text ?? "";
    return name.length > 0 ? `alias:${cppQualified(node, name)}` : null;
  }
  if (node.type === "preproc_def" || node.type === "preproc_function_def") {
    const name = node.childForFieldName("name")?.text ?? "";
    return name.length > 0 ? `macro:${name}` : null;
  }
  return null;
}

function collectCppSymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  const visit = (node: SyntaxNode): void => {
    const key = cppDefinitionKey(node);
    if (key !== null) {
      const repeatedDefinition =
        key.startsWith("fn:") || key.startsWith("constructor:") || key.startsWith("destructor:");
      if (repeatedDefinition && seen.has(key)) {
        const label = key.slice(key.indexOf(":") + 1);
        issues.push({
          line: node.startPosition.row + 1,
          message: `Duplicate declaration ${label}`,
          code: "duplicate",
        });
      }
      if (repeatedDefinition) seen.add(key);
      if (node.type === "function_definition" || node.type === "declaration") return;
      if (node.type === "template_declaration") {
        const inner = cppInnerItem(node);
        const body =
          inner &&
          (inner.type === "class_specifier" ||
            inner.type === "struct_specifier" ||
            inner.type === "enum_specifier")
            ? inner.childForFieldName("body")
            : null;
        if (body) {
          for (const child of body.namedChildren) visit(child);
        }
        return;
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return issues;
}

function phpDotted(text: string): string {
  return text.replaceAll("\\", ".");
}

function phpNamespaceText(node: SyntaxNode): string {
  const name = node.childForFieldName("name");
  return name ? phpDotted(name.text) : "";
}

function phpSimpleName(node: SyntaxNode): string {
  const named = node.childForFieldName("name");
  if (named && named.text.length > 0 && named.type === "name") return named.text;
  const child = node.namedChildren.find((item) => item.type === "name");
  return child?.text ?? "";
}

function phpTypeKind(type: string): "class" | "interface" | "trait" | "enum" | null {
  if (type === "class_declaration") return "class";
  if (type === "interface_declaration") return "interface";
  if (type === "trait_declaration") return "trait";
  if (type === "enum_declaration") return "enum";
  return null;
}

/** Nearest previous `namespace Name;` that does not wrap its body. */
function phpStatementNamespace(node: SyntaxNode): string {
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (current.type === "namespace_definition" && current.childForFieldName("body") !== null) {
      return "";
    }
    current = current.parent;
  }
  let found = "";
  let cursor: SyntaxNode = node;
  for (;;) {
    const parent: SyntaxNode | null = cursor.parent;
    if (!parent) break;
    for (const sibling of parent.namedChildren) {
      if (sibling.startIndex >= cursor.startIndex) break;
      if (sibling.type !== "namespace_definition" || sibling.childForFieldName("body") !== null) {
        continue;
      }
      const name = phpNamespaceText(sibling);
      if (name.length > 0) found = name;
    }
    if (parent.type === "program") break;
    cursor = parent;
  }
  return found;
}

function phpQualified(node: SyntaxNode, name: string): string {
  const parts: string[] = [];
  const statement = phpStatementNamespace(node);
  if (statement.length > 0) parts.push(statement);
  const owners: string[] = [];
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (current.type === "namespace_definition") {
      const text = phpNamespaceText(current);
      if (text.length > 0) owners.unshift(text);
    } else if (phpTypeKind(current.type) !== null) {
      const text = phpSimpleName(current);
      if (text.length > 0) owners.unshift(text);
    }
    current = current.parent;
  }
  parts.push(...owners, name);
  return parts.join(".");
}

function phpConstName(node: SyntaxNode): string | null {
  const elements = node.namedChildren.filter((child) => child.type === "const_element");
  if (elements.length !== 1) return null;
  const element = elements[0];
  if (!element) return null;
  const name = element.namedChildren.find((child) => child.type === "name")?.text ?? "";
  return name.length > 0 ? name : null;
}

function phpOpenedBody(
  node: SyntaxNode,
  bodyType: string,
): { parent: SyntaxNode; start: number; end: number } | null {
  const body = node.childForFieldName("body");
  if (!body || body.type !== bodyType || body.endIndex - body.startIndex < 2) return null;
  return { parent: body, start: body.startIndex + 1, end: body.endIndex - 1 };
}

function phpItemBody(node: SyntaxNode): { parent: SyntaxNode; start: number; end: number } | null {
  if (phpTypeKind(node.type) !== null) {
    if (phpSimpleName(node).length === 0) return null;
    const bodyType =
      node.type === "enum_declaration" ? "enum_declaration_list" : "declaration_list";
    return phpOpenedBody(node, bodyType);
  }
  if (node.type === "namespace_definition") {
    if (phpNamespaceText(node).length === 0) return null;
    return phpOpenedBody(node, "compound_statement");
  }
  return null;
}

/** Stable key for a PHP function, type, case, or constant. Properties and statements stay unnamed. */
function phpDefinitionKey(node: SyntaxNode): string | null {
  if (node.type === "function_definition") {
    const name = phpSimpleName(node);
    return name.length > 0 ? `fn:${phpQualified(node, name)}` : null;
  }
  if (node.type === "method_declaration") {
    const name = phpSimpleName(node);
    return name.length > 0 ? `method:${phpQualified(node, name)}` : null;
  }
  const typeKind = phpTypeKind(node.type);
  if (typeKind !== null) {
    const name = phpSimpleName(node);
    return name.length > 0 ? `${typeKind}:${phpQualified(node, name)}` : null;
  }
  if (node.type === "namespace_definition") {
    const name = phpNamespaceText(node);
    if (name.length === 0) return null;
    const owners: string[] = [];
    let current: SyntaxNode | null = node.parent;
    while (current) {
      if (current.type === "namespace_definition") {
        const text = phpNamespaceText(current);
        if (text.length > 0) owners.unshift(text);
      }
      current = current.parent;
    }
    return `namespace:${[...owners, name].join(".")}`;
  }
  if (node.type === "enum_case") {
    const name = phpSimpleName(node);
    return name.length > 0 ? `case:${phpQualified(node, name)}` : null;
  }
  if (node.type === "const_declaration") {
    const name = phpConstName(node);
    return name === null ? null : `const:${phpQualified(node, name)}`;
  }
  return null;
}

function collectPhpSymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  const visit = (node: SyntaxNode): void => {
    const key = phpDefinitionKey(node);
    if (key !== null) {
      const repeated = key.startsWith("fn:") || key.startsWith("method:");
      if (repeated && seen.has(key)) {
        const label = key.slice(key.indexOf(":") + 1);
        issues.push({
          line: node.startPosition.row + 1,
          message: `Duplicate declaration ${label}`,
          code: "duplicate",
        });
      }
      if (repeated) seen.add(key);
      if (node.type === "function_definition" || node.type === "method_declaration") return;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return issues;
}

function rubyFieldName(node: SyntaxNode): string {
  const named = node.childForFieldName("name");
  return named && named.text.length > 0 ? named.text : "";
}

/** Enclosing class and module names, outer first. */
function rubyOwners(node: SyntaxNode): string[] {
  const owners: string[] = [];
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (current.type === "class" || current.type === "module") {
      const text = rubyFieldName(current);
      if (text.length > 0) owners.unshift(text);
    }
    current = current.parent;
  }
  return owners;
}

function rubyQualified(node: SyntaxNode, name: string): string {
  return [...rubyOwners(node), name].join(".");
}

function rubyItemBody(node: SyntaxNode): { parent: SyntaxNode; start: number; end: number } | null {
  if (node.type !== "class" && node.type !== "module") return null;
  if (rubyFieldName(node).length === 0) return null;
  const body = node.childForFieldName("body");
  if (!body || body.type !== "body_statement" || body.endIndex <= body.startIndex) return null;
  return { parent: body, start: body.startIndex, end: body.endIndex };
}

/** Stable key for a Ruby method, class, module, or singleton method. Statements stay unnamed. */
function rubyDefinitionKey(node: SyntaxNode): string | null {
  if (node.type === "method") {
    const name = rubyFieldName(node);
    return name.length > 0 ? `method:${rubyQualified(node, name)}` : null;
  }
  if (node.type === "class") {
    const name = rubyFieldName(node);
    return name.length > 0 ? `class:${rubyQualified(node, name)}` : null;
  }
  if (node.type === "module") {
    const name = rubyFieldName(node);
    return name.length > 0 ? `module:${rubyQualified(node, name)}` : null;
  }
  if (node.type === "singleton_method") {
    const name = rubyFieldName(node);
    if (name.length === 0) return null;
    const parts = rubyOwners(node);
    const object = node.childForFieldName("object");
    if (object?.type === "identifier" && object.text.length > 0) parts.push(object.text);
    parts.push(name);
    return `singleton:${parts.join(".")}`;
  }
  return null;
}

function collectRubySymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  const visit = (node: SyntaxNode): void => {
    const key = rubyDefinitionKey(node);
    if (key !== null) {
      const repeated = key.startsWith("method:") || key.startsWith("singleton:");
      if (repeated && seen.has(key)) {
        const label = key.slice(key.indexOf(":") + 1);
        issues.push({
          line: node.startPosition.row + 1,
          message: `Duplicate declaration ${label}`,
          code: "duplicate",
        });
      }
      if (repeated) seen.add(key);
      if (node.type === "method" || node.type === "singleton_method") return;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return issues;
}

function swiftFieldText(node: SyntaxNode, type: string): string {
  const named = node.childForFieldName("name");
  return named?.type === type && named.text.length > 0 ? named.text : "";
}

function swiftKind(node: SyntaxNode): string {
  return node.childForFieldName("declaration_kind")?.text ?? "";
}

/** Enclosing class, struct, enum, and protocol names, outer first. */
function swiftOwners(node: SyntaxNode): string[] {
  const owners: string[] = [];
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (current.type === "class_declaration") {
      const kind = swiftKind(current);
      if (kind === "class" || kind === "struct" || kind === "enum") {
        const text = swiftFieldText(current, "type_identifier");
        if (text.length > 0) owners.unshift(text);
      }
    } else if (current.type === "protocol_declaration") {
      const text = swiftFieldText(current, "type_identifier");
      if (text.length > 0) owners.unshift(text);
    }
    current = current.parent;
  }
  return owners;
}

function swiftQualified(node: SyntaxNode, name: string): string {
  return [...swiftOwners(node), name].join(".");
}

function swiftOpenedBody(
  node: SyntaxNode,
  bodyType: string,
): { parent: SyntaxNode; start: number; end: number } | null {
  const body = node.childForFieldName("body");
  if (!body || body.type !== bodyType || body.endIndex - body.startIndex < 2) return null;
  return { parent: body, start: body.startIndex + 1, end: body.endIndex - 1 };
}

function swiftItemBody(
  node: SyntaxNode,
): { parent: SyntaxNode; start: number; end: number } | null {
  if (node.type === "class_declaration") {
    if (swiftFieldText(node, "type_identifier").length === 0) return null;
    const kind = swiftKind(node);
    if (kind === "class" || kind === "struct") return swiftOpenedBody(node, "class_body");
    if (kind === "enum") return swiftOpenedBody(node, "enum_class_body");
    return null;
  }
  if (node.type === "protocol_declaration") {
    if (swiftFieldText(node, "type_identifier").length === 0) return null;
    return swiftOpenedBody(node, "protocol_body");
  }
  return null;
}

/** Stable key for a Swift function, type, or enum case. Initializers and statements stay unnamed. */
function swiftDefinitionKey(node: SyntaxNode): string | null {
  if (node.type === "function_declaration" || node.type === "protocol_function_declaration") {
    const name = swiftFieldText(node, "simple_identifier");
    return name.length > 0 ? `function:${swiftQualified(node, name)}` : null;
  }
  if (node.type === "class_declaration") {
    const kind = swiftKind(node);
    if (kind !== "class" && kind !== "struct" && kind !== "enum") return null;
    const name = swiftFieldText(node, "type_identifier");
    return name.length > 0 ? `${kind}:${swiftQualified(node, name)}` : null;
  }
  if (node.type === "protocol_declaration") {
    const name = swiftFieldText(node, "type_identifier");
    return name.length > 0 ? `protocol:${swiftQualified(node, name)}` : null;
  }
  if (node.type === "enum_entry") {
    const name = swiftFieldText(node, "simple_identifier");
    return name.length > 0 ? `case:${swiftQualified(node, name)}` : null;
  }
  return null;
}

function collectSwiftSymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  const visit = (node: SyntaxNode): void => {
    const key = swiftDefinitionKey(node);
    if (key !== null) {
      const repeated = key.startsWith("function:");
      if (repeated && seen.has(key)) {
        const label = key.slice(key.indexOf(":") + 1);
        issues.push({
          line: node.startPosition.row + 1,
          message: `Duplicate declaration ${label}`,
          code: "duplicate",
        });
      }
      if (repeated) seen.add(key);
      if (node.type === "function_declaration" || node.type === "protocol_function_declaration") {
        return;
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return issues;
}

const SQL_CREATE_PREFIX: Readonly<Record<string, string>> = {
  create_table: "table",
  create_view: "view",
  create_materialized_view: "materialized_view",
  create_function: "function",
};

function sqlObjectText(node: SyntaxNode): string {
  const reference = node.namedChildren.find((child) => child.type === "object_reference");
  return reference && reference.text.length > 0 ? reference.text : "";
}

function sqlCreateKey(node: SyntaxNode): string | null {
  const prefix = SQL_CREATE_PREFIX[node.type];
  if (!prefix) return null;
  const text = sqlObjectText(node);
  return text.length > 0 ? `${prefix}:${text}` : null;
}

/** Stable key for a SQL table, view, function, or column. Inserts and constraints stay unnamed. */
function sqlDefinitionKey(node: SyntaxNode): string | null {
  if (node.type === "statement") {
    const named = node.namedChildren;
    if (named.length !== 1) return null;
    const inner = named[0];
    return inner ? sqlCreateKey(inner) : null;
  }
  const created = sqlCreateKey(node);
  if (created !== null) return created;
  if (node.type === "column_definition") {
    const name = node.childForFieldName("name");
    if (
      !name ||
      (name.type !== "identifier" && name.type !== "literal") ||
      name.text.length === 0
    ) {
      return null;
    }
    return `column:${name.text}`;
  }
  return null;
}

function sqlColumnBody(
  node: SyntaxNode,
): { parent: SyntaxNode; start: number; end: number } | null {
  const columns = node.namedChildren.find((child) => child.type === "column_definitions");
  if (!columns || columns.endIndex - columns.startIndex < 2) return null;
  return { parent: columns, start: columns.startIndex + 1, end: columns.endIndex - 1 };
}

function sqlItemBody(node: SyntaxNode): { parent: SyntaxNode; start: number; end: number } | null {
  if (node.type === "create_table") return sqlColumnBody(node);
  if (node.type !== "statement") return null;
  const inner = node.namedChildren.find((child) => child.type === "create_table");
  return inner ? sqlColumnBody(inner) : null;
}

function collectSqlSymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  const visit = (node: SyntaxNode): void => {
    if (node.type === "statement" || node.type === "function_body") {
      if (node.type === "function_body") return;
      for (const child of node.namedChildren) visit(child);
      return;
    }
    const key = sqlDefinitionKey(node);
    if (key !== null) {
      const repeated = key.startsWith("table:") || key.startsWith("function:");
      if (repeated && seen.has(key)) {
        const label = key.slice(key.indexOf(":") + 1);
        issues.push({
          line: node.startPosition.row + 1,
          message: `Duplicate declaration ${label}`,
          code: "duplicate",
        });
      }
      if (repeated) seen.add(key);
      if (node.type === "create_function") return;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return issues;
}

function tomlFlow(languageId: string, node: SyntaxNode): boolean {
  if (node.type === "flow_pair") return true;
  if (node.type !== "pair") return false;
  if (languageId !== "toml") return true;
  return node.parent?.type === "inline_table";
}

const TOML_SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\",
};

function tomlBasicString(inner: string): string | null {
  let output = "";
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner.charAt(index);
    if (character !== "\\") {
      output += character;
      continue;
    }
    const next = inner.charAt(index + 1);
    if (next.length === 0) return null;
    const simple = TOML_SIMPLE_ESCAPES[next];
    if (simple !== undefined) {
      output += simple;
      index += 1;
      continue;
    }
    if (next !== "u" && next !== "U") return null;
    const width = next === "u" ? 4 : 8;
    const hex = inner.slice(index + 2, index + 2 + width);
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== width) return null;
    const code = Number.parseInt(hex, 16);
    // A value outside the Unicode scalar range does not decode, so the pair stays unstable.
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return null;
    output += String.fromCodePoint(code);
    index += 1 + width;
  }
  return output;
}

function tomlQuotedText(text: string): string | null {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return tomlBasicString(text.slice(1, -1));
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
  return null;
}

function tomlSegments(node: SyntaxNode): string[] | null {
  if (node.type === "bare_key") return node.text.length > 0 ? [node.text] : null;
  if (node.type === "quoted_key") {
    const decoded = tomlQuotedText(node.text);
    if (decoded === null || decoded.length === 0) return null;
    return [decoded];
  }
  if (node.type !== "dotted_key") return null;
  const parts: string[] = [];
  const walk = (current: SyntaxNode): boolean => {
    if (current.type === "dotted_key") {
      for (const child of current.namedChildren) {
        if (!walk(child)) return false;
      }
      return current.namedChildren.length > 0;
    }
    const segment = tomlSegments(current);
    if (!segment) return false;
    parts.push(...segment);
    return true;
  };
  return walk(node) && parts.length > 0 ? parts : null;
}

function tomlHeader(node: SyntaxNode, endType: string): SyntaxNode | null {
  let limit = node.endIndex;
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child?.type === endType) {
      limit = child.startIndex;
      break;
    }
  }
  for (const child of node.namedChildren) {
    if (child.startIndex >= limit) break;
    if (child.type === "bare_key" || child.type === "quoted_key" || child.type === "dotted_key") {
      return child;
    }
  }
  return null;
}

function tomlValue(pair: SyntaxNode): SyntaxNode | null {
  const header = tomlHeader(pair, "=");
  if (!header) return null;
  for (const child of pair.namedChildren) {
    if (child.startIndex < header.endIndex || child.type === "comment") continue;
    return child;
  }
  return null;
}

function tomlSerialized(node: SyntaxNode): string | null {
  const segments = tomlSegments(node);
  return segments === null ? null : JSON.stringify(segments);
}

/** Stable key for a TOML pair or table. Comments, arrays, and array tables stay unnamed. */
function tomlDefinitionKey(node: SyntaxNode): string | null {
  if (node.type === "pair") {
    const header = tomlHeader(node, "=");
    if (!header) return null;
    const text = tomlSerialized(header);
    return text === null ? null : `key:${text}`;
  }
  if (node.type === "table") {
    const header = tomlHeader(node, "]");
    if (!header) return null;
    const text = tomlSerialized(header);
    return text === null ? null : `table:${text}`;
  }
  return null;
}

function tomlItemBody(node: SyntaxNode): { parent: SyntaxNode; start: number; end: number } | null {
  if (node.type === "table") {
    let closeEnd = -1;
    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index);
      if (child?.type === "]") closeEnd = child.endIndex;
    }
    if (closeEnd < 0 || closeEnd > node.endIndex) return null;
    return { parent: node, start: closeEnd, end: node.endIndex };
  }
  if (node.type !== "pair") return null;
  const value = tomlValue(node);
  if (!value || value.type !== "inline_table" || value.endIndex - value.startIndex < 2) return null;
  return { parent: value, start: value.startIndex + 1, end: value.endIndex - 1 };
}

function collectTomlSymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const visit = (node: SyntaxNode, tables: boolean): void => {
    const seenKeys = new Set<string>();
    const seenTables = new Set<string>();
    for (const child of node.namedChildren) {
      if (child.type === "array" || child.type === "table_array_element") continue;
      if (child.type === "pair") {
        const key = tomlDefinitionKey(child);
        if (key !== null && seenKeys.has(key)) {
          issues.push({
            line: child.startPosition.row + 1,
            message: `Duplicate declaration ${key.slice(key.indexOf(":") + 1)}`,
            code: "duplicate",
          });
        }
        if (key !== null) seenKeys.add(key);
        const value = tomlValue(child);
        if (value?.type === "inline_table") visit(value, false);
      } else if (tables && child.type === "table") {
        const key = tomlDefinitionKey(child);
        if (key !== null && seenTables.has(key)) {
          issues.push({
            line: child.startPosition.row + 1,
            message: `Duplicate declaration ${key.slice(key.indexOf(":") + 1)}`,
            code: "duplicate",
          });
        }
        if (key !== null) seenTables.add(key);
        visit(child, false);
      }
    }
  };
  visit(root, true);
  return issues;
}

function xmlStartTag(element: SyntaxNode): SyntaxNode | null {
  for (const child of element.namedChildren) {
    if (child.type === "STag" || child.type === "EmptyElemTag") return child;
  }
  return null;
}

/** Stable key for an XML element. Text, comments, and tag attributes stay unnamed. */
function xmlDefinitionKey(node: SyntaxNode): string | null {
  if (node.type !== "element") return null;
  const tag = xmlStartTag(node);
  if (!tag) return null;
  for (const child of tag.namedChildren) {
    if (child.type !== "Name") continue;
    return child.text.length > 0 ? `element:${child.text}` : null;
  }
  return null;
}

function xmlItemBody(node: SyntaxNode): { parent: SyntaxNode; start: number; end: number } | null {
  if (node.type !== "element") return null;
  for (const child of node.namedChildren) {
    if (child.type === "content" && child.endIndex > child.startIndex) {
      return { parent: child, start: child.startIndex, end: child.endIndex };
    }
  }
  return null;
}

function collectXmlSymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const visit = (node: SyntaxNode): void => {
    if (node.type === "content") {
      const seen = new Set<string>();
      for (const child of node.namedChildren) {
        if (child.type !== "element") continue;
        const key = xmlDefinitionKey(child);
        if (key !== null && seen.has(key)) {
          issues.push({
            line: child.startPosition.row + 1,
            message: `Duplicate declaration ${key.slice(key.indexOf(":") + 1)}`,
            code: "duplicate",
          });
        }
        if (key !== null) seen.add(key);
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return issues;
}

function markdownHeadingText(section: SyntaxNode): string | null {
  if (section.type !== "section") return null;
  for (const child of section.namedChildren) {
    if (child.type !== "atx_heading") continue;
    for (const inner of child.namedChildren) {
      if (inner.type !== "inline" || inner.text.length === 0) continue;
      return inner.text;
    }
    return null;
  }
  return null;
}

/** Stable key for a Markdown section. Only an ATX heading with text is named. */
function markdownDefinitionKey(node: SyntaxNode): string | null {
  const text = markdownHeadingText(node);
  return text === null ? null : `section:${text}`;
}

function markdownItemBody(
  node: SyntaxNode,
): { parent: SyntaxNode; start: number; end: number } | null {
  if (node.type !== "section") return null;
  let headingEnd = -1;
  for (const child of node.namedChildren) {
    if (child.type === "atx_heading") {
      headingEnd = child.endIndex;
      break;
    }
  }
  if (headingEnd < 0 || headingEnd >= node.endIndex) return null;
  return { parent: node, start: headingEnd, end: node.endIndex };
}

function collectMarkdownSymbols(root: SyntaxNode): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const visit = (node: SyntaxNode): void => {
    const seen = new Set<string>();
    for (const child of node.namedChildren) {
      if (child.type !== "section") continue;
      const key = markdownDefinitionKey(child);
      if (key !== null && seen.has(key)) {
        issues.push({
          line: child.startPosition.row + 1,
          message: `Duplicate declaration ${key.slice("section:".length)}`,
          code: "duplicate",
        });
      }
      if (key !== null) seen.add(key);
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return issues;
}

function collectSymbols(languageId: string, root: SyntaxNode): ParseIssue[] {
  if (languageId === "python") return collectPythonSymbols(root);
  if (languageId === "go") return collectGoSymbols(root);
  if (languageId === "java") return collectJavaSymbols(root);
  if (languageId === "kotlin") return collectKotlinSymbols(root);
  if (languageId === "csharp") return collectCsharpSymbols(root);
  if (languageId === "rust") return collectRustSymbols(root);
  if (languageId === "c") return collectCSymbols(root);
  if (languageId === "cpp") return collectCppSymbols(root);
  if (languageId === "php") return collectPhpSymbols(root);
  if (languageId === "ruby") return collectRubySymbols(root);
  if (languageId === "swift") return collectSwiftSymbols(root);
  if (languageId === "sql") return collectSqlSymbols(root);
  if (languageId === "toml") return collectTomlSymbols(root);
  if (languageId === "xml") return collectXmlSymbols(root);
  if (languageId === "markdown") return collectMarkdownSymbols(root);
  const issues: ParseIssue[] = [];
  const scopes: Array<Map<string, Binding>> = [new Map<string, Binding>()];

  const declare = (name: string, arity: number | null, node: SyntaxNode): void => {
    const scope = scopes[scopes.length - 1];
    if (!scope) return;
    if (scope.has(name)) {
      issues.push({
        line: node.startPosition.row + 1,
        message: `Duplicate declaration ${name}`,
        code: "duplicate",
      });
    }
    scope.set(name, { arity });
  };

  const lookup = (name: string): Binding | undefined => {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      const found = scopes[index]?.get(name);
      if (found) return found;
    }
    return undefined;
  };

  const visit = (node: SyntaxNode): void => {
    switch (node.type) {
      case "import_statement":
        for (const specifier of node.descendantsOfType("import_specifier")) {
          const local = specifier.childForFieldName("alias") ?? specifier.childForFieldName("name");
          if (local) declare(local.text, null, local);
        }
        return;
      case "function_declaration":
      case "method_definition":
      case "arrow_function": {
        const name = node.childForFieldName("name");
        const arity = arityOf(node);
        if (name && node.type !== "arrow_function") declare(name.text, arity, name);
        scopes.push(new Map<string, Binding>());
        const params = node.childForFieldName("parameters");
        if (params) declareParams(params, declare);
        const body = node.childForFieldName("body");
        if (body) visit(body);
        scopes.pop();
        return;
      }
      case "class_declaration": {
        const name = node.childForFieldName("name");
        if (name) declare(name.text, null, name);
        const body = node.childForFieldName("body");
        if (body) visit(body);
        return;
      }
      case "lexical_declaration":
      case "variable_declaration":
        for (const declarator of node.namedChildren) {
          if (declarator.type !== "variable_declarator") continue;
          const binding = declarator.namedChildren.find((child) => child.type === "identifier");
          if (binding) declare(binding.text, null, binding);
          const value = declarator.childForFieldName("value");
          if (value) visit(value);
        }
        return;
      case "call_expression": {
        const callee = node.childForFieldName("function");
        const args = node.childForFieldName("arguments");
        if (callee?.type === "identifier") {
          const known = lookup(callee.text);
          if (!known && !GLOBALS.has(callee.text)) {
            issues.push({
              line: callee.startPosition.row + 1,
              message: `Undeclared ${callee.text}`,
              code: "undeclared",
            });
          } else if (known && known.arity !== null && args) {
            const count = args.namedChildren.length;
            if (count !== known.arity) {
              issues.push({
                line: callee.startPosition.row + 1,
                message: `Wrong arity for ${callee.text}`,
                code: "arity",
              });
            }
          }
        } else if (callee) {
          visit(callee);
        }
        if (args) {
          for (const argument of args.namedChildren) visit(argument);
        }
        return;
      }
      case "object": {
        if (languageId !== "json") {
          for (const child of node.namedChildren) visit(child);
          return;
        }
        const seen = new Set<string>();
        for (const child of node.namedChildren) {
          if (child.type !== "pair") {
            visit(child);
            continue;
          }
          const key = child.childForFieldName("key");
          const raw = key?.text ?? "";
          const text = decodeJsonString(raw) ?? raw;
          if (text.length > 0 && seen.has(text)) {
            issues.push({
              line: child.startPosition.row + 1,
              message: `Duplicate key ${JSON.stringify(text)}`,
              code: "duplicate",
            });
          }
          if (text.length > 0) seen.add(text);
          const value = child.childForFieldName("value");
          if (value) visit(value);
        }
        return;
      }
      case "block_mapping":
      case "flow_mapping": {
        if (languageId !== "yaml") {
          for (const child of node.namedChildren) visit(child);
          return;
        }
        const seen = new Set<string>();
        for (const child of node.namedChildren) {
          if (child.type !== "block_mapping_pair" && child.type !== "flow_pair") {
            visit(child);
            continue;
          }
          const key = child.childForFieldName("key");
          const text = key ? yamlKeyText(key) : "";
          if (text === null) {
            issues.push({
              line: child.startPosition.row + 1,
              message: "Unsupported key spelling",
              code: "yaml-key",
            });
          } else if (text.length > 0 && seen.has(text)) {
            issues.push({
              line: child.startPosition.row + 1,
              message: `Duplicate key ${JSON.stringify(text)}`,
              code: "duplicate",
            });
          }
          if (text !== null && text.length > 0) seen.add(text);
          const value = child.childForFieldName("value");
          if (value) visit(value);
        }
        return;
      }
      case "statement_block":
        scopes.push(new Map<string, Binding>());
        for (const child of node.namedChildren) visit(child);
        scopes.pop();
        return;
      case "type_annotation":
      case "type_arguments":
      case "type_parameters":
        return;
      default:
        if (node.type === "identifier" && !lookup(node.text) && !GLOBALS.has(node.text)) {
          issues.push({
            line: node.startPosition.row + 1,
            message: `Undeclared ${node.text}`,
            code: "undeclared",
          });
          return;
        }
        for (const child of node.namedChildren) visit(child);
    }
  };

  visit(root);
  return issues;
}

function declareParams(
  params: SyntaxNode,
  declare: (name: string, arity: number | null, node: SyntaxNode) => void,
): void {
  for (const child of params.namedChildren) {
    const name = child.namedChildren.find((item) => item.type === "identifier");
    if (name) declare(name.text, null, name);
  }
}

function arityOf(node: SyntaxNode): number | null {
  const params = node.childForFieldName("parameters");
  if (!params) return null;
  let count = 0;
  for (const child of params.namedChildren) {
    if (child.type === "optional_parameter" || child.type === "rest_parameter") return null;
    if (child.type === "required_parameter") count += 1;
  }
  return count;
}

function walk(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node);
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child) walk(child, visit);
  }
}
