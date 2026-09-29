#!/usr/bin/env node
import { startStdioServer } from "./stdio.js";

if (!process.argv.includes("--stdio")) {
  process.stderr.write("Usage: smartmerged --stdio\n");
  process.exit(2);
}

startStdioServer();
