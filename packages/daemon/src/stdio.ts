import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { DaemonServer } from "./server.js";

/** Serve JSON-RPC on the current process stdio. */
export function startStdioServer(): void {
  const connection = createMessageConnection(
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout),
  );
  const server = new DaemonServer();
  server.listen(connection);
  connection.listen();
  process.stdin.on("end", () => {
    void server.shutdown();
  });
}
