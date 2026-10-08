import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Module specifiers an adapter must not import.
 * `@smartmerge/core` re-exports strategy, merge, and resolution logic.
 * The relative entries are the same modules reached without the package name.
 */
export const FORBIDDEN_IMPORTS = [
  "@smartmerge/core",
  "core/src/strategies",
  "core/src/strategies.js",
  "core/src/strategies.ts",
  "core/src/structure",
  "core/src/structure.js",
  "core/src/structure.ts",
  "core/src/verify",
  "core/src/verify.js",
  "core/src/verify.ts",
  "core/src/apply",
  "core/src/apply.js",
  "core/src/apply.ts",
  "core/src/index",
  "core/src/index.js",
  "core/src/index.ts",
] as const;

/** One forbidden import found in adapter source. */
export interface ForbiddenImport {
  readonly file: string;
  readonly specifier: string;
}

const FROM_SPECIFIER = /\b(?:import|export)\s+(?:type\s+)?[^;]{0,500}?\bfrom\s*["']([^"']+)["']/g;
const SIDE_EFFECT_SPECIFIER = /\bimport\s*["']([^"']+)["']/g;
const DYNAMIC_SPECIFIER = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Returns forbidden import specifiers in `source`, in source order.
 * Protocol, daemon, and UI imports are allowed.
 */
export function forbiddenImports(source: string): readonly string[] {
  return importSpecifiers(source).filter(isForbiddenImport);
}

/**
 * Reads every TypeScript file under `adapterRoot/src` and returns forbidden imports.
 * `adapterRoot` is the adapter package directory, such as `packages/adapters/vscode`.
 */
export function scanAdapter(adapterRoot: string): readonly ForbiddenImport[] {
  const found: ForbiddenImport[] = [];
  for (const file of filesEnding(path.join(adapterRoot, "src"), ".ts")) {
    const source = readFileSync(file, "utf8");
    for (const specifier of forbiddenImports(source)) {
      found.push({ file, specifier });
    }
  }
  return found;
}

/**
 * Returns forbidden module paths named anywhere in Lua adapter source.
 * Lua has no import-from syntax, so the check is the module path string.
 */
export function forbiddenLuaText(source: string): readonly string[] {
  return FORBIDDEN_IMPORTS.filter((forbidden) => source.includes(forbidden));
}

/**
 * Reads every Lua file under `adapterRoot` and returns forbidden module paths.
 * `adapterRoot` is the adapter directory, such as `packages/adapters/neovim`.
 */
export function scanLuaAdapter(adapterRoot: string): readonly ForbiddenImport[] {
  const found: ForbiddenImport[] = [];
  for (const file of filesEnding(adapterRoot, ".lua")) {
    const source = readFileSync(file, "utf8");
    for (const specifier of forbiddenLuaText(source)) {
      found.push({ file, specifier });
    }
  }
  return found;
}

/** Concatenated Lua source under `adapterRoot`, for contract assertions. */
export function adapterLuaText(adapterRoot: string): string {
  return filesEnding(adapterRoot, ".lua")
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

/** True when `specifier` names a strategy, merge, or resolution module. */
export function isForbiddenImport(specifier: string): boolean {
  const normalized = specifier.replaceAll("\\", "/");
  if (normalized === "@smartmerge/core" || normalized.startsWith("@smartmerge/core/")) {
    return true;
  }
  return FORBIDDEN_IMPORTS.some((forbidden) => {
    if (forbidden.startsWith("@")) {
      return false;
    }
    return normalized === forbidden || normalized.endsWith(`/${forbidden}`);
  });
}

function importSpecifiers(source: string): readonly string[] {
  const found: string[] = [];
  collect(source, FROM_SPECIFIER, found);
  collect(source, SIDE_EFFECT_SPECIFIER, found);
  collect(source, DYNAMIC_SPECIFIER, found);
  return found;
}

function collect(source: string, pattern: RegExp, found: string[]): void {
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier !== undefined && !spanCrossesStatement(match[0])) {
      found.push(specifier);
    }
  }
}

function spanCrossesStatement(span: string): boolean {
  return (
    span.includes("\nfunction ") ||
    span.includes("\nconst ") ||
    span.includes("\nclass ") ||
    span.includes("\nlet ")
  );
}

function filesEnding(directory: string, suffix: string): readonly string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      files.push(...filesEnding(full, suffix));
    } else if (entry.endsWith(suffix) && !entry.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}
