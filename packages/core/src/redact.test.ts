import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("replaces credential-shaped text and leaves ordinary code", () => {
    const source = 'const name = "alpha";\nconst token = "ghp_abcdefghijklmnopqrstuvwxyz";\n';
    const redacted = redactSecrets(source);
    expect(redacted.redactions).toBe(1);
    expect(redacted.text).toContain('const name = "alpha"');
    expect(redacted.text).not.toContain("ghp_");
    expect(redacted.text).toContain("[redacted]");
  });
});
