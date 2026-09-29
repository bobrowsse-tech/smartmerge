const SUPPORTED_RANGES = new Set(["1.0.0", "^1.0.0", "~1.0.0", "*", ">=1.0.0"]);

/** True when this daemon can speak the client's requested protocol range. */
export function protocolRangeSupported(range: string): boolean {
  return SUPPORTED_RANGES.has(range.trim());
}
