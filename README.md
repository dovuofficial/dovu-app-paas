# DOVU Agent PaaS

An MCP-native internal app deploy layer for turning AI-built projects into live URLs instantly.

---

DOVU App PaaS is an MCP-native internal deploy layer for trusted teams.
It lets Claude Code or a developer turn a project into a live app with a stable name and shareable URL in one step.

- Built for internal tools, previews, and AI-generated apps
- Runs locally, on a remote box, or as a shared remote MCP server
- Controlled through MCP and CLI
- Current security model is trusted-team auth, not hardened multi-tenant hosting

## How it works

1. **Tell Claude Code what to build.** Describe the app, API, tool, or prototype you want.
2. **Choose the app name.** A stable name like `dashboard` or `invoice-tool`.
3. **Claude calls the MCP server.** For static sites, `prewarm` reserves the URL in ~200 ms. Then — for any project type — the agent uploads the built tarball via a single `POST /upload` from Bash and references the returned `uploadId` in a tiny `deploy` tool call.
4. **A URL comes back immediately.** The app is live. Share the link.
5. **Inspect, redeploy, or destroy through MCP.** `logs`, `status`, `ls`, and `destroy` are all available as MCP tools in the same conversation.

The same workflow works from the CLI: `dovu-app deploy --name dashboard`.

## Instant provisioning for static sites

Static sites (plain HTML, Astro build output, Vite static output, etc.) take a dedicated fast path that skips Docker entirely:

- **`prewarm({name, framework: "static"})`** — allocates a subdomain, writes a placeholder page, configures nginx, reloads. **~200 ms.** The URL is live immediately with a "provisioning…" placeholder so it can be shared before the content is built.
- **`POST /upload`** (from Bash, with bearer auth) — sends the raw tarball bytes in one HTTP request, returns `{uploadId}`. **~500 ms for a 10 KB site**, dominated by TLS handshake.
- **`deploy({name, uploadId})`** — the server finds the uploaded bytes, validates, extracts into a fresh revision directory, and flips the nginx-served symlink atomically. **~60 ms of server-side work.** Old revisions are cleaned up asynchronously. Total wall-clock from `curl` to live URL: **~1 second**.
- **`destroy({app, deployer?})`** — removes the directory, nginx conf, and state record.

No container, no image build, no port allocation — nginx serves the files directly from a host directory via symlinked revisions (capistrano-style). Security: the nginx template hardens with `disable_symlinks on from=$document_root` and a dotfile deny block; tarballs are validated before extraction (rejects path traversal, absolute paths, symlinks, hardlinks, PAX long-names).

Dynamic runtimes (Bun, Node, Next.js, Laravel, custom Dockerfile) use the same upload path — `uploadId` is supported on every `deploy` — just followed by a Docker build + ship + run step instead of a symlink swap.

## Remote MCP server

The remote MCP server runs on the droplet and lets your whole team deploy through Claude Code without needing SSH keys, repo access, or local setup.

### Team onboarding — one command

```
claude mcp add deploy-ops --transport http https://mcp.apps.yourdomain.com/mcp --header "Authorization: Bearer <token>"
```

That's it. The deploy tools appear in their next Claude Code conversation.

### How remote deploy works

When someone says *"build me a landing page,"* Claude Code:

1. Calls `prewarm({name: "landing-page", framework: "static"})` → URL live in ~200 ms with a placeholder.
2. Writes the project locally.
3. Tars + gzips the built output (no base64 needed).
4. In Bash: `curl -X POST https://mcp.apps.yourdomain.com/upload -H "Authorization: Bearer $TOKEN" --data-binary @site.tar.gz` → receives `{"uploadId":"upl_..."}`.
5. Calls `deploy({name: "landing-page", uploadId: "upl_..."})` — one tiny tool call.
6. The server reads the uploaded bytes, validates, extracts into a fresh revision dir, flips the symlink.
7. Returns a live HTTPS URL like `https://landing-page-alice.apps.yourdomain.com`.

