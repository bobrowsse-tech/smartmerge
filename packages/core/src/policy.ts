import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentPolicy, CheckStatus, ConfidenceBand } from "@smartmerge/protocol";

const MODE_RANK = {
  "read-only": 0,
  "propose-and-verify": 1,
  "apply-safe": 2,
  "apply-any": 3,
} as const;

const BAND_RANK: Record<ConfidenceBand, number> = {
  low: 0,
  medium: 1,
  high: 2,
  certain: 3,
};

/** A refused agent action. The message is safe to show; it never includes repository text. */
export interface PolicyDenial {
  code: "POLICY_BLOCKED";
  message: string;
  hint: string;
}

export type PolicyDecision = { allowed: true } | ({ allowed: false } & PolicyDenial);

/**
 * Combine a user policy with a repo policy.
 * The repo can only tighten: a stricter mode, a higher band, fewer files, more protected paths,
 * verification required, or the model tier forced off.
 */
export function tightenPolicy(user: AgentPolicy, repo: Partial<AgentPolicy>): AgentPolicy {
  const mode =
    repo.mode !== undefined && MODE_RANK[repo.mode] < MODE_RANK[user.mode] ? repo.mode : user.mode;
  const minBand = tighterBand(user.minBand, repo.minBand);
  const maxFilesPerRun =
    repo.maxFilesPerRun !== undefined
      ? Math.min(user.maxFilesPerRun, repo.maxFilesPerRun)
      : user.maxFilesPerRun;
  return {
    mode,
    minBand,
    requireVerification: user.requireVerification || repo.requireVerification === true,
    allowLlm: user.allowLlm && repo.allowLlm !== false,
    maxFilesPerRun,
    protectedPaths: uniquePaths([...user.protectedPaths, ...(repo.protectedPaths ?? [])]),
  };
}

/**
 * Parse a policy overlay from JSON.
 * Unknown fields are rejected so a comment or a typo cannot change the meaning.
 */
export function parsePolicyOverlay(value: unknown): Partial<AgentPolicy> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Policy file must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "mode",
    "minBand",
    "requireVerification",
    "allowLlm",
    "maxFilesPerRun",
    "protectedPaths",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`Unknown policy field ${key}.`);
  }
  const overlay: Partial<AgentPolicy> = {};
  if ("mode" in record) {
    const mode = record["mode"];
    if (
      mode !== "read-only" &&
      mode !== "propose-and-verify" &&
      mode !== "apply-safe" &&
      mode !== "apply-any"
    ) {
      throw new Error("Policy mode is not recognized.");
    }
    overlay.mode = mode;
  }
  if ("minBand" in record) {
    const minBand = record["minBand"];
    if (minBand !== "certain" && minBand !== "high") {
      throw new Error("Policy minBand must be certain or high.");
    }
    overlay.minBand = minBand;
  }
  if ("requireVerification" in record) {
    if (typeof record["requireVerification"] !== "boolean") {
      throw new Error("Policy requireVerification must be a boolean.");
    }
    overlay.requireVerification = record["requireVerification"];
  }
  if ("allowLlm" in record) {
    if (typeof record["allowLlm"] !== "boolean") {
      throw new Error("Policy allowLlm must be a boolean.");
    }
    overlay.allowLlm = record["allowLlm"];
  }
  if ("maxFilesPerRun" in record) {
    const maxFiles = record["maxFilesPerRun"];
    if (
      typeof maxFiles !== "number" ||
      !Number.isInteger(maxFiles) ||
      maxFiles < 1 ||
      maxFiles > 500
    ) {
      throw new Error("Policy maxFilesPerRun must be an integer from 1 to 500.");
    }
    overlay.maxFilesPerRun = maxFiles;
  }
  if ("protectedPaths" in record) {
    const paths = record["protectedPaths"];
    if (!Array.isArray(paths) || !paths.every((item) => typeof item === "string")) {
      throw new Error("Policy protectedPaths must be an array of strings.");
    }
    if (paths.some((item) => item.includes("..") || item.includes("\0") || item.length > 200)) {
      throw new Error("A protected path glob is not allowed.");
    }
    overlay.protectedPaths = paths;
  }
  return overlay;
}

/**
 * Repo-relative POSIX path, or null when the input leaves the repository.
 * Absolute paths, parent segments, and NUL bytes are refused before any file is read.
 */
export function repoRelativePath(repoRoot: string, input: string): string | null {
  if (input.length === 0 || input.length > 500 || input.includes("\0") || input.includes("\n")) {
    return null;
  }
  if (isAbsolute(input) || /^[A-Za-z]:[\\/]/.test(input)) return null;
  const portable = input.replaceAll("\\", "/");
  if (portable.split("/").some((part) => part === "..")) return null;
  const absolute = resolve(repoRoot, portable);
  const fromRoot = relative(repoRoot, absolute);
  if (fromRoot.length === 0 || fromRoot.startsWith("..") || isAbsolute(fromRoot)) return null;
  return fromRoot.split(sep).join("/");
}

