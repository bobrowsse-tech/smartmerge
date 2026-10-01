/**
 * Project lint for a resolution, compared with the two sides.
 * The check runs only when the caller marks the workspace trusted. File text is untrusted, so
 * inline lint directives in that text are ignored. An untrusted call does not load project tools.
 */
import { isAbsolute, relative, resolve } from "node:path";
import { ESLint } from "eslint";
import type { Check } from "@smartmerge/protocol";
import { compareBaseline, type TextDiagnostic } from "./baseline.js";

const MAX_CHARS = 1_000_000;

/**
 * Lint a resolution against the two sides.
 * Without trust, or without a project root, the check stays unknown and does not read a config.
 */
export async function checkLint(input: {
  path: string;
  trusted: boolean;
  projectRoot?: string;
  result: string;
  current: string;
  incoming: string;
}): Promise<Check> {
  if (!input.trusted) {
    return skipped("Project lint runs only in a trusted workspace.");
  }
  const projectRoot = input.projectRoot;
  if (projectRoot === undefined || projectRoot.length === 0) {
    return skipped("Project lint needs a project root.");
  }
  const filePath = fileInProject(projectRoot, input.path);
  if (filePath === null) return skipped("Lint path must stay inside the project.");
  if (
    input.result.length > MAX_CHARS ||
    input.current.length > MAX_CHARS ||
    input.incoming.length > MAX_CHARS
  ) {
    return skipped("Lint skipped for a file over 1 MB.");
  }
  const started = Date.now();
  try {
    const lint = new ESLint({
      cwd: projectRoot,
      allowInlineConfig: false,
      errorOnUnmatchedPattern: false,
    });
    if (await lint.isPathIgnored(filePath)) {
      return skipped("This file is ignored by the lint config.");
    }
    const config = await lint.findConfigFile(filePath);
    if (config === undefined) return skipped("No lint config was found.");
    const result = await lintFile(lint, filePath, input.result);
    const current = await lintFile(lint, filePath, input.current);
    const incoming = await lintFile(lint, filePath, input.incoming);
    return compareBaseline("lint", input.path, result, current, incoming, Date.now() - started);
  } catch {
    return skipped("Project lint could not run.");
  }
}

async function lintFile(lint: ESLint, filePath: string, source: string): Promise<TextDiagnostic[]> {
  const [report] = await lint.lintText(source, { filePath, warnIgnored: false });
  if (report === undefined) return [];
  const found: TextDiagnostic[] = [];
  for (const message of report.messages) {
    if (message.severity !== 2) continue;
    found.push({
      code: message.ruleId ?? "lint",
      message: message.message,
      line: message.line,
    });
  }
  return found;
}

function fileInProject(projectRoot: string, filePath: string): string | null {
  if (filePath.length === 0 || isAbsolute(filePath) || filePath.includes("\0")) return null;
  const root = resolve(projectRoot);
  const full = resolve(root, filePath);
  const fromRoot = relative(root, full);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) return null;
  return full;
}

function skipped(reason: string): Check {
  return { kind: "lint", status: "unknown", diagnostics: [], durationMs: 0, reason };
}
