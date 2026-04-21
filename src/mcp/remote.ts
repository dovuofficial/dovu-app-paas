import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerTools } from "./register";
import { SERVER_INSTRUCTIONS } from "./instructions";
import { storeUpload, gcUploads, UPLOAD_MAX_BYTES } from "./uploads";

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
  idleTimeout: 255, // max — deploys can take minutes
  async fetch(req) {
    const url = new URL(req.url);

    // Health check — no auth
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Raw-bytes upload endpoint. Agents POST a tarball here (any
    // Content-Type, bytes in the body), receive {uploadId}, and reference
    // that uploadId from a subsequent `deploy` tool call. This avoids
    // streaming bytes through the LLM's tool-call emission path — the
    // slowdown that makes chunked upload painful for any real payload.
    if (url.pathname === "/upload") {
      const authError = checkAuth(req);
      if (authError) return authError;
      if (req.method !== "POST") {
        return new Response(
          JSON.stringify({ error: "Method not allowed" }),
          { status: 405, headers: { "Content-Type": "application/json" } },
        );
      }
      try {
        const body = await req.arrayBuffer();
        const bytes = new Uint8Array(body);
        const uploadId = await storeUpload(bytes);
        return new Response(
          JSON.stringify({ uploadId, size: bytes.byteLength }),
          { headers: { "Content-Type": "application/json" } },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(
          JSON.stringify({ error: message, limit: UPLOAD_MAX_BYTES }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
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

// Periodic upload garbage collection — reaps files older than UPLOAD_TTL_MS.
// Cheap: a single readdir + stat/unlink loop over /tmp/mcp-uploads.
gcUploads().catch(() => {});
setInterval(
  () => {
    gcUploads().catch(() => {});
  },
  5 * 60 * 1000,
);

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
    // The client's session was probably invalidated — most commonly because
    // the server restarted (sessions are in-memory), or the client's session
    // ID was never recorded on this instance. Surface an actionable hint so
    // the agent can tell the user how to recover instead of retrying blindly.
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "Session expired or unknown. The MCP server likely restarted; your session ID is no longer tracked. " +
            "Recovery: ask the user to run /mcp in Claude Code and reconnect deploy-ops. " +
            "Do not retry this request blindly — it will keep failing until the session is re-initialised.",
        },
        id: messages[0]?.id ?? null,
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

  const server = new McpServer(
    {
      name: "deploy-ops",
      version: "0.1.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

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
