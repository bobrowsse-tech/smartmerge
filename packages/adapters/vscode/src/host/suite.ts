import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";

/** Editor-host checks against the temporary conflict repository. */
export async function run(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) throw new Error("The test project folder is missing.");
  const extension = vscode.extensions.all.find(
    (item) => packageName(item.packageJSON) === "smartmerge-resolver",
  );
  if (!extension) throw new Error("The editor extension is not loaded.");

  const started = performance.now();
  await extension.activate();
  const recorded = (globalThis as { smartmergeActivationMs?: number }).smartmergeActivationMs;
  const activationMs = recorded ?? performance.now() - started;
  assert.ok(activationMs < 100, `activation took ${activationMs.toFixed(1)} ms`);

  const file = join(folder, "file.txt");
  const before = await readFile(file);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(document);
  const lenses = await vscode.commands.executeCommand<readonly vscode.CodeLens[] | undefined>(
    "vscode.executeCodeLensProvider",
    document.uri,
  );
  assert.ok(lenses);
  assert.ok(lenses.some((lens) => lens.command?.command === "smartmerge.acceptFile"));
  assert.ok(lenses.some((lens) => lens.command?.title === "Compare"));
  assert.ok(lenses.some((lens) => lens.command?.title === "Explain"));

  const first = await vscode.commands.executeCommand<string | null>("smartmerge.openPanel");
  await vscode.commands.executeCommand("smartmerge.nextConflict");
  const second = await vscode.commands.executeCommand<string | null>("smartmerge.currentConflict");
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first, second);

  await vscode.commands.executeCommand("smartmerge.acceptFile", "file.txt");
  const applied = await readFile(file, "utf8");
  assert.equal(applied.includes("<<<<<<<"), false);
  assert.equal(applied.trim(), "value");
  await vscode.commands.executeCommand("smartmerge.undo");
  assert.deepEqual(await readFile(file), before);
}

function packageName(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("name" in value)) return undefined;
  return typeof value.name === "string" ? value.name : undefined;
}
