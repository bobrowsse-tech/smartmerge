import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const execFileAsync = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(dirname(packageRoot)));
const stage = join(packageRoot, ".pack");

/**
 * Stage a self-contained editor package.
 * The workspace package name stays scoped. The staged name is the registry id.
 * Pass `--vsix` to also write an installable pre-release package.
 */
await rm(stage, { recursive: true, force: true });
await mkdir(join(stage, "dist"), { recursive: true });
await cp(join(packageRoot, "dist", "extension.js"), join(stage, "dist", "extension.js"));
await stageDaemon(repoRoot, stage);

const source: unknown = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
if (typeof source !== "object" || source === null) throw new Error("extension package is invalid");
const record = source as Record<string, unknown>;
const version = (process.env["SMARTMERGE_VERSION"] ?? "0.1.0").replace(/^v/, "");
// Raster of assets/logo.svg. The listing icon has to be a PNG, and the background stays transparent.
const icon = join(repoRoot, "assets", "logo.png");
await cp(icon, join(stage, "icon.png"));
const manifest = {
  name: "smartmerge-resolver",
  version,
  type: "module",
  publisher: record["publisher"],
  author: record["author"],
  displayName: record["displayName"],
  description: record["description"],
  license: record["license"],
  homepage: record["homepage"],
  repository: record["repository"],
  bugs: record["bugs"],
  engines: record["engines"],
  icon: "icon.png",
  categories: ["Other"],
  activationEvents: record["activationEvents"],
  contributes: record["contributes"],
  main: "./dist/extension.js",
};
await writeFile(join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(join(repoRoot, "README.md"), join(stage, "README.md"));
await mkdir(join(stage, "assets"), { recursive: true });
await cp(join(repoRoot, "assets", "logo.png"), join(stage, "assets", "logo.png"));
await writeFile(join(stage, ".vscodeignore"), ["**/*.md", "!README.md", "**/*.map", ""].join("\n"));
const license = join(repoRoot, "LICENSE");
try {
  await access(license, constants.R_OK);
  await cp(license, join(stage, "LICENSE"));
} catch {
  // The license field in the manifest is enough when the file is absent.
}

if (process.argv.includes("--vsix")) {
  const vsix = join(packageRoot, `smartmerge-resolver-${version}.vsix`);
  await execFileAsync(
    join(packageRoot, "node_modules", ".bin", "vsce"),
    ["package", "--pre-release", "--no-dependencies", "--skip-license", "--out", vsix],
    { cwd: stage },
  );
  process.stdout.write(`${vsix}\n`);
}

/** Bundle the daemon beside the editor so the package does not ship a dependency folder. */
async function stageDaemon(repo: string, destination: string): Promise<void> {
  const daemon = join(destination, "daemon");
  await build({
    entryPoints: {
      smartmerged: join(repo, "packages/daemon/src/bin.ts"),
      worker: join(repo, "packages/daemon/src/worker.ts"),
    },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    outdir: daemon,
    // The optional config loader is not bundled. A missing loader fails that lint check.
    external: ["jiti", "jiti/package.json"],
    minify: true,
    legalComments: "none",
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  });
  const require = createRequire(join(repo, "packages/core/package.json"));
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
    ["@l1xnan/tree-sitter-sql/tree-sitter-sql.wasm", "wasm/tree-sitter-sql.wasm"],
    ["web-tree-sitter/web-tree-sitter.wasm", "web-tree-sitter.wasm"],
  ];
  for (const [specifier, name] of grammars) {
    const target = join(daemon, name);
    await mkdir(dirname(target), { recursive: true });
    await cp(require.resolve(specifier), target);
  }
}
