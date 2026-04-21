import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./register";
import { SERVER_INSTRUCTIONS } from "./instructions";

const server = new McpServer(
  {
    name: "deploy-ops",
    version: "0.1.0",
  },
  {
    instructions: SERVER_INSTRUCTIONS,
  },
);

registerTools(server, process.cwd());

const transport = new StdioServerTransport();
await server.connect(transport);
