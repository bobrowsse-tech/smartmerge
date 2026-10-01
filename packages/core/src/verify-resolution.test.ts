import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { initParsers } from "./parse.js";
import { verifyResolution } from "./verify.js";

const clean = "function f(a: number) {\n  return a;\n}\n";
const typed = "export const n: number = 1;\n";
const mistyped = 'export const n: number = "no";\n';
const roots: string[] = [];

beforeAll(async () => {
  await initParsers();
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("verifyResolution", () => {
  it("fails a dropped brace and still reports lint as not run", async () => {
    const result = await verifyResolution({
      path: "file.ts",
      languageId: "typescript",
      result: "function f(a: number) {\n  return a;\n",
      current: clean,
      incoming: clean,
    });
    expect(result.hazardous).toBe(true);
    expect(result.overall).toBe("fail");
    expect(result.band).toBe("low");
    expect(result.checks.find((check) => check.kind === "lint")?.status).toBe("unknown");
  });

  it("passes types on a clean copy without treating that as certain", async () => {
    const result = await verifyResolution({
      path: "file.ts",
      languageId: "typescript",
      result: clean,
      current: clean,
      incoming: clean,
    });
    expect(result.checks.find((check) => check.kind === "types")?.status).toBe("pass");
    expect(result.checks.find((check) => check.kind === "lint")?.status).toBe("unknown");
    expect(result.hazardous).toBe(false);
    expect(result.overall).toBe("pass");
    expect(result.band).toBe("medium");
    expect(result.confidence).toBe(0.8);
  });

  it("fails a type error that neither side already had", async () => {
    const result = await verifyResolution({
      path: "file.ts",
      languageId: "typescript",
      result: mistyped,
      current: typed,
      incoming: typed,
    });
    const types = result.checks.find((check) => check.kind === "types");
    expect(types?.status).toBe("fail");
    expect(types?.diagnostics.some((item) => item.preExisting)).toBe(false);
    expect(result.hazardous).toBe(true);
    expect(result.band).toBe("low");
  });

  it("does not blame a type error that already exists on one side", async () => {
    const result = await verifyResolution({
      path: "file.ts",
      languageId: "typescript",
      result: mistyped,
      current: mistyped,
      incoming: typed,
    });
    const types = result.checks.find((check) => check.kind === "types");
    expect(types?.status).toBe("pass");
    expect(types?.diagnostics.every((item) => item.preExisting)).toBe(true);
    expect(result.hazardous).toBe(false);
  });

  it("leaves types unknown for a language without a type check", async () => {
    const result = await verifyResolution({
      path: "notes.txt",
      languageId: "plaintext",
      result: "a",
      current: "a",
      incoming: "b",
    });
    expect(result.checks.find((check) => check.kind === "types")?.status).toBe("unknown");
    expect(result.checks.find((check) => check.kind === "lint")?.reason).toMatch(/trusted/);
  });

  it("runs project lint only for a trusted workspace and ignores inline disables", async () => {
    const root = await mkdtemp(join(tmpdir(), "smartmerge-lint-"));
    roots.push(root);
    await writeFile(join(root, "package.json"), '{ "type": "module" }\n');
    await writeFile(
      join(root, "eslint.config.js"),
      'export default [{ files: ["**/*.ts"], rules: { "no-debugger": "error" } }];\n',
    );
    const untrusted = await verifyResolution({
      path: "file.ts",
      languageId: "typescript",
      result: "debugger;\n",
      current: typed,
      incoming: typed,
      projectRoot: root,
    });
    expect(untrusted.checks.find((check) => check.kind === "lint")?.status).toBe("unknown");

    const trusted = await verifyResolution({
      path: "file.ts",
      languageId: "typescript",
      result: "/* eslint-disable no-debugger */\ndebugger;\n",
      current: typed,
      incoming: typed,
      trusted: true,
      projectRoot: root,
    });
    const lint = trusted.checks.find((check) => check.kind === "lint");
    expect(lint?.status).toBe("fail");
    expect(lint?.diagnostics.some((item) => item.preExisting)).toBe(false);

    const inherited = await verifyResolution({
      path: "file.ts",
      languageId: "typescript",
      result: "debugger;\n",
      current: "debugger;\n",
      incoming: typed,
      trusted: true,
      projectRoot: root,
    });
    expect(inherited.checks.find((check) => check.kind === "lint")?.status).toBe("pass");
  });
});
