import type { ConcreteNode, ConcreteRegion, IdentifierSpan, ParsedSource } from "./parse.js";

const OMIT = Symbol("omit");

/**
 * Three-way merge of concrete syntax.
 * Untouched nodes are copied from the base, including their comments and spacing.
 * Returns null when both sides edit the same node and the children cannot be merged.
 */
export function mergeRegions(
  base: ConcreteRegion,
  current: ConcreteRegion,
  incoming: ConcreteRegion,
): string | null {
  const sameShape = sameShapeAs(base, current) && sameShapeAs(base, incoming);
  if (!sameShape && unstableBlob(base) !== unstableBlob(current)) return null;
  if (!sameShape && unstableBlob(base) !== unstableBlob(incoming)) return null;
  if (blockedUnstable(base, current) || blockedUnstable(base, incoming)) return null;

  const baseList = assignKeys(base.nodes, sameShape);
  const currentList = assignKeys(current.nodes, sameShape);
  const incomingList = assignKeys(incoming.nodes, sameShape);
  const baseMap = new Map(baseList.map((item) => [item.key, item.node]));
  const currentMap = new Map(currentList.map((item) => [item.key, item.node]));
  const incomingMap = new Map(incomingList.map((item) => [item.key, item.node]));
  const emitted = new Set<string>();
  const parts: string[] = [];
  let previousPair = false;

  const emit = (key: string): boolean => {
    if (emitted.has(key)) return true;
    const node = currentMap.get(key) ?? incomingMap.get(key) ?? baseMap.get(key);
    let piece = mergeKey(baseMap.get(key), currentMap.get(key), incomingMap.get(key));
    if (piece === null) return false;
    if (piece !== OMIT && node !== undefined && isFlowPair(node)) {
      // Commas sit on the following pair. The first kept pair must not keep a
      // comma that belonged to a deleted predecessor, and a newly adjacent pair
      // needs a comma when neither slice already has one.
      if (!previousPair) piece = stripLeadingComma(piece);
      else {
        const previous = parts[parts.length - 1];
        if (previous !== undefined && needsPairComma(previous, piece)) {
          parts[parts.length - 1] = insertComma(previous);
        }
      }
      previousPair = true;
    } else if (piece !== OMIT) {
      previousPair = false;
    }
    if (piece !== OMIT) parts.push(piece);
    emitted.add(key);
    return true;
  };

  const lists = [currentList, incomingList, baseList];
  const flowWithComment =
    lists.some((list) => list.some((item) => item.node.type === "flow_pair")) &&
    lists.some((list) => list.some((item) => item.node.type === "comment"));
  const emitFrom = (list: typeof currentList, kind: "pairs" | "other" | "all"): boolean => {
    for (const item of list) {
      const pair = item.node.type === "flow_pair";
      if (kind === "pairs" && !pair) continue;
      if (kind === "other" && pair) continue;
      if (!emit(item.key)) return false;
    }
    return true;
  };
  if (flowWithComment) {
    // A trailing comment is its own node. Pairs added after it would sit inside that comment.
    for (const kind of ["pairs", "other"] as const) {
      for (const list of lists) {
        if (!emitFrom(list, kind)) return null;
      }
    }
  } else {
    for (const list of lists) {
      if (!emitFrom(list, "all")) return null;
    }
  }

  const trailing = mergeText(base.trailing, current.trailing, incoming.trailing);
  if (trailing === null) return null;
  return parts.join("") + trailing;
}

/**
 * True when every top-level change is an import from the same modules.
 * The merged text can then be labeled as a list union.
 */
export function onlyImportChanges(
  base: ConcreteRegion,
  current: ConcreteRegion,
  incoming: ConcreteRegion,
): boolean {
  const keys = new Set<string>();
  for (const node of [...base.nodes, ...current.nodes, ...incoming.nodes]) {
    if (node.stable) keys.add(node.key);
  }
  const baseMap = new Map(base.nodes.filter((node) => node.stable).map((node) => [node.key, node]));
  const currentMap = new Map(
    current.nodes.filter((node) => node.stable).map((node) => [node.key, node]),
  );
  const incomingMap = new Map(
    incoming.nodes.filter((node) => node.stable).map((node) => [node.key, node]),
  );
  let changed = false;
  for (const key of keys) {
    const bodies = [baseMap.get(key)?.body, currentMap.get(key)?.body, incomingMap.get(key)?.body];
    const distinct = new Set(bodies.filter((body) => body !== undefined));
    if (distinct.size <= 1) continue;
    changed = true;
    if (!key.startsWith("import:")) return false;
  }
  return changed;
}

/**
 * When one side is a pure rename and the other side has further edits,
 * apply that rename to the edited side. Returns null when both sides rename
 * or the rename is mixed with other edits on the same side.
 */
export function renameMerge(
  base: ParsedSource,
  current: ParsedSource,
  incoming: ParsedSource,
  baseText: string,
  currentText: string,
  incomingText: string,
): string | null {
  const currentRename = pureRename(base, current, baseText, currentText);
  const incomingRename = pureRename(base, incoming, baseText, incomingText);
  if (currentRename && !incomingRename) {
    return applyRename(incoming.identifiers, incomingText, currentRename);
  }
  if (incomingRename && !currentRename) {
    return applyRename(current.identifiers, currentText, incomingRename);
  }
  return null;
}

