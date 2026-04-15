import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerTools } from "./register";

const PORT = parseInt(process.env.MCP_PORT || "8888", 10);
const TEAM_SECRET = process.env.TEAM_SECRET;
const WORKSPACE = process.env.MCP_WORKSPACE || process.cwd();

if (!TEAM_SECRET) {
  console.error("TEAM_SECRET environment variable is required");
  process.exit(1);
}

// Session tracking: sessionId -> { transport, server }
const sessions = new Map<
  string,
  {
    transport: WebStandardStreamableHTTPServerTransport;
    server: McpServer;
  }
>();

function checkAuth(req: Request): Response | null {
  const auth = req.headers.get("authorization");
  if (!auth || auth !== `Bearer ${TEAM_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Health check — no auth
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // All /mcp routes require auth
    if (url.pathname === "/mcp") {
      const authError = checkAuth(req);
      if (authError) return authError;

      if (req.method === "POST") return handlePost(req);
      if (req.method === "GET") return handleGet(req);
      if (req.method === "DELETE") return handleDelete(req);

      return new Response("Method not allowed", { status: 405 });
    }

    return new Response("Not found", { status: 404 });
  },
});

async function handlePost(req: Request): Promise<Response> {
  const sessionId = req.headers.get("mcp-session-id");

  // Existing session
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    return session.transport.handleRequest(req);
  }

  // New session — must be an initialize request
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const messages = Array.isArray(body) ? body : [body];
  if (!messages.some(isInitializeRequest)) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Create new transport and server for this session
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (sid) => {
      sessions.set(sid, { transport, server });
    },
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) sessions.delete(sid);
  };

  const server = new McpServer({
    name: "deploy-ops",
    version: "0.1.0",
  });

  registerTools(server, WORKSPACE);
  await server.connect(transport);

  return transport.handleRequest(req, { parsedBody: body });
}

async function handleGet(req: Request): Promise<Response> {
  const sessionId = req.headers.get("mcp-session-id");
  if (!sessionId || !sessions.has(sessionId)) {
    return new Response("Invalid or missing session ID", { status: 400 });
  }
  return sessions.get(sessionId)!.transport.handleRequest(req);
}

async function handleDelete(req: Request): Promise<Response> {
  const sessionId = req.headers.get("mcp-session-id");
  if (!sessionId || !sessions.has(sessionId)) {
    return new Response("Invalid or missing session ID", { status: 400 });
  }
  return sessions.get(sessionId)!.transport.handleRequest(req);
}

console.log(`deploy-ops MCP server listening on port ${PORT}`);
