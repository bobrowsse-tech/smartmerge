import { parentPort } from "node:worker_threads";
import {
  initParsers,
  isStructuralLanguage,
  proposeForFile,
  verifyResolution,
} from "@smartmerge/core";
import type { WorkerRequest } from "./jobs.js";

let ready: Promise<void> | null = null;

/** Load syntax parsers once, and only for a language that uses them. */
function ensureParsers(): Promise<void> {
  ready ??= initParsers().catch(() => undefined);
  return ready;
}

const cancelled = new Set<string>();

parentPort?.on("message", (message: WorkerRequest) => {
  if (message.kind === "cancel") {
    cancelled.add(message.jobId);
    return;
  }
  if (message.kind === "verify") {
    const finishVerify = (): void => {
      if (cancelled.delete(message.jobId)) return;
      try {
        parentPort?.postMessage({
          kind: "verified",
          jobId: message.jobId,
          result: verifyResolution({
            path: message.path,
            languageId: message.languageId,
            result: message.result,
            current: message.current,
            incoming: message.incoming,
          }),
        });
      } catch (error) {
        const text = error instanceof Error ? error.message : "Worker failed";
        parentPort?.postMessage({ kind: "error", jobId: message.jobId, message: text });
      }
    };
    void ensureParsers().then(finishVerify);
    return;
  }
  const finish = (): void => {
    const run = (): void => {
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
    };
    if (isStructuralLanguage(message.file.languageId)) {
      void ensureParsers().then(run);
      return;
    }
    run();
  };
  if (message.delayMs > 0) {
    setTimeout(finish, message.delayMs);
    return;
  }
  finish();
});
