import { beforeAll, describe, expect, it } from "vitest";
import { initParsers } from "./parse.js";
import { verifyResolution } from "./verify.js";

const clean = "function f(a: number) {\n  return a;\n}\n";

beforeAll(async () => {
  await initParsers();
});

describe("verifyResolution", () => {
  it("fails a dropped brace and leaves types and lint unrun", () => {
    const result = verifyResolution({
      path: "file.ts",
      languageId: "typescript",
      result: "function f(a: number) {\n  return a;\n",
      current: clean,
      incoming: clean,
    });
    expect(result.hazardous).toBe(true);
    expect(result.overall).toBe("fail");
    expect(result.band).toBe("low");
    expect(result.checks.find((check) => check.kind === "types")?.status).toBe("unknown");
    expect(result.checks.find((check) => check.kind === "lint")?.status).toBe("unknown");
  });

  it("does not call a clean copy certain while type checks have not run", () => {
    const result = verifyResolution({
      path: "file.ts",
      languageId: "typescript",
      result: clean,
      current: clean,
      incoming: clean,
    });
    expect(result.hazardous).toBe(false);
    expect(result.overall).toBe("unknown");
    expect(result.band).toBe("medium");
  });
});
