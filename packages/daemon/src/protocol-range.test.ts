import { describe, expect, it } from "vitest";
import { protocolRangeSupported } from "./protocol-range.js";

describe("protocolRangeSupported", () => {
  it("accepts the current protocol and refuses an unknown range", () => {
    expect(protocolRangeSupported("1.0.0")).toBe(true);
    expect(protocolRangeSupported("^1.0.0")).toBe(true);
    expect(protocolRangeSupported("2.0.0")).toBe(false);
  });
});
