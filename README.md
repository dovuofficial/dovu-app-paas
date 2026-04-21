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
3. **Claude calls the MCP server.** For static sites, `prewarm` reserves the URL in ~200ms, then `deploy` uploads the built content in chunks. For dynamic apps, `deploy` builds a Docker image and runs it.
4. **A URL comes back immediately.** The app is live. Share the link.
5. **Inspect, redeploy, or destroy through MCP.** `logs`, `status`, `ls`, and `destroy` are all available as MCP tools in the same conversation.

The same workflow works from the CLI: `dovu-app deploy --name dashboard`.

## Instant provisioning for static sites

Static sites (plain HTML, Astro build output, Vite static output, etc.) take a dedicated fast path that skips Docker entirely:

- **`prewarm({name, framework: "static"})`** — allocates a subdomain, writes a placeholder page, configures nginx, reloads. **~200 ms.** The URL is live immediately with a "provisioning…" placeholder so it can be shared before the content is built.
- **`deploy({name, chunk: {index, total, data}})`** — uploads the built site as many small chunks of base64. The final chunk assembles the payload, extracts it into a fresh revision directory, and flips the nginx-served symlink atomically. **~100 ms per deploy after the first.** Old revisions are cleaned up asynchronously.
- **`destroy({app})`** — removes the directory, nginx conf, and state record.

No container, no image build, no port allocation — nginx serves the files directly from a host directory via symlinked revisions (capistrano-style). Security: the nginx template hardens with `disable_symlinks on from=$document_root` and a dotfile deny block; tarballs are validated before extraction (rejects path traversal, absolute paths, symlinks, hardlinks, PAX long-names).

Dynamic runtimes (Bun, Node, Next.js, Laravel, custom Dockerfile) continue to use the container path — identical developer experience, just with build + ship time.

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
3. Tars, gzips, and base64-encodes the built output.
4. Splits the base64 into small chunks (~2 KB each) and calls `deploy` once per chunk with `chunk: {index, total, data}`.
5. The server buffers the chunks keyed by app name. The final chunk assembles the payload, validates, extracts into a fresh revision dir, and flips the symlink.
6. Returns a live HTTPS URL like `https://landing-page-alice.apps.yourdomain.com`.

For dynamic apps (Bun, Node, Next.js, Laravel, Dockerfile), steps 1 and 4 are replaced by a single `deploy({name, source})` call that triggers a full Docker build + ship + run on the server.

The `deployer` parameter bakes identity into the subdomain — you can see who deployed what just by looking at URLs.

### Upload contract and limits

There are two ways to upload source code to the MCP server's `deploy` tool:

**Chunked upload (preferred, required for anything non-trivial).** Pass `chunk: {index, total, data}` — one call per slice. Each slice is capped at **4 KB** of base64; ~2 KB is recommended. Non-final calls return `{received, total, complete: false}`. The final chunk triggers the real deploy.

**`source` parameter (fallback for tiny payloads).** Hard-capped at **8 KB** of base64. Anything larger is rejected with an instructional error that tells the caller to switch to chunks. LLM agents emit long tool arguments token-by-token and stall on large `source` blobs, so chunking is almost always the right path anyway.

The end-to-end cap is nginx's `client_max_body_size` on the MCP server (10 MB by default, ~7.5 MB of gzipped source after base64 overhead — covers 15-20 MB of uncompressed HTML/CSS/JS). For projects with large binary assets checked into the repo, use the CLI or GitHub Action deploy path instead.

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

**Remote MCP server.** The HTTP transport (`src/mcp/remote.ts`) runs on the droplet behind nginx with bearer token auth. Team members connect via Claude Code with a single command. Static sites flow through `prewarm` + chunked `deploy` (no Docker). Dynamic apps flow through `deploy` with source, triggering a Docker build + ship on the droplet.

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

## MCP tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `prewarm` | `name`, `framework: "static"`, `deployer?` | Allocate a URL and serve a placeholder in ~200 ms. Call this first for any static site. |
| `deploy` | `name?`, `domain?`, `env?`, `deployer?`, `source?`, `chunk?` | Deploy a project. For static warm-slots + any non-trivial payload, use `chunk: {index, total, data}` — one call per small slice. `source` is a fallback for payloads ≤8 KB base64. |
| `dev` | `name?`, `port?`, `env?`, `deployer?` | Start hot-reload dev mode |
| `ls` | — | List all deployments with live status |
| `status` | `app` | CPU, memory, uptime, restart count, warnings (static slots report `currentRevision` instead) |
| `logs` | `app`, `lines?` | Get recent container logs (no-op for static slots — directs to nginx access logs) |
| `destroy` | `app` | Remove deployment completely |

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

### Remote MCP (warm-slot static path)

```
┌───────────────────┐         ┌──────────────────────────────────┐
│   Claude Code      │  prewarm│         Droplet                   │
│                    │ ──────► │  ~200ms: dir + placeholder +      │
│  1. prewarm        │         │  nginx conf + reload → URL LIVE   │
│                    │         │                                    │
│  2. build static   │  chunk  │  buffers chunks keyed by name     │
│     tar+gzip+b64   │  chunk  │  ...                               │
│                    │  chunk  │  final chunk: extract → symlink   │
│  3. deploy chunks  │ ──────► │  swap → URL updates               │
└───────────────────┘         └──────────────────────────────────┘
```

## Tests

```bash
bun test
```

## Tech stack

[Bun](https://bun.sh) / TypeScript / Docker / nginx / MCP / StreamableHTTP
