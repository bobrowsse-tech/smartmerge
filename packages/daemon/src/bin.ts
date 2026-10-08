#!/usr/bin/env node
import { startLspServer } from "./lsp.js";
import { startStdioServer } from "./stdio.js";

const lsp = process.argv.includes("--lsp");
const stdio = process.argv.includes("--stdio");

if (lsp === stdio) {
  process.stderr.write("Usage: smartmerged --stdio\n       smartmerged --lsp\n");
  process.exit(2);
}

if (lsp) startLspServer();
else startStdioServer();