For dynamic apps (Bun, Node, Next.js, Laravel, Dockerfile), step 6 is replaced by a Docker build + ship + run. Same upload path.

Why the out-of-band upload? LLM agents emit tool-call arguments one token at a time. A 16 KB base64 string in a single tool call can take minutes to stream out of the model. `POST /upload` is a single HTTP request from Bash — bypasses model emission entirely; payload size no longer governs wall-clock time.

The `deployer` parameter bakes identity into the subdomain — you can see who deployed what just by looking at URLs.

### Upload contract and limits

Three ways to get source code to the MCP server, ranked by speed:

**1. `POST /upload` + `uploadId` (preferred).** Agent runs `curl` in Bash to post the raw tarball bytes to the MCP server's `/upload` endpoint with bearer auth, receives a short `uploadId`, and references it from `deploy({name, uploadId})`. Under a second end-to-end for any payload up to 10 MB. This is the default path in the tool descriptions.

**2. `chunk` parameter (fallback).** Multi-part upload of the base64 string via many small tool calls (~2 KB of base64 each). Use when the agent can't reach the `/upload` HTTP endpoint (e.g., stdio-only MCP, air-gapped environments). Slower because the LLM still has to emit each chunk token-by-token.

**3. `source` parameter (tiny payloads only).** Single base64 string, hard-capped at 8 KB. The server rejects anything larger with an instructional error telling the caller to switch to `uploadId` or `chunk`.

The end-to-end cap is nginx's `client_max_body_size` on the MCP server (set to 12 MB on the remote, ~10 MB of actual tarball after HTTP overhead — covers 20-30 MB of uncompressed HTML/CSS/JS after gzip). For projects with large binary assets checked into the repo, use the CLI or GitHub Action deploy path instead.

### Token management

The bearer token is stored on the droplet at `/etc/deploy-ops/env`. To rotate it:

```bash
ssh root@your-droplet
echo "TEAM_SECRET=$(openssl rand -hex 24)" > /etc/deploy-ops/env
systemctl restart deploy-ops-mcp
```

Share the new token with your team. Everyone re-adds the MCP server with the updated token.

## Why it exists

To collapse time from idea to live software.

When a trusted team member can say "build me X" and get a live URL back in under a minute, the bottleneck shifts from deployment to imagination. Manual deployment work disappears for small internal tools, previews, prototypes, and AI-generated apps.

## Agent-tested infrastructure

The platform is tested by the agents that use it.

A training harness spawns 100 autonomous Claude agents — each building and deploying a different app across 13 frameworks (Bun, Node, Python, Go, Rust, Ruby, static HTML) and 3 complexity levels. Agents deploy via MCP, verify their endpoints, and file structured GitHub issues reporting success or failure with root cause analysis.

Each run is one generation. Failures feed back as either code fixes (the platform improves) or documented boundaries (the agents get better guidance). The success rate ratchets up across generations because the platform and the agents co-evolve.

**Current results:** 42/44 successful autonomous deploys. The two failures (Rust, Go multi-stage) independently identified the same fix: async deploys with build polling. Those failure reports were written by agents, not humans.

The entire feedback loop — 100 agents, endpoint verification, cleanup, structured reporting — runs on a single small droplet with no additional cost beyond a Claude Max subscription.

