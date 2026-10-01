/**
 * Type check for TypeScript and JavaScript text.
 * This uses the bundled compiler on the candidate and both sides. It does not load a project
 * program, project plugins, or any other tool from the workspace.
 */
import { dirname } from "node:path";
import type { Check } from "@smartmerge/protocol";
import ts from "typescript";
import { compareBaseline, type TextDiagnostic } from "./baseline.js";

const MAX_CHARS = 1_000_000;

/**
 * Type-check a resolution against the two sides.
 * Only diagnostics that are new on the resolution fail the check. Other languages stay unknown.
 */
export function checkTypes(input: {
  path: string;
  languageId: string | null;
  result: string;
  current: string;
  incoming: string;
}): Check {
  const virtual = virtualPath(input.path, input.languageId);
  if (virtual === null) {
    return skipped("types", "This language has no type check.");
  }
  if (
    input.result.length > MAX_CHARS ||
    input.current.length > MAX_CHARS ||
    input.incoming.length > MAX_CHARS
  ) {
    return skipped("types", "Type check skipped for a file over 1 MB.");
  }
  const started = Date.now();
  try {
    const result = diagnose(virtual, input.result);
    const current = diagnose(virtual, input.current);
    const incoming = diagnose(virtual, input.incoming);
    return compareBaseline("types", input.path, result, current, incoming, Date.now() - started);
  } catch {
    return skipped("types", "Type check could not run.");
  }
}

const libSourceFiles = new Map<string, ts.SourceFile>();

function diagnose(fileName: string, source: string): TextDiagnostic[] {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    allowJs: true,
    checkJs: isJavaScript(fileName),
    jsx: isJsx(fileName) ? ts.JsxEmit.ReactJSX : ts.JsxEmit.None,
  };
  const libFile = ts.getDefaultLibFilePath(options);
  const libDir = dirname(libFile);
  const files = new Map<string, string>([[fileName, source]]);
  const host: ts.CompilerHost = {
    getSourceFile(name, languageVersion) {
      const cached = libSourceFiles.get(name);
      if (cached !== undefined) return cached;
      const text = readVirtual(name, files, libDir);
      if (text === undefined) return undefined;
      const parsed = ts.createSourceFile(name, text, languageVersion, true);
      if (insideLib(name, libDir)) libSourceFiles.set(name, parsed);
      return parsed;
    },
    getDefaultLibFileName: () => libFile,
    writeFile() {
      return undefined;
    },
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (name) => files.has(name) || (insideLib(name, libDir) && ts.sys.fileExists(name)),
    readFile: (name) => readVirtual(name, files, libDir),
    directoryExists: (dir) => dir === "/" || insideLib(dir, libDir) || libDir.startsWith(dir),
  };
  const program = ts.createProgram([fileName], options, host);
  const sourceFile = program.getSourceFile(fileName);
  const diagnostics = ts.getPreEmitDiagnostics(program, sourceFile);
  const found: TextDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
    if (diagnostic.file !== undefined && diagnostic.file.fileName !== fileName) continue;
    const start = diagnostic.start ?? 0;
    const line =
      sourceFile === undefined ? 1 : sourceFile.getLineAndCharacterOfPosition(start).line + 1;
    found.push({
      code: String(diagnostic.code),
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      line,
    });
  }
  return found;
}

function readVirtual(
  name: string,
  files: ReadonlyMap<string, string>,
  libDir: string,
): string | undefined {
  const own = files.get(name);
  if (own !== undefined) return own;
  if (!insideLib(name, libDir)) return undefined;
  return ts.sys.readFile(name);
}

function insideLib(name: string, libDir: string): boolean {
  return name === libDir || name.startsWith(`${libDir}/`) || name.startsWith(`${libDir}\\`);
}

function virtualPath(path: string, languageId: string | null): string | null {
  const fromPath = extensionOf(path);
  const extension = fromPath ?? extensionFor(languageId);
  if (extension === null) return null;
  const name = fromPath === null ? `${path}${extension}` : path;
  return name.startsWith("/") ? name : `/${name}`;
}

function extensionOf(path: string): ".ts" | ".tsx" | ".js" | ".jsx" | ".mts" | ".cts" | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return ".tsx";
  if (lower.endsWith(".ts")) return ".ts";
  if (lower.endsWith(".jsx")) return ".jsx";
  if (lower.endsWith(".js")) return ".js";
  if (lower.endsWith(".mts")) return ".mts";
  if (lower.endsWith(".cts")) return ".cts";
  return null;
}

function extensionFor(languageId: string | null): ".ts" | ".tsx" | ".js" | ".jsx" | null {
  switch (languageId) {
    case "typescript":
    case "ts":
      return ".ts";
    case "typescriptreact":
    case "tsx":
      return ".tsx";
    case "javascript":
    case "js":
      return ".js";
    case "javascriptreact":
    case "jsx":
      return ".jsx";
    default:
      return null;
  }
}

function isJavaScript(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".js") || lower.endsWith(".jsx");
}

function isJsx(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".tsx") || lower.endsWith(".jsx");
}

function skipped(kind: "types" | "lint", reason: string): Check {
  return { kind, status: "unknown", diagnostics: [], durationMs: 0, reason };
}
