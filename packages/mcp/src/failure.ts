import type { ErrorCode } from "@smartmerge/protocol";

/** A tool failure with a stable code. The message never includes repository text. */
export class ToolFailure extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  /** Set after the failure has been written to the local audit log. */
  audited = false;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "ToolFailure";
    this.code = code;
    if (hint !== undefined) this.hint = hint;
  }
}

/** Map a daemon failure onto a stable code without forwarding repository text. */
export function failureFromDaemon(error: unknown): ToolFailure {
  if (error instanceof ToolFailure) return error;
  const message = error instanceof Error ? error.message : "";
  if (message.includes("too large")) {
    return new ToolFailure(
      "TOO_LARGE",
      "Result text is too large.",
      "Shorten the resolution and try again.",
    );
  }
  if (
    message.includes("No conflicted file") ||
    message.includes("No hunk") ||
    message.includes("Unknown hunk") ||
    message.includes("Unknown candidate") ||
    message.includes("Nothing to undo")
  ) {
    return new ToolFailure(
      "NOT_FOUND",
      "That item is not in the current session.",
      "List conflicts again.",
    );
  }
  if (message.includes("hazardous")) {
    return new ToolFailure(
      "POLICY_BLOCKED",
      "A hazardous edit was refused.",
      "Revise the text so syntax and symbols pass.",
    );
  }
  return new ToolFailure("INTERNAL", "The request could not be completed.");
}
