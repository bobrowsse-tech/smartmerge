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
   * Python, Go, Java, Kotlin, and C# statements use this so two assignments are not merged just because they line up.
   */
  positional: boolean;
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
  const inner = containerRange(declared);
  if (!inner) {
    return {
      key: key.key,
      stable: key.stable,
      type: declared.type,
      positional: statementPositional(languageId, key.stable),
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
  node: SyntaxNode,
): { parent: SyntaxNode; start: number; end: number } | null {
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
    languageId !== "csharp"
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

function collectSymbols(languageId: string, root: SyntaxNode): ParseIssue[] {
  if (languageId === "python") return collectPythonSymbols(root);
  if (languageId === "go") return collectGoSymbols(root);
  if (languageId === "java") return collectJavaSymbols(root);
  if (languageId === "kotlin") return collectKotlinSymbols(root);
  if (languageId === "csharp") return collectCsharpSymbols(root);
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
