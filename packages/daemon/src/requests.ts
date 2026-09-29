import type {
  ConflictSession,
  InitializeParams,
  InitializeResult,
  ResolutionProposal,
} from "@smartmerge/protocol";
import { RequestType, RequestType0 } from "vscode-jsonrpc/node";

export const initializeRequest = new RequestType<InitializeParams, InitializeResult, void>(
  "initialize",
);
export const shutdownRequest = new RequestType0<null, void>("shutdown");
export const listConflictsRequest = new RequestType<{ repoRoot: string }, ConflictSession, void>(
  "conflicts/list",
);
export const proposeRequest = new RequestType<
  { sessionId: string; path: string },
  ResolutionProposal[],
  void
>("resolution/propose");