/** True when `path` matches any protected glob. Globs use `*` inside a segment and `**` across segments. */
export function pathIsProtected(path: string, globs: readonly string[]): boolean {
  const portable = path.replaceAll("\\", "/");
  return globs.some((glob) => globToRegExp(glob).test(portable));
}

/** Whether the model tier may run. The default policy keeps it off. */
export function decideLlm(policy: AgentPolicy): PolicyDecision {
  if (policy.allowLlm) return { allowed: true };
  return deny(
    "The model tier is off for this agent.",
    "Leave useLlm unset. A repository policy cannot turn the model tier on.",
  );
}

/**
 * Mode, path, and file-count gate for a write.
 * Call this before reading a candidate. Candidate quality is a separate decision.
 */
export function decideWriteGate(
  policy: AgentPolicy,
  request: {
    kind: "apply" | "apply-all" | "undo";
    path?: string;
    filesApplied: number;
    pathAlreadyCounted?: boolean;
  },
): PolicyDecision {
  if (request.kind === "undo") {
    if (policy.mode === "read-only") {
      return deny(
        "Read-only agent policy does not allow undo.",
        "A person can restore the backup from the command line.",
      );
    }
    return { allowed: true };
  }
  if (policy.mode === "read-only" || policy.mode === "propose-and-verify") {
    return deny(
      "This agent policy does not allow writes.",
      "Start the server with an apply policy, or ask a person to apply the resolution.",
    );
  }
  if (request.path !== undefined && pathIsProtected(request.path, policy.protectedPaths)) {
    return deny(
      "This path is protected by agent policy.",
      "Protected paths are never written by an agent.",
    );
  }
  if (request.pathAlreadyCounted !== true && request.filesApplied >= policy.maxFilesPerRun) {
    return deny(
      "This run has reached the file limit.",
      "Raise maxFilesPerRun only in user policy. A repository policy cannot raise it.",
    );
  }
  return { allowed: true };
}

/**
 * Whether one candidate or custom text may be written under the current policy.
 * Syntax and symbols must pass when verification is required. Types and lint may still be unknown.
 */
export function decideCandidate(
  policy: AgentPolicy,
  request: {
    kind: "apply" | "apply-all";
    customText: boolean;
    band?: ConfidenceBand;
    hazardous: boolean;
    acceptHazardous: boolean;
    syntax: CheckStatus;
    symbols: CheckStatus;
  },
): PolicyDecision {
  if (request.customText && policy.mode !== "apply-any") {
    return deny(
      "Custom resolution text needs an apply-any policy.",
      "Apply a ranked candidate, or start the server with apply-any.",
    );
  }
  if (request.hazardous && !(request.acceptHazardous && policy.mode === "apply-any")) {
    return deny(
      "A hazardous candidate is not applied.",
      "Pass acceptHazardous and use an apply-any policy, or revise the text.",
    );
  }
  if (policy.requireVerification && (request.syntax !== "pass" || request.symbols !== "pass")) {
    return deny(
      "Syntax and symbol checks have not passed.",
      "Revise the resolution, or leave it for a person. Unknown types or lint do not block.",
    );
  }
  const needsBand = request.kind === "apply-all" || policy.mode === "apply-safe";
  if (needsBand) {
    if (request.band === undefined || !bandMeets(request.band, policy.minBand)) {
      return deny(
        "This candidate is below the policy band.",
        "Choose a certain or high candidate, or ask a person to apply a lower band.",
      );
    }
  }
  return { allowed: true };
}

function tighterBand(
  user: AgentPolicy["minBand"],
  repo: AgentPolicy["minBand"] | undefined,
): AgentPolicy["minBand"] {
  if (repo === undefined) return user;
  return user === "certain" || repo === "certain" ? "certain" : "high";
}

function bandMeets(band: ConfidenceBand, minBand: AgentPolicy["minBand"]): boolean {
  const minimum = minBand === "certain" ? BAND_RANK.certain : BAND_RANK.high;
  return BAND_RANK[band] >= minimum;
}

function deny(message: string, hint: string): PolicyDecision {
  return { allowed: false, code: "POLICY_BLOCKED", message, hint };
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function globToRegExp(glob: string): RegExp {
  let pattern = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      if (glob[index + 2] === "/") {
        pattern += "(?:.*/)?";
        index += 2;
      } else {
        pattern += ".*";
        index += 1;
      }
      continue;
    }
    if (char === "*") {
      pattern += "[^/]*";
      continue;
    }
    if (char === "?") {
      pattern += "[^/]";
      continue;
    }
    if (char !== undefined && "\\.^$+()[]{}|".includes(char)) pattern += `\\${char}`;
    else pattern += char ?? "";
  }
  return new RegExp(`${pattern}$`);
}
