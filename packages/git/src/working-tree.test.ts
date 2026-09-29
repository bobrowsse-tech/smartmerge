import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  backupWorkingFile,
  commitAtomic,
  restoreBackup,
  stageAtomic,
  writeAtomic,
} from "./working-tree.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("atomic writes", () => {
  it("leaves the original bytes in place until the staged file is renamed", async () => {
    const root = await mkdtemp(join(tmpdir(), "smartmerge-atomic-"));
    roots.push(root);
    const target = join(root, "file.txt");
    await writeFile(target, "old\n");
    const temp = await stageAtomic(target, Buffer.from("new\n"));
    expect(await readFile(target, "utf8")).toBe("old\n");
    await rm(temp);
    expect(await readFile(target, "utf8")).toBe("old\n");
    await commitAtomic(await stageAtomic(target, Buffer.from("new\n")), target);
    expect(await readFile(target, "utf8")).toBe("new\n");
  });

  it("restores a backup byte for byte", async () => {
    const root = await gitRepo();
    const target = join(root, "file.txt");
    const original = Buffer.from("alpha\nbeta\n");
    await writeFile(target, original);
    const backup = await backupWorkingFile(root, "file.txt");
    await writeAtomic(target, Buffer.from("replaced\n"));
    await restoreBackup(root, backup.id, "file.txt");
    expect(await readFile(target)).toEqual(original);
  }, 20_000);

  it("rejects a path that leaves the repository and a backup id that is not a file name", async () => {
    const root = await gitRepo();
    await writeFile(join(root, "file.txt"), "alpha\n");
    await expect(backupWorkingFile(root, "../outside.txt")).rejects.toThrow(/escapes/);
    await expect(restoreBackup(root, "../outside", "file.txt")).rejects.toThrow(/Invalid backup/);
    await expect(restoreBackup(root, "not-a-uuid", "file.txt")).rejects.toThrow(/Invalid backup/);
  });
});

async function gitRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smartmerge-backup-"));
  roots.push(root);
  await execFileAsync("git", ["init", "-b", "main"], { cwd: root, windowsHide: true });
  return root;
}
