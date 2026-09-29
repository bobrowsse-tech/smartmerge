import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

describe("editor bundle", () => {
  it("stays under the gzip budget and contains the panel", () => {
    const source = readFileSync(new URL("../dist/extension.js", import.meta.url), "utf8");
    expect(source).not.toContain('from "@smartmerge/ui"');
    expect(source).toContain("SmartMergeResolver");
    expect(gzipSync(source).length).toBeLessThan(300 * 1024);
  });
});
