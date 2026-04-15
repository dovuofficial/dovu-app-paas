import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";

// Ensure data directory exists
mkdirSync("./data", { recursive: true });

const db = new Database("./data/store.db");

// Initialize table
db.run(`
  CREATE TABLE IF NOT EXISTS kv_store (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // GET /keys — list all keys
    if (req.method === "GET" && path === "/keys") {
      const rows = db.query("SELECT key, value FROM kv_store").all() as { key: string; value: string }[];
      return json(rows);
    }

    // GET /keys/:key — get value for a key
    if (req.method === "GET" && path.startsWith("/keys/")) {
      const key = decodeURIComponent(path.slice("/keys/".length));
      const row = db.query("SELECT value FROM kv_store WHERE key = ?").get(key) as { value: string } | null;
      if (!row) return json({ error: "Key not found" }, 404);
      return json({ key, value: row.value });
    }

    // POST /keys — create a key-value pair
    if (req.method === "POST" && path === "/keys") {
      const body = await req.json().catch(() => null);
      if (!body || typeof body.key !== "string" || typeof body.value !== "string") {
        return json({ error: "Body must be { key: string, value: string }" }, 400);
      }
      const existing = db.query("SELECT key FROM kv_store WHERE key = ?").get(body.key);
      if (existing) return json({ error: "Key already exists" }, 409);
      db.run("INSERT INTO kv_store (key, value) VALUES (?, ?)", [body.key, body.value]);
      return json({ key: body.key, value: body.value }, 201);
    }

    // PUT /keys/:key — update value for a key
    if (req.method === "PUT" && path.startsWith("/keys/")) {
      const key = decodeURIComponent(path.slice("/keys/".length));
      const body = await req.json().catch(() => null);
      if (!body || typeof body.value !== "string") {
        return json({ error: "Body must be { value: string }" }, 400);
      }
      const result = db.run("UPDATE kv_store SET value = ? WHERE key = ?", [body.value, key]);
      if (result.changes === 0) return json({ error: "Key not found" }, 404);
      return json({ key, value: body.value });
    }

    // DELETE /keys/:key — delete a key
    if (req.method === "DELETE" && path.startsWith("/keys/")) {
      const key = decodeURIComponent(path.slice("/keys/".length));
      const result = db.run("DELETE FROM kv_store WHERE key = ?", [key]);
      if (result.changes === 0) return json({ error: "Key not found" }, 404);
      return json({ deleted: key });
    }

    if (req.method === "GET" && path === "/health") {
      return json({ status: "ok", uptime: process.uptime() });
    }

    return json({ error: "Not found" }, 404);
  },
});

console.log("API server running on http://localhost:3000");
