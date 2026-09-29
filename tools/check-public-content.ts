/**
 * Public-content guard (AGENTS.md rule 14).
 * Fails if any published text file contains a forbidden third-party name,
 * or if anything under `private/` is tracked by git.
 *
 * Names come from SMARTMERGE_FORBIDDEN_NAMES_FILE, else private/forbidden-names.json.
 * The list itself is private and must never be committed.
 * Usage: tsx tools/check-public-content.ts [dir ...]   (default: current directory)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".ts",
  ".tsx",
  ".json",
  ".yml",
  ".yaml",
  ".txt",
  ".html",
  ".css",
  ".kt",
  ".lua",
  ".cs",
  ".toml",
]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".turbo", "coverage", "private"]);

function loadNames(): string[] {
  const file = process.env["SMARTMERGE_FORBIDDEN_NAMES_FILE"] ?? "private/forbidden-names.json";
  if (!existsSync(file)) {
    console.error(
      `Forbidden-names list not found at "${file}". Set SMARTMERGE_FORBIDDEN_NAMES_FILE or provide private/forbidden-names.json.`,
    );
    process.exit(2);
  }
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed) || !parsed.every((n): n is string => typeof n === "string")) {
    console.error("Forbidden-names file must be a JSON array of strings.");
    process.exit(2);
  }
  return parsed.filter((n) => n.trim().length > 0);
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) yield* walk(full);
    else if (TEXT_EXTENSIONS.has(extname(entry))) yield full;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const names = loadNames();
const patterns = names.map((n) => ({
  name: n,
  re: new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(n)}(?![A-Za-z0-9])`),
}));
const roots = process.argv.slice(2);
const scanRoots = roots.length > 0 ? roots : ["."];

let violations = 0;
for (const root of scanRoots) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const { name, re } of patterns) {
        if (re.test(line)) {
          violations += 1;
          console.error(
            `${relative(process.cwd(), file)}:${String(i + 1)}: forbidden name "${name}"`,
          );
        }
      }
    });
  }
}

try {
  const tracked = execFileSync("git", ["ls-files", "private"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (tracked.length > 0) {
    violations += 1;
    console.error(`Files under private/ are tracked by git:\n${tracked}`);
  }
} catch {
  // Not a git repository (or git unavailable): skip the tracking check.
}

if (violations > 0) {
  console.error(`\n${String(violations)} violation(s). See AGENTS.md rule 14.`);
  process.exit(1);
}
console.log("Public content check passed.");
