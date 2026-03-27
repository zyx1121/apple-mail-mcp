#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

if (process.platform !== "darwin") {
  console.error("apple-mail-mcp requires macOS with Apple Mail.");
  process.exit(1);
}

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
