#!/usr/bin/env bun
/**
 * Drive the remote MCP server to measure deploy timings across cold / warm
 * / warm-edited scenarios. Useful for validating that the docker-layer-cache
 * fix is live and seeing the per-stage cost breakdown.
 *
 * Reads the MCP URL and bearer token from harness/mcp-config.json so the
 * secret stays out of source control.
 *
 * Usage:
 *   bun harness/perf-deploy.ts                        # 3 deploys: cold, warm-same, warm-edited
 *   bun harness/perf-deploy.ts --rounds 5             # 5 warm rounds after the cold
 *   bun harness/perf-deploy.ts --keep                 # skip final destroy (leaves the app running)
 *   bun harness/perf-deploy.ts --name my-perf-test    # override app name
 */
import { parseArgs } from "util";

const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    rounds: { type: "string", default: "2" },
    name: { type: "string", default: "perf-test-hello" },
    deployer: { type: "string", default: "perf" },
    config: { type: "string", default: "harness/mcp-config.json" },
    keep: { type: "boolean", default: false },
  },
});

const ROUNDS = parseInt(args.rounds!, 10);
const APP_NAME = args.name!;
const DEPLOYER = args.deployer!;
const KEEP = args.keep!;

const cfg = JSON.parse(await Bun.file(args.config!).text());
const server = cfg.mcpServers["deploy-ops"];
const MCP_URL = server.url;
const UPLOAD_URL = MCP_URL.replace(/\/mcp$/, "/upload");
const BEARER = server.headers.Authorization.replace(/^Bearer\s+/, "");

// --- MCP session helpers ---------------------------------------------------

let sessionId: string | null = null;

async function initSession(): Promise<void> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "perf-deploy", version: "0.1.0" },
      },
    }),
  });
  sessionId = res.headers.get("mcp-session-id");
  await res.body?.cancel();
  if (!sessionId) throw new Error(`No mcp-session-id returned. status=${res.status}`);

  const notify = await fetch(MCP_URL, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  await notify.body?.cancel();
  console.log(`[init] session ${sessionId.slice(0, 8)}…`);
}

function jsonHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${BEARER}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) h["mcp-session-id"] = sessionId;
  return h;
}

async function callTool(name: string, toolArgs: unknown): Promise<any> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1e9),
      method: "tools/call",
      params: { name, arguments: toolArgs },
    }),
  });
  const raw = await res.text();
  const jsonBlob = raw.includes("data:") ? extractSSEData(raw) : raw;
  try {
    return JSON.parse(jsonBlob);
  } catch {
    return { raw, status: res.status };
  }
}

function extractSSEData(raw: string): string {
  return raw
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("");
}

