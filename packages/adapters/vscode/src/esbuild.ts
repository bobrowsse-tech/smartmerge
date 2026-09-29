import { build } from "esbuild";

/** Bundle the editor entry so the package does not depend on the workspace layout. */
await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  outfile: "dist/extension.js",
  external: ["vscode"],
  alias: {
    "@smartmerge/daemon": "../../daemon/src/client.ts",
  },
  minify: true,
  legalComments: "none",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
