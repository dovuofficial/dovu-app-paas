import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const TEST_PORT = 9876;
const TEST_SECRET = "test-secret-token";
let serverProc: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  serverProc = Bun.spawn(["bun", "run", "src/mcp/remote.ts"], {
    env: {
      ...process.env,
      MCP_PORT: String(TEST_PORT),
      TEAM_SECRET: TEST_SECRET,
      DEPLOY_OPS_DOMAIN: "test.localhost",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  // Wait for server to start
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${TEST_PORT}/health`);
      if (res.ok) break;
    } catch {}
    await Bun.sleep(100);
  }
});

afterAll(() => {
  serverProc.kill();
});

describe("Remote MCP Server", () => {
  test("health endpoint returns ok without auth", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("MCP endpoint rejects missing auth", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  test("MCP endpoint rejects wrong token", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  test("MCP endpoint accepts correct token and initializes", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
  });
});
