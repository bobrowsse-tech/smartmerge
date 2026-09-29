import type {
  Actor,
  ConflictSession,
  DashboardSummary,
  InitializeParams,
  InitializeResult,
  ResolutionProposal,
  SessionLogEntry,
  UserAction,
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
export const dashboardRequest = new RequestType<{ sessionId: string }, DashboardSummary, void>(
  "dashboard/get",
);
export const actRequest = new RequestType<
  { sessionId: string; action: UserAction; actor?: Actor },
  { log: SessionLogEntry[]; session: ConflictSession },
  void
>("resolution/act");
