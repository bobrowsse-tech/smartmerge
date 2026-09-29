import { availableParallelism } from "node:os";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { ResolutionProposal, VerifyResult } from "@smartmerge/protocol";
import { isWorkerResponse, type ProposeJob, type VerifyJob, type WorkerRequest } from "./jobs.js";

/** Raised when an {@link AbortSignal} cancels a pool job. */
export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

/**
 * Worker count for the daemon pool: one less than the machine's parallelism, capped at 4.
 * A one-core machine still gets a single worker.
 */
export function workerPoolSize(parallelism: number = availableParallelism()): number {
  if (!Number.isFinite(parallelism) || parallelism < 1) return 1;
  return Math.min(4, Math.max(1, Math.floor(parallelism) - 1));
}

interface Pending {
  signal: AbortSignal;
  resolve: (proposals: ResolutionProposal[]) => void;
  reject: (error: Error) => void;
  onAbort: () => void;
}

interface VerifyPending {
  signal: AbortSignal;
  resolve: (result: VerifyResult) => void;
  reject: (error: Error) => void;
  onAbort: () => void;
}

/**
 * Lazy worker pool. Jobs are structured-cloned to a worker and can be cancelled
 * with an {@link AbortSignal}. A result that arrives after cancellation is ignored.
 */
export class WorkerPool {
  private readonly workers: Worker[] = [];
  private readonly pending = new Map<string, Pending>();
  private readonly pendingVerify = new Map<string, VerifyPending>();
  private readonly jobsByWorker = new Map<Worker, Set<string>>();
  private cursor = 0;
  private stopped = false;

  constructor(
    private readonly size: number,
    private readonly workerUrl: URL,
  ) {
    if (size < 1) throw new Error("Worker pool size must be at least 1");
  }

  run(job: Omit<ProposeJob, "jobId" | "kind">, signal: AbortSignal): Promise<ResolutionProposal[]> {
    if (this.stopped) return Promise.reject(new Error("Worker pool is stopped"));
    if (signal.aborted) return Promise.reject(new CancelledError());
    const jobId = randomUUID();
    const worker = this.nextWorker();
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const current = this.pending.get(jobId);
        if (!current) return;
        this.pending.delete(jobId);
        this.jobsByWorker.get(worker)?.delete(jobId);
        worker.postMessage({ kind: "cancel", jobId } satisfies WorkerRequest);
        current.reject(new CancelledError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending.set(jobId, { signal, resolve, reject, onAbort });
      this.jobsByWorker.get(worker)?.add(jobId);
      const message: ProposeJob = {
        kind: "propose",
        jobId,
        file: job.file,
        delayMs: job.delayMs,
        knownBaseHunkIds: job.knownBaseHunkIds,
      };
      worker.postMessage(message);
    });
  }

  /** Check a resolution in a worker. This does not write the file. */
  verify(job: Omit<VerifyJob, "jobId" | "kind">, signal: AbortSignal): Promise<VerifyResult> {
    if (this.stopped) return Promise.reject(new Error("Worker pool is stopped"));
    if (signal.aborted) return Promise.reject(new CancelledError());
    const jobId = randomUUID();
    const worker = this.nextWorker();
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const current = this.pendingVerify.get(jobId);
        if (!current) return;
        this.pendingVerify.delete(jobId);
        this.jobsByWorker.get(worker)?.delete(jobId);
        worker.postMessage({ kind: "cancel", jobId } satisfies WorkerRequest);
        current.reject(new CancelledError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.pendingVerify.set(jobId, { signal, resolve, reject, onAbort });
      this.jobsByWorker.get(worker)?.add(jobId);
      const message: VerifyJob = { kind: "verify", jobId, ...job };
      worker.postMessage(message);
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const [jobId, pending] of this.pending) {
      this.pending.delete(jobId);
      pending.reject(new CancelledError());
    }
    for (const [jobId, pending] of this.pendingVerify) {
      this.pendingVerify.delete(jobId);
      pending.reject(new CancelledError());
    }
    const workers = this.workers.splice(0);
    this.jobsByWorker.clear();
    await Promise.all(workers.map((worker) => worker.terminate()));
  }

  private nextWorker(): Worker {
    if (this.workers.length < this.size) {
      const worker = new Worker(this.workerUrl);
      worker.on("message", (message: unknown) => {
        this.onMessage(message);
      });
      worker.on("error", (error: Error) => {
        this.onWorkerError(worker, error);
      });
      this.workers.push(worker);
      this.jobsByWorker.set(worker, new Set());
      return worker;
    }
    const worker = this.workers[this.cursor % this.workers.length];
    this.cursor += 1;
    if (!worker) throw new Error("Worker pool is empty");
    return worker;
  }

  private onMessage(message: unknown): void {
    if (!isWorkerResponse(message)) return;
    if (message.kind === "verified" || this.pendingVerify.has(message.jobId)) {
      const verifying = this.pendingVerify.get(message.jobId);
      if (!verifying) return;
      this.pendingVerify.delete(message.jobId);
      verifying.signal.removeEventListener("abort", verifying.onAbort);
      if (message.kind === "error") verifying.reject(new Error(message.message));
      else if (message.kind === "verified") verifying.resolve(message.result);
      return;
    }
    const pending = this.pending.get(message.jobId);
    if (!pending) return;
    this.pending.delete(message.jobId);
    pending.signal.removeEventListener("abort", pending.onAbort);
    if (message.kind === "error") {
      pending.reject(new Error(message.message));
      return;
    }
    pending.resolve(message.proposals);
  }

  private onWorkerError(worker: Worker, error: Error): void {
    const jobs = this.jobsByWorker.get(worker);
    this.jobsByWorker.delete(worker);
    const index = this.workers.indexOf(worker);
    if (index >= 0) this.workers.splice(index, 1);
    if (!jobs) return;
    for (const jobId of jobs) {
      const pending = this.pending.get(jobId);
      if (pending) {
        this.pending.delete(jobId);
        pending.reject(error);
      }
      const verifying = this.pendingVerify.get(jobId);
      if (verifying) {
        this.pendingVerify.delete(jobId);
        verifying.reject(error);
      }
    }
  }
}
