import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { daemonScript } from "./daemon-path.js";

describe("editor daemon path", () => {
  it("finds the built daemon in the workspace", () => {
    expect(daemonScript().replaceAll("\\", "/")).toMatch(/packages\/daemon\/dist\/bin\.js$/);
  });

  it("uses the registry publisher id", () => {
    const parsed: unknown = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    if (typeof parsed !== "object" || parsed === null || !("publisher" in parsed)) {
      throw new Error("extension package is missing a publisher");
    }
    expect(parsed.publisher).toBe("bobrowsse-tech");
  });
});