async function uploadTarball(bytes: Uint8Array): Promise<string> {
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${BEARER}` },
    body: bytes,
  });
  const body = (await res.json()) as { uploadId?: string; error?: string };
  if (!body.uploadId) throw new Error(`upload failed: ${JSON.stringify(body)}`);
  return body.uploadId;
}

// --- Payload construction --------------------------------------------------

const PACKAGE_JSON = `{"name":"perf-hello","version":"1.0.0","private":true,"scripts":{"start":"node index.js"}}\n`;

function makeIndexJs(variant: string): string {
  return `const http = require("http");
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "hello from perf-deploy ${variant}", ts: Date.now() }));
}).listen(3000, () => console.log("listening on 3000"));
`;
}

async function makeTarball(indexJs: string): Promise<Uint8Array> {
  const dir = `/tmp/perf-deploy-payload-${Date.now()}`;
  await Bun.$`mkdir -p ${dir}`.quiet();
  await Bun.write(`${dir}/package.json`, PACKAGE_JSON);
  await Bun.write(`${dir}/index.js`, indexJs);
  const tarPath = `${dir}/app.tar.gz`;
  await Bun.$`tar -czf ${tarPath} -C ${dir} package.json index.js`.quiet();
  const bytes = new Uint8Array(await Bun.file(tarPath).arrayBuffer());
  await Bun.$`rm -rf ${dir}`.quiet();
  return bytes;
}

// --- Deploy + report -------------------------------------------------------

interface DeployResult {
  label: string;
  totalMs: number;
  timings: Array<{ name: string; durationMs: number }>;
}

async function runDeploy(label: string, variant: string): Promise<DeployResult | null> {
  console.log(`\n===== ${label} =====`);
  const bytes = await makeTarball(makeIndexJs(variant));
  const uploadId = await uploadTarball(bytes);
  console.log(`[payload] ${bytes.byteLength}B  uploadId=${uploadId.slice(0, 12)}…`);

  const t0 = Date.now();
  const resp = await callTool("deploy", { name: APP_NAME, deployer: DEPLOYER, uploadId });
  const wall = Date.now() - t0;

  const inner = resp?.result?.content?.[0]?.text;
  if (!inner) {
    console.log(`[deploy] wall=${wall}ms  (no tool content)`);
    console.log(JSON.stringify(resp, null, 2).slice(0, 800));
    return null;
  }
  const parsed = JSON.parse(inner);
  if (parsed.error) {
    console.log(`[ERROR at stage ${parsed.stage}]: ${parsed.message}`);
    return null;
  }

  console.log(`[deploy] wall=${wall}ms  server totalMs=${parsed.totalMs ?? "n/a"}`);
  if (parsed.timings) {
    for (const t of parsed.timings) {
      console.log(`  ${t.name.padEnd(22)} ${String(t.durationMs).padStart(6)}ms`);
    }
  }
  const hostSkip = (parsed.steps || []).find((s: string) => s.includes("host provider"));
  if (hostSkip) console.log(`[host-skip] ${hostSkip}`);

  return {
    label,
    totalMs: parsed.totalMs ?? wall,
    timings: parsed.timings ?? [],
  };
}

// --- Main -----------------------------------------------------------------

async function main() {
  await initSession();

  console.log(`\n[cleanup] destroying any prior '${APP_NAME}' on target...`);
  const destroyResp = await callTool("destroy", { app: APP_NAME });
  const destroyText = destroyResp?.result?.content?.[0]?.text ?? "";
  console.log(destroyText.split("\n")[0] ?? "(empty response)");

  const results: DeployResult[] = [];

  const cold = await runDeploy("Deploy 1 — cold", `cold-${Date.now()}`);
  if (cold) results.push(cold);

  for (let i = 1; i <= ROUNDS; i++) {
    const identical = i === 1;
    const label = identical
      ? `Deploy ${i + 1} — warm, identical payload`
      : `Deploy ${i + 1} — warm, edited payload`;
    const variant = identical ? `cold-${cold?.totalMs}` : `edited-${i}-${Date.now()}`;
    const r = await runDeploy(label, variant);
    if (r) results.push(r);
  }

  if (!KEEP) {
    console.log(`\n[cleanup] destroying '${APP_NAME}'...`);
    const d = await callTool("destroy", { app: APP_NAME });
    console.log(d?.result?.content?.[0]?.text?.split("\n")[0] ?? "(empty)");
  } else {
    console.log(`\n[keep] leaving '${APP_NAME}' running`);
  }

  // Summary table
  console.log(`\n${"=".repeat(60)}`);
  console.log("SUMMARY");
  console.log("=".repeat(60));
  const stages = ["unpack", "inspect", "docker_build", "stop_old_container", "start_container", "configure_nginx"];
  const header = ["label".padEnd(30), "total", ...stages.map((s) => s.slice(0, 8).padStart(9))].join(" ");
  console.log(header);
  for (const r of results) {
    const tMap = new Map(r.timings.map((t) => [t.name, t.durationMs]));
    const row = [
      r.label.padEnd(30),
      `${r.totalMs}ms`.padStart(5),
      ...stages.map((s) => `${tMap.get(s) ?? "-"}ms`.padStart(9)),
    ].join(" ");
    console.log(row);
  }
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
