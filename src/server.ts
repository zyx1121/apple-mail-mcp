import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerSearchTools } from "./tools/search.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "apple-mail",
    version: "0.1.0",
  });

  registerAccountTools(server);
  registerMessageTools(server);
  registerSearchTools(server);

  return server;
}
