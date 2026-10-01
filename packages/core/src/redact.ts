const PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /((?:api[_-]?key|secret|password|token)\s*[:=]\s*['"])(?!\[redacted\])[^'"]{8,}(['"])/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
];

/**
 * Replace likely secrets with a fixed marker.
 * Repository text is still untrusted after this; redaction only removes credential-shaped strings.
 */
export function redactSecrets(text: string): { text: string; redactions: number } {
  let redactions = 0;
  let next = text;
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    next = next.replace(pattern, (...args: unknown[]) => {
      redactions += 1;
      const prefix = args[1];
      const suffix = args[2];
      if (typeof prefix === "string" && typeof suffix === "string") {
        return `${prefix}[redacted]${suffix}`;
      }
      return "[redacted]";
    });
  }
  return { text: next, redactions };
}
