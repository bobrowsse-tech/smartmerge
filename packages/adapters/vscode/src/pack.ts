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
const manifest = {
  name: "smartmerge-resolver",
  version,
  type: "module",
  publisher: record["publisher"],
  displayName: record["displayName"],
  description: record["description"],
  license: record["license"],
  engines: record["engines"],
  categories: ["Other"],
  activationEvents: record["activationEvents"],
  contributes: record["contributes"],
  main: "./dist/extension.js",
};
await writeFile(join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(stage, ".vscodeignore"), ["**/*.md", "**/*.map", ""].join("\n"));
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
    [
      "package",
      "--pre-release",
      "--no-dependencies",
      "--allow-missing-repository",
      "--skip-license",
      "--out",
      vsix,
    ],
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
    ["web-tree-sitter/web-tree-sitter.wasm", "web-tree-sitter.wasm"],
  ];
  for (const [specifier, name] of grammars) {
    const target = join(daemon, name);
    await mkdir(dirname(target), { recursive: true });
    await cp(require.resolve(specifier), target);
  }
}
