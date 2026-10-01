import type { ConflictFile, ResolutionProposal, VerifyResult } from "@smartmerge/protocol";

export interface ProposeJob {
  kind: "propose";
  jobId: string;
  file: ConflictFile;
  delayMs: number;
  knownBaseHunkIds: string[];
}

export interface VerifyJob {
  kind: "verify";
  jobId: string;
  path: string;
  languageId: string | null;
  result: string;
  current: string;
  incoming: string;
  /** Taken from initialization. Project lint runs only when this is true. */
  trusted: boolean;
  projectRoot?: string;
  fileText?: string;
  startLine?: number;
  endLine?: number;
}

export type WorkerRequest = ProposeJob | VerifyJob | { kind: "cancel"; jobId: string };

export type WorkerResponse =
  | { kind: "result"; jobId: string; proposals: ResolutionProposal[] }
  | { kind: "verified"; jobId: string; result: VerifyResult }
  | { kind: "error"; jobId: string; message: string };

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== "object" || value === null || !("kind" in value) || !("jobId" in value))
    return false;
  const kind = value.kind;
  const jobId = value.jobId;
  if (typeof jobId !== "string") return false;
  if (kind === "error") return "message" in value && typeof value.message === "string";
  if (kind === "result") return "proposals" in value && Array.isArray(value.proposals);
  if (kind === "verified") return "result" in value && typeof value.result === "object";
  return false;
}
