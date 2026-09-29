import type { ConflictFile, OperationContext } from "@smartmerge/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { CancelledError, WorkerPool, workerPoolSize } from "./pool.js";

const operation: OperationContext = {
  operation: "merge",
  current: { label: "main", role: "ours", commitSha: "a" },
  incoming: { label: "incoming", role: "theirs", commitSha: "b" },
  mergeBaseSha: null,
};

const file: ConflictFile = {
  path: "file.txt",
  kind: "content",
  languageId: null,
  operation,
  hunks: [
    {
      id: "hunk:1",
      range: { startLine: 1, endLine: 5 },
      base: "",
      current: "alpha",
      incoming: "beta",
      temporal: {
        current: { side: "current", commits: [], changeClasses: [], ageMs: null },
        incoming: { side: "incoming", commits: [], changeClasses: [], ageMs: null },
        base: { side: "base", commits: [], changeClasses: [], ageMs: null },
        incomingNewerByMs: null,
      },
      semanticChanges: [],
    },
  ],
};

describe("workerPoolSize", () => {
  it("keeps a worker on a one-core machine and caps larger machines at 4", () => {
    expect(workerPoolSize(1)).toBe(1);
    expect(workerPoolSize(2)).toBe(1);
    expect(workerPoolSize(8)).toBe(4);
  });
});

describe("WorkerPool", () => {
  let pool: WorkerPool | undefined;

  afterEach(async () => {
    await pool?.stop();
  });

  it("returns stub proposals from a worker", async () => {
    pool = newPool();
    const proposals = await pool.run({ file, delayMs: 0 }, new AbortController().signal);
    expect(proposals[0]?.recommended).toBeNull();
    expect(proposals[0]?.candidates).toHaveLength(2);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    pool = newPool();
    const controller = new AbortController();
    controller.abort();
    await expect(pool.run({ file, delayMs: 0 }, controller.signal)).rejects.toBeInstanceOf(
      CancelledError,
    );
  });

  it("ignores a worker result that arrives after cancellation", async () => {
    pool = newPool();
    const controller = new AbortController();
    const pending = pool.run({ file, delayMs: 300 }, controller.signal);
    setTimeout(() => {
      controller.abort();
    }, 20);
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });
  });
});

function newPool(): WorkerPool {
  return new WorkerPool(1, new URL("../dist/worker.js", import.meta.url));
}
