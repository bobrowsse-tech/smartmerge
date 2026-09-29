import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Find the built daemon entrypoint.
 * A packaged editor extension ships it beside the bundle. A workspace checkout uses the package build.
 */
export function daemonScript(): string {
  const fromEnv = process.env["SMARTMERGE_DAEMON"];
  if (fromEnv !== undefined && fromEnv.length > 0 && existsSync(fromEnv)) return fromEnv;
  const candidates = [
    new URL("../daemon/dist/bin.js", import.meta.url),
    new URL("./bin.js", import.meta.url),
    new URL("../../../daemon/dist/bin.js", import.meta.url),
  ];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (existsSync(path)) return path;
  }
  const here = fileURLToPath(new URL(".", import.meta.url));
  throw new Error(`Daemon is not built next to ${here}. Run pnpm build.`);
}
