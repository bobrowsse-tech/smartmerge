import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(packageRoot));
const dist = join(packageRoot, "dist");
const require = createRequire(join(repoRoot, "packages/core/package.json"));
const runtimeBanner =
  "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);";

/**
 * Pack the command into one folder.
 * Scoped workspace packages stay private, so the published command carries their code.
 */
await build({
  entryPoints: { main: join(packageRoot, "src/main.ts") },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  outdir: dist,
  external: ["eslint", "ink", "jiti", "jiti/package.json", "react", "react-dom", "typescript"],
  minify: true,
  legalComments: "none",
  banner: { js: runtimeBanner },
});
await build({
  entryPoints: {
    bin: join(repoRoot, "packages/daemon/src/bin.ts"),
    worker: join(repoRoot, "packages/daemon/src/worker.ts"),
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  outdir: dist,
  external: ["eslint", "jiti", "jiti/package.json", "typescript"],
  minify: true,
  legalComments: "none",
  banner: { js: runtimeBanner },
});

const grammars: ReadonlyArray<readonly [string, string]> = [
  ["tree-sitter-typescript/tree-sitter-typescript.wasm", "wasm/tree-sitter-typescript.wasm"],
  ["tree-sitter-typescript/tree-sitter-tsx.wasm", "wasm/tree-sitter-tsx.wasm"],
  ["tree-sitter-javascript/tree-sitter-javascript.wasm", "wasm/tree-sitter-javascript.wasm"],
  ["tree-sitter-json/tree-sitter-json.wasm", "wasm/tree-sitter-json.wasm"],
  ["@tree-sitter-grammars/tree-sitter-yaml/tree-sitter-yaml.wasm", "wasm/tree-sitter-yaml.wasm"],
  ["tree-sitter-python/tree-sitter-python.wasm", "wasm/tree-sitter-python.wasm"],
  ["tree-sitter-go/tree-sitter-go.wasm", "wasm/tree-sitter-go.wasm"],
  ["tree-sitter-java/tree-sitter-java.wasm", "wasm/tree-sitter-java.wasm"],
  [
    "@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm",
    "wasm/tree-sitter-kotlin.wasm",
  ],
  ["tree-sitter-c-sharp/tree-sitter-c_sharp.wasm", "wasm/tree-sitter-c_sharp.wasm"],
  ["tree-sitter-rust/tree-sitter-rust.wasm", "wasm/tree-sitter-rust.wasm"],
  ["tree-sitter-c/tree-sitter-c.wasm", "wasm/tree-sitter-c.wasm"],
  ["tree-sitter-cpp/tree-sitter-cpp.wasm", "wasm/tree-sitter-cpp.wasm"],
  ["tree-sitter-php/tree-sitter-php_only.wasm", "wasm/tree-sitter-php_only.wasm"],
  ["tree-sitter-ruby/tree-sitter-ruby.wasm", "wasm/tree-sitter-ruby.wasm"],
  ["@binclusive/tree-sitter-swift-wasm/tree-sitter-swift.wasm", "wasm/tree-sitter-swift.wasm"],
  ["web-tree-sitter/web-tree-sitter.wasm", "web-tree-sitter.wasm"],
];
for (const [specifier, name] of grammars) {
  const target = join(dist, name);
  await mkdir(dirname(target), { recursive: true });
  await cp(require.resolve(specifier), target);
}

const keep = new Set(["main.js", "bin.js", "worker.js"]);
await removeExtraScripts(dist);
await keepSingleShebang(join(dist, "main.js"));
await stripShebang(join(dist, "bin.js"));
await stripShebang(join(dist, "worker.js"));

/** Leave one interpreter line at the top of the command. */
async function keepSingleShebang(file: string): Promise<void> {
  const source = await readFile(file, "utf8");
  const body = source
    .split("\n")
    .filter((line) => !line.startsWith("#!"))
    .join("\n");
  await writeFile(file, `#!/usr/bin/env node\n${body.startsWith("\n") ? body.slice(1) : body}`);
}

/** A spawned bundle must not carry an interpreter line in the middle of the file. */
async function stripShebang(file: string): Promise<void> {
  const source = await readFile(file, "utf8");
  const body = source
    .split("\n")
    .filter((line) => !line.startsWith("#!"))
    .join("\n");
  await writeFile(file, body);
}

/** Drop the compiler's script files. The command runs the three bundles. */
async function removeExtraScripts(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "wasm") continue;
      await removeExtraScripts(full);
      continue;
    }
    if (entry.name.endsWith(".js") && !keep.has(entry.name)) await rm(full);
  }
}
