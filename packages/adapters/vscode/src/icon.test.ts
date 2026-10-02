import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("developer contact", () => {
  it("uses the public name, site, and address", () => {
    const source = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const manifest: unknown = JSON.parse(source);
    if (typeof manifest !== "object" || manifest === null) throw new Error("manifest");
    const record = manifest as Record<string, unknown>;
    expect(record["publisher"]).toBe("bobrowsse-tech");
    expect(record["author"]).toBe("Bob Rowsse Walakira <hello@bobrowsse.com>");
    expect(record["homepage"]).toBe("https://bobrowsse.com");
    const bugs = record["bugs"];
    if (typeof bugs !== "object" || bugs === null) throw new Error("bugs");
    expect((bugs as Record<string, unknown>)["email"]).toBe("hello@bobrowsse.com");
    expect(source).not.toContain("gmail.com");
    const pack = readFileSync(new URL("./pack.ts", import.meta.url), "utf8");
    expect(pack).toContain('author: record["author"]');
    expect(pack).toContain('homepage: record["homepage"]');
    expect(pack).toContain('bugs: record["bugs"]');
  });
});

describe("editor listing icon", () => {
  it("is a square PNG with a transparent background", () => {
    const buf = readFileSync(new URL("../../../../assets/logo.png", import.meta.url));
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const length = buf.readUInt32BE(8);
    expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
    const ihdr = buf.subarray(16, 16 + length);
    expect(ihdr.readUInt32BE(0)).toBe(256);
    expect(ihdr.readUInt32BE(4)).toBe(256);
    expect(ihdr[9]).toBe(6);

    const chunks: Buffer[] = [];
    let offset = 8;
    while (offset < buf.length) {
      const size = buf.readUInt32BE(offset);
      const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
      if (type === "IDAT") chunks.push(buf.subarray(offset + 8, offset + 8 + size));
      offset += 12 + size;
    }
    const raw = inflateSync(Buffer.concat(chunks));
    // First row has no pixel above it, so None and Up both store the corner color directly.
    expect(raw[0] === 0 || raw[0] === 2).toBe(true);
    expect([...raw.subarray(1, 5)]).toEqual([0, 0, 0, 0]);
  });
});
