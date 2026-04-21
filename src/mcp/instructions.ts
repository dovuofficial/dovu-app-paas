/**
 * Server-level instructions shown to MCP clients at session init.
 *
 * Agents read this BEFORE invoking any individual tool, so it's the
 * first chance to set the mental model. Two goals:
 *   1. Establish the static-vs-dynamic decision fork so agents pick
 *      the warm-slot path instead of wrapping HTML in a Bun server.
 *   2. Establish that chunked uploads are the default, not 'source'.
 *
 * Keep this terse and action-oriented. Per-tool descriptions hold the
 * detailed parameter schemas and error-recovery guidance.
 */
export const SERVER_INSTRUCTIONS = `deploy-ops turns a project into a live URL. There are two deploy paths; pick by app type BEFORE you start building.

========================================
STATIC sites (HTML/CSS/JS, no runtime)
========================================
For: hand-written HTML, Astro/Vite/Jekyll build output, plain index.html, any dist/ folder that nginx can serve directly.

1. Call prewarm({ name, framework: "static" }) FIRST — the moment the user says "build a website / landing page / docs site". URL goes live in ~200ms with a "provisioning…" placeholder you can share immediately.
2. Build the site locally. DO NOT write a Bun.serve(), Node HTTP server, package.json, or Dockerfile. Nginx serves the files directly.
3. Tar+gzip+base64 the built output. Upload via chunked deploy (see UPLOAD CONTRACT below).
4. The URL updates atomically; return it to the user.

If you catch yourself writing a tiny Bun/Node/Python server just to serve HTML — STOP. That is the wrong path. Use prewarm + warm-slot deploy.

========================================
DYNAMIC apps (anything with a runtime)
========================================
For: Bun servers, Node/Express, Next.js, Laravel, APIs, apps with a custom Dockerfile.

- No prewarm. The app must listen on port 3000.
- Call deploy() with chunks (see below). The server builds a Docker image and runs it — this takes 30-120s depending on the image.

========================================
UPLOAD CONTRACT (both paths)
========================================
**FASTEST path: out-of-band upload via /upload.**

The remote MCP server exposes a POST /upload endpoint. The agent uses Bash (curl) to send the raw tarball bytes in a single HTTP request — bypassing the LLM's tool-call emission path entirely. This is the preferred path for anything non-trivial:

  curl -X POST https://<mcp-host>/upload \\
    -H "Authorization: Bearer <TOKEN>" \\
    --data-binary @project.tar.gz
  # → {"uploadId":"upl_...","size":12345}

Then one tiny tool call:
  deploy({ name, uploadId: "upl_..." })

This finishes in a few hundred ms regardless of payload size (up to 10MB). Use this for every real deploy unless the upload endpoint is unreachable.

FALLBACKS (slower — LLM emits base64 token-by-token):
- 'chunk': multi-part base64 upload via many small tool calls (~2KB each). Use when /upload isn't reachable.
- 'source': single base64 string, hard-capped at 8KB. Only for trivial payloads.

Do not pass more than 8KB of base64 via 'source' — the server rejects with instructions above that threshold.

========================================
OTHER TOOLS
========================================
- ls: list all deployments with status
- status: details on one deployment (static slots show currentRevision; container apps show CPU/mem/uptime)
- logs: container logs (static slots return a pointer to nginx access logs)
- destroy: remove a deployment completely
- dev: local hot-reload development mode

========================================
NAMING
========================================
Pass the optional 'deployer' field on prewarm/deploy to prefix the subdomain with the user's identity, e.g. deployer="alice" → alice's slot becomes landing-page-alice.apps.yourdomain.com. Stable across redeploys. Must stay consistent across all chunks of one upload.`;
