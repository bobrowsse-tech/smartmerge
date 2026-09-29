import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./index.js";

describe("protocol", () => {
  it("publishes a protocol version", () => {
    expect(PROTOCOL_VERSION).toBe("1.0.0");
  });
});
