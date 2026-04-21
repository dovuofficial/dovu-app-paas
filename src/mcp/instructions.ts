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
The 'source' parameter is a FALLBACK, hard-capped at 8KB of base64, and rejected with instructions above that threshold. Do not try to send a full base64 payload as 'source'.

The correct path is the 'chunk' parameter:
  deploy({ name, chunk: { index, total, data: <~2KB of base64> } })

Call deploy() once per chunk with the same 'name'. Non-final calls return { received, total, complete: false }. The final chunk assembles the payload and triggers the real deploy, returning the live URL.

LLM agents emit long tool arguments one token at a time. Many small chunks take seconds; one big 'source' can take minutes and fail.

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
