import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_IMPORTS,
  adapterKotlinText,
  adapterLuaText,
  forbiddenImports,
  forbiddenKotlinText,
  forbiddenLuaText,
  scanAdapter,
  scanKotlinAdapter,
  scanLuaAdapter,
} from "./imports.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const vscodeRoot = path.join(repoRoot, "packages/adapters/vscode");
const neovimRoot = path.join(repoRoot, "packages/adapters/neovim");
const jetbrainsRoot = path.join(repoRoot, "packages/adapters/jetbrains");

describe("adapter import contract", () => {
  it("accepts every TypeScript file in the current editor adapter", () => {
    expect(scanAdapter(vscodeRoot)).toEqual([]);
  });

  it("rejects the core package and the strategy, merge, and resolution modules", () => {
    expect(forbiddenImports(`import { proposeForFile } from "@smartmerge/core";`)).toEqual([
      "@smartmerge/core",
    ]);
    expect(forbiddenImports(`import type { ConflictFacts } from "@smartmerge/core";`)).toEqual([
      "@smartmerge/core",
    ]);
    expect(
      forbiddenImports(`import { proposeForFile } from "../../core/src/strategies.js";`),
    ).toEqual(["../../core/src/strategies.js"]);
    expect(forbiddenImports(`import { mergeRegions } from "../../core/src/structure.js";`)).toEqual(
      ["../../core/src/structure.js"],
    );
    expect(
      forbiddenImports(`import { verifyResolution } from "../../core/src/verify.js";`),
    ).toEqual(["../../core/src/verify.js"]);
    expect(forbiddenImports(`import { replaceHunk } from "../../core/src/apply.js";`)).toEqual([
      "../../core/src/apply.js",
    ]);
    expect(forbiddenImports(`import { proposeForFile } from "../../core/src/index.js";`)).toEqual([
      "../../core/src/index.js",
    ]);
    expect(forbiddenImports(`import { mergeRegions } from "../../core/src/structure.ts";`)).toEqual(
      ["../../core/src/structure.ts"],
    );
    expect(forbiddenImports(`import "@smartmerge/core";`)).toEqual(["@smartmerge/core"]);
    expect(forbiddenImports(`export { replaceHunk } from "../../core/src/apply.js";`)).toEqual([
      "../../core/src/apply.js",
    ]);
    expect(forbiddenImports(`import("../../core/src/verify.js")`)).toEqual([
      "../../core/src/verify.js",
    ]);
  });

  it("allows protocol, daemon, UI, and a local module that only forwards actions", () => {
    const source = [
      `import type { ResolutionProposal, UserAction } from "@smartmerge/protocol";`,
      `import { withDaemon } from "@smartmerge/daemon";`,
      `import { panelModel, renderDashboardDocument, renderPanelDocument } from "@smartmerge/ui";`,
      `import { acceptFile, undoFile } from "./resolve.js";`,
    ].join("\n");
    expect(forbiddenImports(source)).toEqual([]);
  });

  it("rejects Lua that names a forbidden module and accepts the editor plugin", () => {
    expect(forbiddenLuaText(`local path = "core/src/structure.js"\n`)).toContain(
      "core/src/structure.js",
    );
    expect(
      forbiddenLuaText(`client.request("resolution/act", { type = "accept" })\napplyAllSafe\n`),
    ).toEqual([]);
    expect(scanLuaAdapter(neovimRoot)).toEqual([]);
    const source = adapterLuaText(neovimRoot);
    for (const name of [
      "initialize",
      "conflicts/list",
      "resolution/propose",
      "resolution/act",
      "SmartMergeResolve",
      "SmartMergeAcceptAll",
    ]) {
      expect(source).toContain(name);
    }
  });

  it("rejects Kotlin that names a forbidden module and accepts the daemon client", () => {
    expect(forbiddenKotlinText(`val path = "core/src/structure.js"\n`)).toContain(
      "core/src/structure.js",
    );
    expect(
      forbiddenKotlinText(`request("resolution/act", jStr("accept"))\napplyAllSafe\n`),
    ).toEqual([]);
    expect(scanKotlinAdapter(jetbrainsRoot)).toEqual([]);
    const source = adapterKotlinText(jetbrainsRoot);
    for (const name of [
      "initialize",
      "conflicts/list",
      "resolution/propose",
      "resolution/act",
      "applyAllSafe",
      "accept",
    ]) {
      expect(source).toContain(name);
    }
  });

  it("lists the same modules in the adapter lint rule", () => {
    const config = readFileSync(path.join(repoRoot, "eslint.config.js"), "utf8");
    for (const forbidden of FORBIDDEN_IMPORTS) {
      const quoted = forbidden.startsWith("@") ? `"${forbidden}"` : `"**/${forbidden}"`;
      expect(config).toContain(quoted);
    }
  });
});
