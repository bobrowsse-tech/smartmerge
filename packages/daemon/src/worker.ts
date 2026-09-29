import { parentPort } from "node:worker_threads";
import { initParsers, proposeForFile } from "@smartmerge/core";
import type { WorkerRequest } from "./jobs.js";

const ready = initParsers().catch(() => undefined);

const cancelled = new Set<string>();

parentPort?.on("message", (message: WorkerRequest) => {
  if (message.kind === "cancel") {
    cancelled.add(message.jobId);
    return;
  }
  const finish = (): void => {
    void ready.then(() => {
      if (cancelled.delete(message.jobId)) return;
      try {
        parentPort?.postMessage({
          kind: "result",
          jobId: message.jobId,
          proposals: proposeForFile(message.file, new Set(message.knownBaseHunkIds)),
        });
      } catch (error) {
        const text = error instanceof Error ? error.message : "Worker failed";
        parentPort?.postMessage({ kind: "error", jobId: message.jobId, message: text });
      }
    });
  };
  if (message.delayMs > 0) {
    setTimeout(finish, message.delayMs);
    return;
  }
  finish();
});
