import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { AuditRecord, SessionLogEntry } from "@smartmerge/protocol";
import { git } from "./run.js";

/**
 * Write `bytes` by staging a temp file in the same directory, syncing it, then renaming.
 * The destination is replaced only by the rename, so a crash before that leaves the old bytes.
 */
export async function writeAtomic(target: string, bytes: Buffer): Promise<void> {
  const temp = await stageAtomic(target, bytes);
  await commitAtomic(temp, target);
}

/** Sync `bytes` to a sibling temp file and return that path. The destination is unchanged. */
export async function stageAtomic(target: string, bytes: Buffer): Promise<string> {
  const temp = `${target}.${randomUUID()}.smartmerge-tmp`;
  const handle = await open(temp, "w");
  try {
    await handle.write(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(temp, { force: true });
    throw error;
  }
  await handle.close();
  return temp;
}

/** Replace `target` with a staged temp file. */
export async function commitAtomic(temp: string, target: string): Promise<void> {
  await rename(temp, target);
}

/**
 * Copy the working file into `.git/smartmerge/backups/` and return the backup id.
 * The copy is the raw bytes, so undo can restore them exactly.
 */
export async function backupWorkingFile(
  repoRoot: string,
  path: string,
): Promise<{ id: string; bytes: Buffer }> {
  const absolute = resolveInside(repoRoot, path);
  const bytes = await readFile(absolute);
  const id = randomUUID();
  const gitDir = await gitDirectory(repoRoot);
  const backups = resolve(gitDir, "smartmerge", "backups");
  await mkdir(backups, { recursive: true });
  await writeAtomic(resolve(backups, id), bytes);
  return { id, bytes };
}

/** Restore a backup over the working file with an atomic replace. */
export async function restoreBackup(
  repoRoot: string,
  backupId: string,
  path: string,
): Promise<void> {
  if (!isBackupId(backupId)) throw new Error(`Invalid backup id ${backupId}`);
  const gitDir = await gitDirectory(repoRoot);
  const bytes = await readFile(resolve(gitDir, "smartmerge", "backups", backupId));
  await writeAtomic(resolveInside(repoRoot, path), bytes);
}

/** Append one session-log record under `.git/smartmerge/`. */
export async function appendSessionLog(repoRoot: string, entry: SessionLogEntry): Promise<void> {
  const gitDir = await gitDirectory(repoRoot);
  const dir = resolve(gitDir, "smartmerge");
  await mkdir(dir, { recursive: true });
  const line = `${JSON.stringify(entry)}\n`;
  const target = resolve(dir, "log.jsonl");
  const handle = await open(target, "a");
  try {
    await handle.write(line);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Append one audit record under `.git/smartmerge/audit.jsonl`. The file stays on this machine. */
export async function appendAuditRecord(repoRoot: string, record: AuditRecord): Promise<void> {
  const gitDir = await gitDirectory(repoRoot);
  const dir = resolve(gitDir, "smartmerge");
  await mkdir(dir, { recursive: true });
  const handle = await open(resolve(dir, "audit.jsonl"), "a");
  try {
    await handle.write(`${JSON.stringify(record)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Read the local audit log. A missing file is an empty list. */
export async function readAuditLog(repoRoot: string): Promise<AuditRecord[]> {
  const gitDir = await gitDirectory(repoRoot);
  let text: string;
  try {
    text = await readFile(resolve(gitDir, "smartmerge", "audit.jsonl"), "utf8");
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const records: AuditRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const value: unknown = JSON.parse(line);
    if (!isAuditRecord(value)) throw new Error("Audit record is invalid");
    records.push(value);
  }
  return records;
}

/** Read the on-disk session log. A missing log is an empty list. */
export async function readSessionLog(repoRoot: string): Promise<SessionLogEntry[]> {
  const gitDir = await gitDirectory(repoRoot);
  let text: string;
  try {
    text = await readFile(resolve(gitDir, "smartmerge", "log.jsonl"), "utf8");
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const entries: SessionLogEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const value: unknown = JSON.parse(line);
    if (!isLogEntry(value)) throw new Error("Session log entry is invalid");
    entries.push(value);
  }
  return entries;
}

function isAuditRecord(value: unknown): value is AuditRecord {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || !("at" in value) || !("actor" in value) || !("tool" in value)) {
    return false;
  }
  if (!("outcome" in value) || !("message" in value)) return false;
  const outcome = value.outcome;
  return (
    typeof value.id === "string" &&
    typeof value.at === "string" &&
    typeof value.tool === "string" &&
    typeof value.message === "string" &&
    (outcome === "ok" || outcome === "blocked" || outcome === "error") &&
    isActor(value.actor)
  );
}

function isActor(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  if (value.kind === "human" || value.kind === "ci") return true;
  return value.kind === "agent" && "name" in value && typeof value.name === "string";
}

function isLogEntry(value: unknown): value is SessionLogEntry {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || !("path" in value) || !("backupId" in value)) return false;
  if (!("hunkId" in value) || !("at" in value) || !("action" in value) || !("actor" in value)) {
    return false;
  }
  const action = value.action;
  return (
    typeof value.id === "string" &&
    typeof value.path === "string" &&
    typeof value.backupId === "string" &&
    typeof value.hunkId === "string" &&
    typeof value.at === "string" &&
    (action === "accepted" ||
      action === "edited" ||
      action === "auto-applied" ||
      action === "undone")
  );
}

/** Read the working file as raw bytes. */
export async function readWorkingBytes(repoRoot: string, path: string): Promise<Buffer> {
  return readFile(resolveInside(repoRoot, path));
}

async function gitDirectory(repoRoot: string): Promise<string> {
  const { stdout } = await git(repoRoot, ["rev-parse", "--git-dir"]);
  const dir = stdout.trim();
  return isAbsolute(dir) ? dir : resolve(repoRoot, dir);
}

function resolveInside(root: string, path: string): string {
  const absolute = resolve(root, path);
  const fromRoot = relative(root, absolute);
  if (fromRoot.length === 0 || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`Path escapes the repository: ${path}`);
  }
  return absolute;
}

function isBackupId(id: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(id);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
