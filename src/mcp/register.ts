import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveConfig } from "./config";
import { resolveProvider } from "@/providers/resolve";
import { readState, writeState, getNextPort } from "@/engine/state";
import { inspectProject } from "@/engine/rules";
import { buildImage, saveImage } from "@/engine/docker";
import { generateNginxConfig } from "@/engine/nginx";
import { provisionStaticSlot, deployStaticSlot, destroyStaticSlot } from "@/engine/warm";
import { receiveChunk } from "./chunks";
import { consumeUpload } from "./uploads";
import { readFile, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { $ } from "bun";
import type { DeploymentRecord } from "@/types";
import { formatDeploymentList, formatStatus } from "./tools";
import type { ContainerStats } from "./tools";

export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function registerTools(server: McpServer, cwd: string) {
  function getConfigOrError() {
    const config = resolveConfig(cwd);
    if (!config) {
      return {
        error: "No deploy-ops configuration found. Set env vars (DEPLOY_OPS_HOST, DEPLOY_OPS_SSH_KEY, DEPLOY_OPS_DOMAIN) or run 'dovu-app init' in your project.",
      };
    }
    return { config };
  }

  server.tool("ls", "List all deployments with status", {}, async () => {
    const { config, error } = getConfigOrError();
    if (error) return { content: [{ type: "text", text: error }] };

    const state = await readState(cwd);
    const deployments = state.deployments;

    if (Object.keys(deployments).length === 0) {
      return { content: [{ type: "text", text: "No deployments found." }] };
    }

    // Reconcile live status
    const provider = resolveProvider(config!);
    for (const dep of Object.values(deployments)) {
      if (dep.kind === "static-slot") {
        try {
          // symlink resolves to an existing directory?
          await provider.exec(`test -d /opt/deploy-ops/sites/${dep.name}`);
          dep.status = dep.currentRevision === "initial" ? "provisioned" : "running";
        } catch {
          dep.status = "stopped";
        }
        continue;
      }
      try {
        const running = await provider.exec(`docker inspect -f '{{.State.Running}}' dovu-app-paas-${dep.name}`);
        dep.status = running.trim() === "true" ? "running" : "stopped";
      } catch {
        dep.status = "stopped";
      }
    }

    const list = formatDeploymentList(deployments);
    return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
  });

  server.tool(
    "status",
    "Show deployment status, resources, and warnings",
    { app: z.string().describe("App name") },
    async ({ app }) => {
      const { config, error } = getConfigOrError();
      if (error) return { content: [{ type: "text", text: error }] };

      const state = await readState(cwd);
      const dep = state.deployments[app];

      if (!dep) {
        const available = Object.keys(state.deployments);
        const hint = available.length > 0
          ? `Available apps: ${available.join(", ")}`
          : "No deployments found.";
        return { content: [{ type: "text", text: `Deployment '${app}' not found. ${hint}` }] };
      }

      if (dep.kind === "static-slot") {
        const provider = resolveProvider(config!);
        let alive = false;
        try {
          await provider.exec(`test -d /opt/deploy-ops/sites/${app}`);
          alive = true;
        } catch {}
        const result = {
          name: dep.name,
          domain: dep.domain,
          running: alive,
          kind: "static-slot" as const,
          currentRevision: dep.currentRevision ?? null,
          warnings: [] as string[],
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      const provider = resolveProvider(config!);
      const containerName = `dovu-app-paas-${app}`;
      const stats: ContainerStats = { running: false, cpu: null, memory: null, restartCount: 0, uptime: null };

      try {
        const inspectJson = await provider.exec(
          `docker inspect ${containerName} --format '{{.State.Running}}|{{.RestartCount}}|{{.State.StartedAt}}'`
        );
        const [running, restarts, startedAt] = inspectJson.trim().split("|");
        stats.running = running === "true";
        stats.restartCount = parseInt(restarts, 10) || 0;

        if (stats.running) {
          const diff = Date.now() - new Date(startedAt).getTime();
          const minutes = Math.floor(diff / 60000);
          if (minutes < 60) stats.uptime = `${minutes}m`;
          else {
            const hours = Math.floor(minutes / 60);
            stats.uptime = `${hours}h ${minutes % 60}m`;
          }

          const dockerStats = await provider.exec(
            `docker stats ${containerName} --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}'`
          );
          const [cpu, mem] = dockerStats.trim().split("|");
          stats.cpu = cpu;
          stats.memory = mem;
        }
      } catch {}

      const result = formatStatus(dep, stats);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "logs",
    "Get recent logs from a deployment",
    {
      app: z.string().describe("App name"),
      lines: z.number().optional().default(50).describe("Number of log lines to return"),
    },
    async ({ app, lines }) => {
      const { config, error } = getConfigOrError();
      if (error) return { content: [{ type: "text", text: error }] };

      const state = await readState(cwd);
      if (!state.deployments[app]) {
        const available = Object.keys(state.deployments);
        const hint = available.length > 0
          ? `Available apps: ${available.join(", ")}`
          : "No deployments found.";
        return { content: [{ type: "text", text: `Deployment '${app}' not found. ${hint}` }] };
      }

      if (state.deployments[app].kind === "static-slot") {
        return {
          content: [{
            type: "text",
            text: "Static sites have no container logs. Check nginx access logs on the droplet at /var/log/nginx/access.log.",
          }],
        };
      }

      const provider = resolveProvider(config!);
      const containerName = `dovu-app-paas-${app}`;

      try {
        const output = await provider.exec(`docker logs ${containerName} --tail ${lines} 2>&1`);
        return { content: [{ type: "text", text: output }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed to get logs: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    }
  );

  server.tool(
    "destroy",
    `Remove a deployment completely. Accepts either the full resolved app label in 'app', or the name + optional 'deployer' used at prewarm/deploy time — the server composes the label the same way (name-deployer). If the app isn't found in state, returns the list of existing labels so the caller can pick the right one.`,
    {
      app: z.string().describe("Full app label (e.g. 'landing-page-alice') OR the base name — if you used 'deployer' at deploy time, pass it as the separate 'deployer' param here, or pass the full combined label."),
      deployer: z.string().optional().describe("Optional deployer name used at deploy time. When provided, the label resolved is '{slugify(app)}-{slugify(deployer)}', matching prewarm/deploy's resolution."),
    },
    async ({ app, deployer }) => {
      const { config, error } = getConfigOrError();
      if (error) return { content: [{ type: "text", text: error }] };

      const provider = resolveProvider(config!);

      const state = await readState(cwd);

      // Resolve the target label the same way prewarm/deploy do. If the caller
      // passes a deployer we always apply the suffix; otherwise we try the raw
      // 'app' first (may already be a full label), falling back to a fuzzy
      // lookup against known `{app}-*` keys if the exact match misses.
      let label: string;
      if (deployer) {
        label = `${slugify(app)}-${slugify(deployer)}`;
      } else if (state.deployments[app]) {
        label = app;
      } else {
        const base = slugify(app);
        const candidates = Object.keys(state.deployments).filter(
          (k) => k === base || k.startsWith(`${base}-`),
        );
        if (candidates.length === 1) {
          label = candidates[0];
        } else if (candidates.length > 1) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: `ambiguous app name '${app}'`,
                candidates,
                action: "Pass the full label in 'app', or specify 'deployer' to disambiguate.",
              }, null, 2),
            }],
            isError: true,
          };
        } else {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: `deployment '${app}' not found`,
                known: Object.keys(state.deployments),
              }, null, 2),
            }],
            isError: true,
          };
        }
      }

      const dep = state.deployments[label];

      // --- Warm-slot branch: early return, container path below is untouched ---
      if (dep?.kind === "static-slot") {
        const results: string[] = [];
        try {
          await destroyStaticSlot(provider, label);
          results.push(`Static slot '${label}' removed (dir + nginx conf + reload)`);
        } catch (err) {
          results.push(`Static slot removal failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        delete state.deployments[label];
        await writeState(cwd, state);
        results.push("Removed from state");
        return { content: [{ type: "text", text: `Destroyed '${label}':\n${results.map(r => `  - ${r}`).join("\n")}` }] };
      }
      // --- End warm-slot branch ---

      // From here on, 'app' in the container path's commands uses the resolved label.
      app = label;
      const containerName = `dovu-app-paas-${app}`;
      const results: string[] = [];

      // Stop and remove container
      try {
        await provider.exec(`docker stop ${containerName}`);
        await provider.exec(`docker rm ${containerName}`);
        results.push("Container removed");
      } catch {
        results.push("Container not found or already removed");
      }

      // Remove image if known from state
      if (dep?.image) {
        try {
          await provider.exec(`docker rmi ${dep.image}`);
          results.push("Image removed");
        } catch {
          results.push("Image not found or already removed");
        }
      }

      // Remove nginx config
      try {
        await provider.exec(`rm -f ${provider.nginxConfDir}/dovu-app-paas-${app}.conf ${provider.nginxConfDir}/dovu-app-paas-${app}.conf.disabled`);
        await provider.exec("nginx -s reload 2>/dev/null || sudo systemctl reload nginx");
        results.push("Nginx config removed");
      } catch {
        results.push("Nginx cleanup failed");
      }

      // Update state
      if (dep) {
        delete state.deployments[app];
        await writeState(cwd, state);
        results.push("Removed from state");
      }

      // Clean up unpacked source directory
      const sourceDir = join(cwd, app);
      try {
        await rm(sourceDir, { recursive: true, force: true });
        results.push("Source directory cleaned");
      } catch {
        // Source dir may not exist (local deploys)
      }

      return { content: [{ type: "text", text: `Destroyed '${app}':\n${results.map(r => `  - ${r}`).join("\n")}` }] };
    }
  );

  server.tool(
    "prewarm",
    `Pre-provision a static site slot. Allocates a subdomain, writes a placeholder page, and makes the URL live immediately. Call this the moment the user declares intent to build a static site. A later deploy() call will swap in the real content.

v1 supports framework: "static" only. Bun/Node warm containers come in Phase B.`,
    {
      name: z.string().describe("App name (slugified into subdomain)"),
      framework: z.literal("static").describe("Runtime to warm. v1: only 'static' is supported"),
      deployer: z.string().optional().describe("Optional deployer name (prefixes subdomain)"),
    },
    async ({ name, framework, deployer }) => {
      const { config, error } = getConfigOrError();
      if (error) return { content: [{ type: "text", text: error }] };

      if (framework !== "static") {
        return {
          content: [{ type: "text", text: `Framework '${framework}' is not supported yet. v1 supports 'static' only.` }],
          isError: true,
        };
      }

      const provider = resolveProvider(config!);
      const appName = slugify(name);
      const deployerSlug = deployer ? slugify(deployer) : null;
      const label = deployerSlug ? `${appName}-${deployerSlug}` : appName;

      // Idempotent: return existing URL if slot/deployment exists
      const state = await readState(cwd);
      const existing = state.deployments[label];
      if (existing) {
        const url = provider.ssl
          ? `https://${existing.domain}`
          : `http://${existing.domain}`;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ url, slot: label, placeholder: existing.status === "provisioned", existing: true, kind: existing.kind ?? "container" }, null, 2),
          }],
        };
      }

      const domain = `${label}.${provider.baseDomain}`;

      try {
        await provisionStaticSlot(provider, label);

        const now = new Date().toISOString();
        state.deployments[label] = {
          name: label,
          domain,
          status: "provisioned",
          kind: "static-slot",
          currentRevision: "initial",
          env: {},
          createdAt: now,
          updatedAt: now,
        };
        await writeState(cwd, state);

        const url = provider.ssl ? `https://${domain}` : `http://${domain}`;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ url, slot: label, placeholder: true, kind: "static-slot" }, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "prewarm failed", message }, null, 2) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "deploy",
    `Deploy a project to the configured droplet.

=== PICK THE RIGHT PATH FIRST ===

**Pure HTML / CSS / JS (no server runtime)** — Astro build output, Vite
static output, hand-written index.html, any dist/ folder with no process
to run. This is the WARM-SLOT path:
  1. Call \`prewarm({ name, framework: "static" })\` FIRST. Returns a
     live URL with a placeholder in ~200 ms.
  2. Build the static content locally. Do NOT wrap it in a Bun/Node
     file server — nginx serves the files directly. No package.json,
     no Bun.serve(), no Dockerfile needed for static content.
  3. Tar+gzip+base64 the built output, then call deploy() with chunks
     (see UPLOAD section below). The URL updates atomically.

**Everything else (dynamic runtime)** — Bun server, Node/Express, Next.js,
Laravel, or a project with a custom Dockerfile. This is the CONTAINER
path:
  - No prewarm needed.
  - Just call deploy() with chunks; the server builds a Docker image,
    starts a container on port 3000, and wires nginx.

If you find yourself about to write a tiny Bun server just to serve
HTML files, STOP — use the static path instead.

=== HOW TO UPLOAD SOURCE ===

**FASTEST path (required for any non-trivial payload): out-of-band upload**.
Use the MCP server's /upload HTTP endpoint to POST the raw tarball bytes in
a single request from Bash, then pass the returned uploadId into deploy().
This bypasses the LLM's tool-call emission entirely — uploads finish in
a few hundred milliseconds regardless of payload size (up to 10MB).

Bash flow:
  curl -X POST https://<mcp-host>/upload \\
    -H "Authorization: Bearer <TOKEN>" \\
    --data-binary @project.tar.gz
  # → {"uploadId":"upl_...","size":12345}

Then one tool call (tiny argument, instant to emit):
  deploy({ name, uploadId: "upl_..." })

Fallbacks when the upload endpoint isn't reachable (e.g., stdio-only MCP):
- **chunk**: multi-part upload of the base64 string via many small tool
  calls (~2KB each). See the 'chunk' parameter docs. Slower than uploadId
  — the LLM still has to emit every chunk token-by-token.
- **source**: single base64 string, hard-capped at 8192 bytes. Rejected
  with instructions above that size.

Typical flow for a static site:
  1. prewarm({ name, framework: "static" })  — URL live with placeholder.
  2. Build locally → tar -czf site.tar.gz -C build .
  3. curl -X POST .../upload -H "Authorization: Bearer \$TOKEN" --data-binary @site.tar.gz
  4. deploy({ name, uploadId: <id from step 3> })  → live URL updates.

=== CONTAINER-PATH REQUIREMENTS (dynamic apps only) ===

IMPORTANT: The application MUST listen on port 3000. The platform's reverse proxy forwards all traffic to this port inside the container.

Recommended project structures for dynamic apps:
- Bun server: index.ts with Bun.serve({ port: 3000 }). Best for APIs.
- Next.js: Detected automatically. Set output: "standalone" in next.config.
- Laravel: artisan present → PHP runtime auto-detected.
- Custom Dockerfile: If a Dockerfile is present, it will be used. Ensure it EXPOSEs port 3000.

When creating the tarball: tar -czf project.tar.gz -C /path/to/project .`,
    {
      name: z.string().optional().describe("App name (required when providing source, chunk, or uploadId). Must be consistent across all chunks for one upload."),
      domain: z.string().optional().describe("Override domain"),
      env: z.record(z.string(), z.string()).optional().describe("Environment variables as key-value pairs"),
      deployer: z.string().optional().describe("Name of the person deploying (used in subdomain, e.g. 'alice'). Must be consistent across all chunks."),
      uploadId: z.string().optional().describe("FASTEST upload path. ID returned by a prior POST to the MCP server's /upload endpoint — the agent curls the tarball bytes there, gets back an uploadId, and references it here. Bypasses the tool-call emission path entirely; sub-second for any payload up to 10MB. Use this for anything non-trivial."),
      source: z.string().optional().describe("FALLBACK for tiny payloads ≤8KB. Base64-encoded tar.gz. Rejected with instructions if over 8192 bytes. Prefer uploadId or chunk for anything larger."),
      chunk: z.object({
        index: z.number().int().min(0).describe("Zero-based chunk index"),
        total: z.number().int().min(1).max(1000).describe("Total number of chunks (1-1000)"),
        data: z.string().describe("This chunk's slice of the full base64-encoded tar.gz. Max 4096 chars (server enforces); ~2048 recommended."),
        sha256Full: z.string().length(16).optional().describe("Optional integrity check on the final chunk: first 16 hex chars of SHA-256 over the FULL concatenated base64 payload (not this chunk alone). If provided on the final chunk, the server compares it to its own hash of the assembled payload and rejects on mismatch. Use this to catch wire corruption."),
      }).optional().describe("FALLBACK upload path when /upload isn't available (e.g. stdio-only MCP). Multi-part chunked upload — each call carries one slice of the base64. Slower than uploadId because the LLM still emits every chunk token-by-token. The final chunk triggers the real deploy."),
    },
    async ({ name, domain, env: envInput, deployer, source, chunk, uploadId }) => {
      const { config, error } = getConfigOrError();
      if (error) return { content: [{ type: "text", text: error }] };

      const provider = resolveProvider(config!);

      // Unified tarball payload — populated by uploadId (raw bytes),
      // source (base64 string), or chunk assembly (base64 string). The
      // warm-slot engine accepts either and handles decoding internally.
      let payload: string | Buffer | undefined = source;

      // --- uploadId: retrieve pre-uploaded bytes ---
      // The agent POSTed raw bytes to /upload (via curl in Bash, bypassing
      // the slow LLM tool-call emission path) and passed the returned ID here.
      if (uploadId) {
        const bytes = await consumeUpload(uploadId);
        if (!bytes) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "unknown or expired uploadId",
                uploadId,
                action: "Re-run POST /upload to get a fresh uploadId, then retry. Uploads expire after 15 minutes and are consumed on first use.",
              }, null, 2),
            }],
            isError: true,
          };
        }
        payload = bytes;
      }

      // --- Upload size enforcement ---
      // Agents default to 'source' out of habit but emit long tool arguments
      // very slowly (token-by-token). Reject oversized 'source' with guidance.
      const SOURCE_MAX = 8192;
      const CHUNK_MAX = 4096;
      if (source && source.length > SOURCE_MAX) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "source payload too large",
              size: source.length,
              limit: SOURCE_MAX,
              action: "Use 'chunk' instead. Split the base64 string into pieces of ≤2048 chars. For each piece, call deploy({name, chunk: {index, total, data: piece}}). The final chunk triggers the deploy automatically.",
            }, null, 2),
          }],
          isError: true,
        };
      }
      if (chunk && chunk.data.length > CHUNK_MAX) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "chunk data too large",
              size: chunk.data.length,
              limit: CHUNK_MAX,
              action: "Reduce chunk size to ≤4096 chars (≤2048 recommended). Increase 'total' and redistribute. Chunk buffers are keyed by app name, so you can restart the upload from index 0 with new totals.",
            }, null, 2),
          }],
          isError: true,
        };
      }

      // --- Multi-part chunk upload ---
      // If 'chunk' is present, buffer it server-side. Non-final chunks return
      // a progress receipt and short-circuit. The final chunk assembles the
      // full source and falls through into the normal deploy flow below.
      if (chunk) {
        if (!name) {
          return {
            content: [{ type: "text", text: "Error: 'name' is required when uploading chunks" }],
            isError: true,
          };
        }
        const chunkKey = deployer
          ? `${slugify(name)}-${slugify(deployer)}`
          : slugify(name);
        try {
          const receipt = receiveChunk(chunkKey, chunk.index, chunk.total, chunk.data);
          if (!receipt.complete) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  received: receipt.received,
                  total: receipt.total,
                  complete: false,
                  chunkSha: receipt.chunkSha,
                  chunkLen: receipt.chunkLen,
                }, null, 2),
              }],
            };
          }
          // Optional client-side integrity check: if the final chunk carried
          // a sha256Full hint, compare it to what we assembled. Mismatch ≡
          // wire corruption somewhere between agent and server — surface the
          // observed vs expected hashes and abort before we write garbage to
          // disk.
          if (chunk.sha256Full && receipt.assembledSha !== chunk.sha256Full) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  error: "assembled payload sha256 mismatch",
                  expectedSha: chunk.sha256Full,
                  observedSha: receipt.assembledSha,
                  observedLen: receipt.assembledLen,
                  action: "Wire corruption between client and server. Re-send the upload. If the mismatch persists, inspect each chunk's response chunkSha against the client-side hash of that chunk to localize which chunk was mutated.",
                }, null, 2),
              }],
              isError: true,
            };
          }
          // Complete — substitute the assembled payload for downstream use.
          payload = receipt.assembled;
          source = receipt.assembled; // legacy: container path below still reads `source` directly
        } catch (err) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "chunk upload failed", message: err instanceof Error ? err.message : String(err) }, null, 2),
            }],
            isError: true,
          };
        }
      }
      // --- End chunk upload. `source` is now populated if upload completed. ---

      // --- Warm-slot fast path ---
      if (name) {
        const label = deployer
          ? `${slugify(name)}-${slugify(deployer)}`
          : slugify(name);
        const state = await readState(cwd);
        const slot = state.deployments[label];
        if (slot?.kind === "static-slot") {
          if (!payload) {
            return {
              content: [{
                type: "text",
                text: "Error: provide one of `uploadId`, `source`, or a `chunk` upload when deploying into a warm static slot",
              }],
              isError: true,
            };
          }
          try {
            const deployT0 = performance.now();
            const { revision, timings } = await deployStaticSlot(provider, label, payload);
            const totalMs = Math.round(performance.now() - deployT0);
            const now = new Date().toISOString();
            slot.status = "running";
            slot.currentRevision = revision;
            slot.updatedAt = now;
            await writeState(cwd, state);
            const url = provider.ssl ? `https://${slot.domain}` : `http://${slot.domain}`;
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  url,
                  appName: label,
                  revision,
                  totalMs,
                  timings,
                }, null, 2),
              }],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ error: "warm-slot deploy failed", message }, null, 2),
              }],
              isError: true,
            };
          }
        }
      }
      // --- End warm-slot fast path. Falls through to existing container path. ---

      const steps: string[] = [];
      let stage = "setup";

      try {
        // Determine project directory
        let projectDir = cwd;
        if (payload) {
          if (!name) {
            return { content: [{ type: "text", text: "Error: 'name' is required when deploying with source/chunk/uploadId" }] };
          }
          stage = "unpack_source";
          projectDir = join(cwd, name);
          await mkdir(projectDir, { recursive: true });
          const tarball =
            typeof payload === "string" ? Buffer.from(payload, "base64") : Buffer.from(payload);
          const tarPath = join(tmpdir(), `deploy-${name}-${Date.now()}.tar.gz`);
          await writeFile(tarPath, tarball);
          await $`tar -xzf ${tarPath} -C ${projectDir}`.quiet();
          await rm(tarPath, { force: true });
          steps.push(`Unpacked source to ${projectDir}`);
        }

        // 1. Inspect project
        stage = "inspect_project";
        const deployConfig = await inspectProject(projectDir);
        const appName = name || deployConfig.name;
        const deployerSlug = deployer ? slugify(deployer) : null;
        const subdomainName = deployerSlug ? `${appName}-${deployerSlug}` : appName;
        steps.push(`Detected: ${deployConfig.runtime}/${deployConfig.framework}, entrypoint=${deployConfig.entrypoint}, port=${deployConfig.port}`);

        // 2. Collect env vars
        const envVars: Record<string, string> = {};
        try {
          const envContent = await readFile(join(projectDir, ".env"), "utf-8");
          for (const line of envContent.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIndex = trimmed.indexOf("=");
            if (eqIndex === -1) continue;
            const key = trimmed.slice(0, eqIndex).trim();
            let value = trimmed.slice(eqIndex + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            envVars[key] = value;
          }
        } catch {}
        if (envInput) Object.assign(envVars, envInput);

        // 3. Build image
        stage = "image_build";
        const imageTag = `dovu-app-paas-${appName}:${Date.now().toString(36)}`;
        const platform = provider.name === "local" ? undefined : "linux/amd64";
        await buildImage(projectDir, imageTag, deployConfig.dockerfile, {
          runtime: deployConfig.runtime,
          framework: deployConfig.framework,
          entrypoint: deployConfig.entrypoint,
          port: deployConfig.port,
        }, platform);
        steps.push(`Built image: ${imageTag}`);

        // 4. Ship image
        stage = "image_transfer";
        const tarballPath = join(tmpdir(), `dovu-app-paas-${appName}.tar`);
        await saveImage(imageTag, tarballPath);
        await provider.transferImage(tarballPath);
        await rm(tarballPath, { force: true });
        steps.push("Image transferred to target");

        // 5. Stop old container
        stage = "stop_old_container";
        const state = await readState(cwd);
        const existing = state.deployments[appName];
        const containerName = `dovu-app-paas-${appName}`;
        try {
          await provider.exec(`docker stop ${containerName}`);
          await provider.exec(`docker rm ${containerName}`);
        } catch {}

        // 6. Find free port and start container
        stage = "start_container";
        let hostPort = existing?.hostPort || await getNextPort(cwd);
        try {
          const portsOutput = await provider.exec(
            `docker ps --format '{{.Ports}}' | sed 's/,/\\n/g' | sed -n 's/.*:\\([0-9]*\\)->.*/\\1/p' | sort -u`
          );
          const used = new Set(portsOutput.trim().split("\n").filter(Boolean).map(Number));
          while (used.has(hostPort)) hostPort++;
        } catch {}

        const envFlags = Object.entries(envVars).map(([k, v]) => `-e ${k}=${JSON.stringify(v)}`).join(" ");
        const containerId = (
          await provider.exec(
            `docker run -d --name ${containerName} -p 127.0.0.1:${hostPort}:${deployConfig.port} --memory=256m --cpus=0.5 --restart=unless-stopped ${envFlags} ${imageTag}`
          )
        ).trim();
        steps.push(`Container started: ${containerId.slice(0, 12)}`);

        // 7. Configure nginx
        stage = "configure_nginx";
        const deployDomain = domain || `${subdomainName}.${provider.baseDomain}`;
        const nginxConf = generateNginxConfig({
          serverName: deployDomain,
          hostPort,
          ssl: provider.ssl ?? undefined,
        });
        const confB64 = Buffer.from(nginxConf).toString("base64");
        await provider.exec(
          `echo '${confB64}' | base64 -d > ${provider.nginxConfDir}/dovu-app-paas-${appName}.conf`
        );
        await provider.exec("nginx -s reload 2>/dev/null || sudo systemctl reload nginx");
        steps.push("Nginx configured");

        // 8. Update state
        stage = "update_state";
        const now = new Date().toISOString();
        const record: DeploymentRecord = {
          name: appName,
          image: imageTag,
          port: deployConfig.port,
          hostPort,
          domain: deployDomain,
          containerId: containerId.slice(0, 12),
          status: "running",
          env: envVars,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
        };
        state.deployments[appName] = record;
        await writeState(cwd, state);

        const url = `https://${deployDomain}`;
        steps.push(`Deployed: ${url}`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ url, appName, containerId: containerId.slice(0, 12), steps }, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: `Deploy failed at stage: ${stage}`,
              stage,
              message,
              steps,
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "dev",
    "Start hot-reload dev mode for the current project",
    {
      name: z.string().optional().describe("Override app name"),
      port: z.number().optional().describe("Override host port"),
      env: z.record(z.string(), z.string()).optional().describe("Environment variables as key-value pairs"),
      deployer: z.string().optional().describe("Name of the person deploying (used in subdomain, e.g. 'alice')"),
    },
    async ({ name, port, env: envInput, deployer }) => {
      // Inspect project
      const deployConfig = await inspectProject(cwd);
      const appName = name || deployConfig.name;
      const deployerSlug = deployer ? slugify(deployer) : null;
      const subdomainName = deployerSlug ? `${appName}-${deployerSlug}` : appName;

      // Collect env vars
      const envVars: Record<string, string> = {};
      try {
        const envContent = await readFile(join(cwd, ".env"), "utf-8");
        for (const line of envContent.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIndex = trimmed.indexOf("=");
          if (eqIndex === -1) continue;
          const key = trimmed.slice(0, eqIndex).trim();
          let value = trimmed.slice(eqIndex + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          envVars[key] = value;
        }
      } catch {}
      if (envInput) Object.assign(envVars, envInput);

      // Build image for deps
      const imageTag = `dovu-app-paas-dev-${appName}:latest`;
      await buildImage(cwd, imageTag, deployConfig.dockerfile, {
        runtime: deployConfig.runtime,
        framework: deployConfig.framework,
        entrypoint: deployConfig.entrypoint,
        port: deployConfig.port,
      });

      // Stop any existing dev container
      const containerName = `dovu-app-paas-dev-${appName}`;
      try {
        const proc = Bun.spawn(["docker", "rm", "-f", containerName], { stdout: "pipe", stderr: "pipe" });
        await proc.exited;
      } catch {}

      // Find free port
      let hostPort = port || deployConfig.port;
      if (!port) {
        try {
          const proc = Bun.spawn(["lsof", "-i", `:${hostPort}`, "-t"], { stdout: "pipe", stderr: "pipe" });
          const output = await new Response(proc.stdout).text();
          if (output.trim()) {
            for (let p = hostPort + 1; p < hostPort + 100; p++) {
              const c = Bun.spawn(["lsof", "-i", `:${p}`, "-t"], { stdout: "pipe", stderr: "pipe" });
              const o = await new Response(c.stdout).text();
              if (!o.trim()) { hostPort = p; break; }
            }
          }
        } catch {}
      }

      // Determine watch command
      let watchCmd: string[];
      switch (deployConfig.framework) {
        case "nextjs": watchCmd = ["npx", "next", "dev"]; break;
        case "laravel": watchCmd = ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]; break;
        default: watchCmd = ["bun", "--watch", "run", deployConfig.entrypoint]; break;
      }

      // Start dev container (detached so we can return)
      const envFlags = Object.entries(envVars).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
      const proc = Bun.spawn(
        [
          "docker", "run", "-d",
          "--name", containerName,
          "-p", `${hostPort}:${deployConfig.port}`,
          "-v", `${cwd}:/app`,
          "-w", "/app",
          ...envFlags,
          imageTag,
          ...watchCmd,
        ],
        { stdout: "pipe", stderr: "pipe" }
      );
      const containerId = (await new Response(proc.stdout).text()).trim();

      const url = `http://localhost:${hostPort}`;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            url,
            appName: subdomainName,
            containerId: containerId.slice(0, 12),
            port: hostPort,
            watchCommand: watchCmd.join(" "),
            stopCommand: `docker rm -f ${containerName}`,
          }, null, 2),
        }],
      };
    }
  );
}
