import { PROTOCOL_VERSION, type ErrorCode, type StructuredError } from "@smartmerge/protocol";

export type JsonExit = 0 | 1 | 2 | 3 | 4;

/** A command failure with a stable code. JSON output uses this instead of a stack. */
export class CommandFailure extends Error {
  readonly exitCode: 2 | 3 | 4;
  readonly code: ErrorCode;
  readonly hint?: string;

  constructor(exitCode: 2 | 3 | 4, code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "CommandFailure";
    this.exitCode = exitCode;
    this.code = code;
    if (hint !== undefined) this.hint = hint;
  }
}

/** Map a daemon message onto a stable error. The text is ours. */
export function failureFromMessage(message: string): CommandFailure {
  if (message.includes("Result text is too large")) {
    return new CommandFailure(2, "TOO_LARGE", message, "Shorten the resolution and try again.");
  }
  if (message.startsWith("Unknown session")) {
    return new CommandFailure(2, "STALE_SESSION", message);
  }
  if (message.startsWith("No conflicted file") || message.startsWith("No hunk")) {
    return new CommandFailure(2, "NOT_FOUND", message);
  }
  if (message.includes("hazardous")) {
    return new CommandFailure(
      3,
      "POLICY_BLOCKED",
      message,
      "Pass --accept-hazardous to write it anyway.",
    );
  }
  return new CommandFailure(2, "INTERNAL", message);
}

export function writeResult(result: unknown): void {
  process.stdout.write(`${JSON.stringify({ protocolVersion: PROTOCOL_VERSION, result })}\n`);
}

export function writeError(failure: CommandFailure): void {
  const error: StructuredError = { code: failure.code, message: failure.message };
  if (failure.hint !== undefined) error.hint = failure.hint;
  process.stdout.write(`${JSON.stringify({ protocolVersion: PROTOCOL_VERSION, error })}\n`);
}
