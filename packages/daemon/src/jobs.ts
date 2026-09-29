import type { ConflictFile, ResolutionProposal } from "@smartmerge/protocol";

export interface ProposeJob {
  kind: "propose";
  jobId: string;
  file: ConflictFile;
  delayMs: number;
  knownBaseHunkIds: string[];
}

export type WorkerRequest = ProposeJob | { kind: "cancel"; jobId: string };

export type WorkerResponse =
  | { kind: "result"; jobId: string; proposals: ResolutionProposal[] }
  | { kind: "error"; jobId: string; message: string };

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== "object" || value === null || !("kind" in value) || !("jobId" in value))
    return false;
  const kind = value.kind;
  const jobId = value.jobId;
  if (typeof jobId !== "string") return false;
  return kind === "result" || kind === "error";
}