See [`harness/`](harness/) for the runner, task matrix, and reports. See [issues](https://github.com/dovuofficial/dovu-app-paas/issues?q=is%3Aissue) for the agent-filed reports.

## Use cases

**Instant internal tools.** Tell Claude Code to build an admin dashboard, invoice generator, or data viewer. It deploys and you share the URL with your team.

**PR and branch preview deploys.** Every feature branch gets its own URL. Reviewers click a link instead of checking out code. Branch merges clean up automatically.

**AI-generated prototypes shared by URL.** Build something speculative, deploy it, share the link, get feedback. If it's useful, keep it. If not, destroy it.

## Current scope

- **Trusted internal team use.** Not designed for untrusted multi-tenant workloads.
- **Bearer token auth.** Good enough for internal workflows. Not hardened zero-trust.
- **Branch-aware naming and cleanup.** Feature branches get prefixed names. Merged branches auto-destroy.
- **MCP control surface.** Deploy, dev, list, status, logs, and destroy are all MCP tools.
- **Not a full secure multi-tenant platform yet.** That's a future direction, not the current product.

## Product surfaces

**Core: deploy engine + MCP server.** The core repo is the product. The MCP server (`src/mcp/`) exposes `prewarm`, `deploy`, `dev`, `ls`, `status`, `logs`, and `destroy` as tools. The CLI (`src/cli/`) provides the same commands from the terminal (except `prewarm`, which is MCP-only in v1). The deploy engine handles framework detection, container builds, warm-slot provisioning, routing, and state.

**Remote MCP server.** The HTTP transport (`src/mcp/remote.ts`) runs on the droplet behind nginx with bearer token auth. Team members connect via Claude Code with a single command. All deploys — static and dynamic — flow through the same `POST /upload` → `deploy({uploadId})` pattern. Static sites then get a symlink swap; dynamic apps get a Docker build + ship + run.

**GitHub Action: CI and branch preview wrapper.** The [GitHub Action](action.yml) wraps the core CLI for CI workflows. It deploys on push, destroys on branch delete, produces branch-aware URLs, and outputs the live URL for PR comments. The action is a distribution channel, not the product identity.

## Security

Bearer token authentication only, for now. Good enough for trusted team workflows where everyone deploying is known and internal.

Not positioned as hardened zero-trust infrastructure. Multi-tenant isolation, per-user auth, and network segmentation are future work. See [docs/security.md](docs/security.md).

---

## Getting started

### Remote MCP (recommended for teams)

Provision a droplet with the setup script, then share the onboarding command with your team:

```
claude mcp add deploy-ops --transport http https://mcp.apps.yourdomain.com/mcp --header "Authorization: Bearer <token>"
```

See [docs/digitalocean.md](docs/digitalocean.md) for droplet provisioning.

### Local

```bash
bun install
dovu-app init          # select "local"
cd your-project
dovu-app deploy
# Live at http://your-project.ops.localhost
```

### DigitalOcean (CLI)

```bash
dovu-app init          # select "digitalocean", enter IP, SSH key, base domain
cd your-project
dovu-app deploy
# Live at https://your-project.apps.yourdomain.com (with SSL)
```

## Commands

| Command | Description |
|---------|-------------|
| `dovu-app init` | Initialize provider |
| `dovu-app deploy` | Deploy current directory |
| `dovu-app dev` | Hot-reload dev mode (local only) |
| `dovu-app ls` | List all deployments with status |
| `dovu-app status <app>` | CPU, memory, uptime, warnings |
| `dovu-app logs <app>` | Stream container logs |
| `dovu-app stop <app>` | Stop a deployment |
| `dovu-app destroy <app>` | Remove deployment completely |
| `dovu-app redeploy-all` | Redeploy all apps from state |

Deploy options:

```
--name <name>       Override app name (default: directory name)
--domain <domain>   Custom domain instead of <name>.<baseDomain>
-e KEY=VALUE        Set environment variables (repeatable)
```

## MCP endpoints

### HTTP

| Method + path | Auth | Purpose |
|---|---|---|
| `POST /upload` | Bearer | **Preferred upload path.** Body = raw tarball bytes (any Content-Type). Returns `{uploadId, size}`. Hit this from Bash via `curl --data-binary @project.tar.gz` — avoids the LLM-token emission path. Uploads expire after 15 min and are consumed on first use. |
| `POST /mcp` | Bearer | MCP JSON-RPC endpoint for all tool calls below (plus session init). |
| `GET /health` | None | Health probe. Returns `{status: "ok"}`. |

### Tools (via `POST /mcp`)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `prewarm` | `name`, `framework: "static"`, `deployer?` | Allocate a URL and serve a placeholder in ~200 ms. Call this first for any static site. |
| `deploy` | `name?`, `domain?`, `env?`, `deployer?`, `uploadId?`, `chunk?`, `source?` | Deploy a project. Use `uploadId` (from `POST /upload`) for anything non-trivial — works on both warm-slot and container paths. `chunk` is a fallback when the upload endpoint isn't reachable. `source` is for payloads ≤8 KB base64. |
| `dev` | `name?`, `port?`, `env?`, `deployer?` | Start hot-reload dev mode |
| `ls` | — | List all deployments with live status |
| `status` | `app` | CPU, memory, uptime, restart count, warnings (static slots report `currentRevision` instead) |
| `logs` | `app`, `lines?` | Get recent container logs (no-op for static slots — directs to nginx access logs) |
| `destroy` | `app`, `deployer?` | Remove deployment completely. `app` accepts either the full label or the base name; pass `deployer` separately if you used it at deploy time. Ambiguous names return a list of candidates instead of silently miss-targeting. |

## Providers

**Local** — Docker-in-Docker on your machine. Apps get `*.ops.localhost` domains. Good for development and testing.

**DigitalOcean** — Remote droplet via SSH. Images are cross-compiled for `linux/amd64` and transferred via SCP. Wildcard SSL via Let's Encrypt. One provisioning script sets up everything.

**Host** — Direct shell execution on the droplet. Used by the remote MCP server when running on the same machine as Docker. No SSH overhead.

## Framework detection

The deploy engine auto-detects runtime, framework, entrypoint, and port from your project:

| Framework | Detection | Runtime / Path |
|-----------|-----------|---------|
| **Static** | `prewarm({framework: "static"})` | nginx direct — no Docker, symlinked revisions |
| **Bun** | `bun.lockb` or default | `oven/bun:1-alpine` |
| **Node.js** | `package.json` engines | `node:20-alpine` |
| **Next.js** | `next.config.*` or `next` in deps | `node:20-alpine` |
| **Laravel** | `artisan` or `laravel/framework` | `php:8.4-cli` |
| **Custom** | `Dockerfile` present | Your Dockerfile |

## Architecture

### Local

```
┌──────────────────────────────────────────────────┐
│                   Your machine                    │
│                                                   │
│  dovu-app CLI ──► Docker build ──► tarball         │
│       │                                 │         │
│       ▼                                 ▼         │
│  ┌─────────────────────────────────────────────┐  │
│  │          mini-droplet (DinD)                 │  │
│  │                                             │  │
│  │  nginx ──► *.ops.localhost ──► containers    │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### Remote (CLI / GitHub Action)

```
┌───────────────────┐         ┌──────────────────────────────┐
│   Your machine     │  SSH    │         Droplet               │
│                    │ ──────► │                                │
│  dovu-app CLI      │  SCP    │  Docker + nginx + SSL         │
│  docker build      │ ──────► │  *.apps.yourdomain.com        │
└───────────────────┘         └──────────────────────────────┘
```

### Remote MCP (team deploy, container path)

```
┌───────────────────┐         ┌──────────────────────────────┐
│   Claude Code      │  HTTPS  │         Droplet               │
│                    │ ──────► │                                │
│  writes code       │  bearer │  Bun.serve() MCP server       │
│  tar.gz + base64   │  token  │  unpack ► docker build ► run  │
│  deploy tool call  │         │  nginx ► SSL ► live URL       │
└───────────────────┘         └──────────────────────────────┘
```

### Remote MCP (warm-slot static path via uploadId)

```
┌───────────────────┐          ┌──────────────────────────────────────┐
│   Claude Code      │  prewarm │         Droplet                       │
│                    │ ───────► │  ~200 ms: dir + placeholder + nginx   │
│  1. prewarm        │          │  conf + reload → URL LIVE             │
│                    │          │                                        │
│                    │          │                                        │
│  2. build static   │  POST    │  /upload                              │
│     tar -czf       │  /upload │    /tmp/mcp-uploads/upl_...bin        │
│                    │ ───────► │  returns {uploadId}                   │
│                    │ (raw     │                                        │
│                    │  bytes)  │                                        │
│                    │          │                                        │
│  3. deploy({       │  /mcp    │  read upload → validate → extract →   │
│     uploadId })    │ ───────► │  chmod → symlink swap → URL updates   │
└───────────────────┘          └──────────────────────────────────────┘

Total wall-clock for an 11 KB site: ~1 second (upload ~0.6s over TLS, deploy ~0.1s).
```

## Tests

```bash
bun test
```

## Performance benchmarks

Two scripts measure deploy performance against a running droplet. Useful for validating the BuildKit layer cache and for seeing where the time goes after platform changes.

**End-to-end MCP pipeline** — `bun harness/perf-deploy.ts`

Drives the remote MCP through a cold → warm-identical → warm-edited deploy sequence and prints per-stage timings from the server response. Reads URL and bearer from the gitignored `harness/mcp-config.json` so no secrets live in the repo.

```bash
bun harness/perf-deploy.ts                    # 1 cold + 2 warm, destroy at end
bun harness/perf-deploy.ts --rounds 5         # 1 cold + 5 warm
bun harness/perf-deploy.ts --keep             # leave the app running
bun harness/perf-deploy.ts --name perf-2      # custom app name
```

Example summary on a 1 vCPU droplet with a ~700 B node hello-world payload:

```
===== Deploy 1 — cold =====
[deploy] wall=16069ms  server totalMs=15807
  docker_build            13048ms    ← includes base-image pull
  start_container          1754ms

===== Deploy 2 — warm, identical payload =====
[deploy] wall=12792ms  server totalMs=12452
  docker_build             7759ms    ← all layers CACHED
  stop_old_container       3419ms

===== Deploy 3 — warm, edited payload =====
[deploy] wall=12414ms  server totalMs=11950
  docker_build             6789ms    ← only COPY . . rebuilds
[host-skip] Image already in target daemon (host provider — skipped save/load)
```

**Layer-cache trace** — `./scripts/test-build-cache.sh <ssh-target>`

SSHes into the droplet and runs three bare `docker build` invocations with the same BuildKit flags the engine uses. Greps the CACHED/DONE lines so you can confirm layer cache behavior independent of the MCP pipeline. Requires the SSH target as an argument — nothing is hardcoded.

```bash
./scripts/test-build-cache.sh root@your-droplet.example.com
```

Sample output on a warm (all-cached) build:

```
#7 [2/5] WORKDIR /app                              CACHED
#8 [3/5] COPY package.json ...                     CACHED
#9 [4/5] RUN npm install --production ...          CACHED
#10 [5/5] COPY . .                                 CACHED
real    0m1.586s
```

### What to expect

A 1 vCPU droplet with a `node:20-alpine` base, small project, roughly:

| Scenario | `docker_build` | Total deploy |
|---|---|---|
| Cold (first deploy of an app) | 13–19 s | 16–24 s |
| Warm, identical redeploy | 6–8 s | 12–13 s |
| Warm, one-line code edit | 6–7 s | 11–12 s |

The warm floor is dominated by `docker_build` overhead (buildx session startup, context transfer, manifest generation — ~6 s even when every layer is CACHED) plus `stop_old_container` (~3 s) and `start_container` (~1–3 s). Bare `docker build` with everything cached is ~1.5–3 s on the same hardware; the delta is MCP pipeline overhead. Faster hardware (e.g. an M-series Mac) drops an all-cached `docker build` below 1 s — the last few seconds on the droplet are mostly hardware, not a bug.

## Tech stack

[Bun](https://bun.sh) / TypeScript / Docker / nginx / MCP / StreamableHTTP