function mergeKey(
  base: ConcreteNode | undefined,
  current: ConcreteNode | undefined,
  incoming: ConcreteNode | undefined,
): string | null | typeof OMIT {
  if (!base) return mergeAdded(current, incoming);
  if (!current && !incoming) return OMIT;
  if (!current && incoming) return incoming.body === base.body ? OMIT : null;
  if (current && !incoming) return current.body === base.body ? OMIT : null;
  if (!current || !incoming) return null;
  return mergeNode(base, current, incoming);
}

function mergeAdded(
  current: ConcreteNode | undefined,
  incoming: ConcreteNode | undefined,
): string | null {
  if (current && !incoming) return current.slice;
  if (incoming && !current) return incoming.slice;
  if (current && incoming && current.body === incoming.body) return current.slice;
  return null;
}

function mergeNode(
  base: ConcreteNode,
  current: ConcreteNode,
  incoming: ConcreteNode,
): string | null {
  if (current.body === base.body && incoming.body === base.body) return base.slice;
  if (current.body === base.body) return incoming.slice;
  if (incoming.body === base.body) return current.slice;
  if (current.body === incoming.body) return current.slice;
  if (!base.children || !current.children || !incoming.children) return null;
  const inner = mergeRegions(base.children, current.children, incoming.children);
  if (inner === null) return null;
  const lead = mergeText(leading(base), leading(current), leading(incoming));
  const prefix = mergeText(base.prefix, current.prefix, incoming.prefix);
  const suffix = mergeText(base.suffix, current.suffix, incoming.suffix);
  if (lead === null || prefix === null || suffix === null) return null;
  return lead + prefix + inner + suffix;
}

function pureRename(
  base: ParsedSource,
  edited: ParsedSource,
  baseText: string,
  editedText: string,
): { from: string; to: string } | null {
  if (skeleton(base.identifiers, baseText) !== skeleton(edited.identifiers, editedText))
    return null;
  if (base.identifiers.length !== edited.identifiers.length) return null;
  let from: string | null = null;
  let to: string | null = null;
  for (let index = 0; index < base.identifiers.length; index += 1) {
    const before = base.identifiers[index]?.text;
    const after = edited.identifiers[index]?.text;
    if (!before || !after || before === after) continue;
    if (from === null) {
      from = before;
      to = after;
    } else if (before !== from || after !== to) {
      return null;
    }
  }
  if (!from || !to || from === to || KEYWORDS.has(from) || KEYWORDS.has(to)) return null;
  return { from, to };
}

function applyRename(
  identifiers: readonly IdentifierSpan[],
  source: string,
  rename: { from: string; to: string },
): string {
  let output = "";
  let cursor = 0;
  for (const identifier of identifiers) {
    output += source.slice(cursor, identifier.start);
    output += identifier.text === rename.from ? rename.to : identifier.text;
    cursor = identifier.end;
  }
  return output + source.slice(cursor);
}

function skeleton(identifiers: readonly IdentifierSpan[], source: string): string {
  let output = "";
  let cursor = 0;
  for (const identifier of identifiers) {
    output += source.slice(cursor, identifier.start);
    output += "#";
    cursor = identifier.end;
  }
  return output + source.slice(cursor);
}

function sameShapeAs(base: ConcreteRegion, other: ConcreteRegion): boolean {
  if (base.nodes.length !== other.nodes.length) return false;
  return base.nodes.every((node, index) => node.type === other.nodes[index]?.type);
}

function blockedUnstable(base: ConcreteRegion, other: ConcreteRegion): boolean {
  const locked = [...base.nodes, ...other.nodes].some((node) => !node.stable && !node.positional);
  return locked && unstableBlob(base) !== unstableBlob(other);
}

function unstableBlob(region: ConcreteRegion): string {
  return region.nodes
    .filter((node) => !node.stable)
    .map((node) => node.body)
    .join("\0");
}

function assignKeys(
  nodes: readonly ConcreteNode[],
  sameShape: boolean,
): Array<{ key: string; node: ConcreteNode }> {
  const seen = new Map<string, number>();
  const unstable = new Map<string, number>();
  return nodes.map((node, index) => {
    let key: string;
    if (node.stable) key = node.key;
    else if (sameShape) key = `idx:${String(index)}:${node.type}`;
    else {
      const count = unstable.get(node.body) ?? 0;
      unstable.set(node.body, count + 1);
      key = `unst:${node.body}#${String(count)}`;
    }
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    if (occurrence > 0) key = `${key}#${String(occurrence + 1)}`;
    return { key, node };
  });
}

function isFlowPair(node: ConcreteNode): boolean {
  return node.flow;
}

function stripLeadingComma(slice: string): string {
  return slice.replace(/^(\s*),/, "$1");
}

function needsPairComma(previous: string, next: string): boolean {
  const prev = previous.trimEnd();
  const nxt = next.trimStart();
  if (prev.length === 0 || nxt.length === 0) return false;
  if (prev.endsWith(",")) return false;
  if (nxt.startsWith(",")) return false;
  return true;
}

function insertComma(previous: string): string {
  const end = previous.trimEnd();
  return `${end},${previous.slice(end.length)}`;
}

function leading(node: ConcreteNode): string {
  return node.slice.slice(0, node.slice.length - node.body.length);
}

function mergeText(base: string, current: string, incoming: string): string | null {
  if (current === incoming) return current;
  if (current === base) return incoming;
  if (incoming === base) return current;
  return null;
}

const KEYWORDS = new Set([
  "abstract",
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "of",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "set",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "yield",
]);
