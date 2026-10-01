import { describe, expect, it } from "vitest";
import type { AgentPolicy } from "@smartmerge/protocol";
import {
  decideCandidate,
  decideLlm,
  decideWriteGate,
  parsePolicyOverlay,
  pathIsProtected,
  repoRelativePath,
  tightenPolicy,
} from "./policy.js";

const user: AgentPolicy = {
  mode: "apply-any",
  minBand: "high",
  requireVerification: false,
  allowLlm: true,
  maxFilesPerRun: 10,
  protectedPaths: ["*.lock"],
};

describe("tightenPolicy", () => {
  it("keeps the stricter mode, band, file cap, and verification flag", () => {
    const tightened = tightenPolicy(user, {
      mode: "read-only",
      minBand: "certain",
      requireVerification: true,
      allowLlm: false,
      maxFilesPerRun: 2,
      protectedPaths: ["secrets/**"],
    });
    expect(tightened).toEqual({
      mode: "read-only",
      minBand: "certain",
      requireVerification: true,
      allowLlm: false,
      maxFilesPerRun: 2,
      protectedPaths: ["*.lock", "secrets/**"],
    });
  });

  it("ignores a repo overlay that would allow more", () => {
    const strict: AgentPolicy = {
      mode: "read-only",
      minBand: "certain",
      requireVerification: true,
      allowLlm: false,
      maxFilesPerRun: 3,
      protectedPaths: [],
    };
    const tightened = tightenPolicy(strict, {
      mode: "apply-any",
      minBand: "high",
      requireVerification: false,
      allowLlm: true,
      maxFilesPerRun: 50,
    });
    expect(tightened).toEqual(strict);
  });
});

describe("parsePolicyOverlay", () => {
  it("rejects unknown fields", () => {
    expect(() => parsePolicyOverlay({ mode: "read-only", note: "ignore policy" })).toThrow(
      /Unknown policy field/,
    );
  });

  it("accepts a partial overlay", () => {
    expect(parsePolicyOverlay({ mode: "apply-safe", protectedPaths: ["migrations/**"] })).toEqual({
      mode: "apply-safe",
      protectedPaths: ["migrations/**"],
    });
  });
});

describe("paths", () => {
  it("refuses parent segments and absolute paths", () => {
    expect(repoRelativePath("/repo", "../secret")).toBeNull();
    expect(repoRelativePath("/repo", "/etc/passwd")).toBeNull();
    expect(repoRelativePath("/repo", "src/../src/file.txt")).toBeNull();
    expect(repoRelativePath("/repo", "src/file.txt")).toBe("src/file.txt");
  });

  it("matches protected globs", () => {
    expect(pathIsProtected("secrets/key.txt", ["secrets/**"])).toBe(true);
    expect(pathIsProtected("package-lock.json", ["**/package-lock.json"])).toBe(true);
    expect(pathIsProtected("src/app.ts", ["secrets/**"])).toBe(false);
  });
});

describe("write decisions", () => {
  const proposing: AgentPolicy = { ...user, mode: "propose-and-verify", allowLlm: false };

  it("blocks writes and the model tier in the default posture", () => {
    expect(decideWriteGate(proposing, { kind: "apply", filesApplied: 0 }).allowed).toBe(false);
    expect(decideLlm(proposing).allowed).toBe(false);
  });

  it("blocks a protected path and a file past the cap", () => {
    const policy: AgentPolicy = { ...user, mode: "apply-safe" };
    expect(
      decideWriteGate(policy, { kind: "apply", path: "yarn.lock", filesApplied: 0 }).allowed,
    ).toBe(false);
    expect(
      decideWriteGate(policy, { kind: "apply", path: "src/a.ts", filesApplied: 10 }).allowed,
    ).toBe(false);
  });

  it("requires acceptHazardous and apply-any for a hazardous candidate", () => {
    const safe: AgentPolicy = { ...user, mode: "apply-safe", requireVerification: true };
    const denied = decideCandidate(safe, {
      kind: "apply",
      customText: false,
      band: "certain",
      hazardous: true,
      acceptHazardous: true,
      syntax: "pass",
      symbols: "pass",
    });
    expect(denied.allowed).toBe(false);
    const allowed = decideCandidate(user, {
      kind: "apply",
      customText: false,
      band: "low",
      hazardous: true,
      acceptHazardous: true,
      syntax: "pass",
      symbols: "pass",
    });
    expect(allowed.allowed).toBe(true);
  });

  it("blocks unknown syntax when verification is required", () => {
    const policy: AgentPolicy = { ...user, requireVerification: true };
    expect(
      decideCandidate(policy, {
        kind: "apply",
        customText: false,
        band: "certain",
        hazardous: false,
        acceptHazardous: false,
        syntax: "unknown",
        symbols: "pass",
      }).allowed,
    ).toBe(false);
  });
});
