# DOVU App PaaS

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
3. **Claude calls the MCP server.** The `deploy` tool builds, ships, and routes the app.
4. **A URL comes back immediately.** The app is live. Share the link.
5. **Inspect, redeploy, or destroy through MCP.** `logs`, `status`, `ls`, and `destroy` are all available as MCP tools in the same conversation.

The same workflow works from the CLI: `dovu-app deploy --name dashboard`.

## Remote MCP server

The remote MCP server runs on the droplet and lets your whole team deploy through Claude Code without needing SSH keys, repo access, or local setup.

### Team onboarding — one command

```
claude mcp add deploy-ops --transport http https://mcp.apps.yourdomain.com/mcp --header "Authorization: Bearer <token>"
```

That's it. The deploy tools appear in their next Claude Code conversation.

### How remote deploy works

When someone says "build me a landing page," Claude Code:

1. Writes the project locally
2. Tars and base64-encodes the source
3. Sends it as the `source` parameter to the `deploy` tool
4. The remote MCP server unpacks it, builds a Docker image, starts a container, configures nginx
5. Returns a live HTTPS URL like `https://landing-page-alice.apps.yourdomain.com`

The `deployer` parameter bakes identity into the subdomain — you can see who deployed what just by looking at URLs.

### Limits

The `source` parameter sends project code as a base64-encoded tar.gz inside a JSON-RPC message. This is bounded by the nginx `client_max_body_size` on the MCP server.

With a standard `client_max_body_size 10m`, you get room for roughly **7.5MB of gzipped source** before base64 encoding — which translates to approximately **15-20MB of uncompressed** static site content (HTML, CSS, JS, SVGs).

In practice, with images and videos served from a CDN, you could scale to hundreds of pages before hitting the limit. The bottleneck is the nginx body size on the MCP server, not the site itself. A static Astro site with CDN media is essentially just HTML + CSS + JS — it stays small.

For projects that exceed this (large binary assets checked into the repo), you'd use the CLI or GitHub Action deploy path instead.

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

**Core: deploy engine + MCP server.** The core repo is the product. The MCP server (`src/mcp/`) exposes `deploy`, `dev`, `ls`, `status`, `logs`, and `destroy` as tools. The CLI (`src/cli/`) provides the same commands from the terminal. The deploy engine handles framework detection, container builds, routing, and state.

**Remote MCP server.** The HTTP transport (`src/mcp/remote.ts`) runs on the droplet behind nginx with bearer token auth. Team members connect via Claude Code with a single command. Code is uploaded as base64 tar.gz in the `source` parameter.

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
| `deploy` | `name?`, `domain?`, `env?`, `deployer?`, `source?` | Deploy a project. Pass `source` (base64 tar.gz) for remote uploads. |
| `dev` | `name?`, `port?`, `env?`, `deployer?` | Start hot-reload dev mode |
| `ls` | — | List all deployments with live status |
| `status` | `app` | CPU, memory, uptime, restart count, warnings |
| `logs` | `app`, `lines?` | Get recent container logs |
| `destroy` | `app` | Remove deployment completely |

## Providers

**Local** — Docker-in-Docker on your machine. Apps get `*.ops.localhost` domains. Good for development and testing.

**DigitalOcean** — Remote droplet via SSH. Images are cross-compiled for `linux/amd64` and transferred via SCP. Wildcard SSL via Let's Encrypt. One provisioning script sets up everything.

**Host** — Direct shell execution on the droplet. Used by the remote MCP server when running on the same machine as Docker. No SSH overhead.

## Framework detection

The deploy engine auto-detects runtime, framework, entrypoint, and port from your project:

| Framework | Detection | Runtime |
|-----------|-----------|---------|
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

### Remote MCP (team deploy)

```
┌───────────────────┐         ┌──────────────────────────────┐
│   Claude Code      │  HTTPS  │         Droplet               │
│                    │ ──────► │                                │
│  writes code       │  bearer │  Bun.serve() MCP server       │
│  tar.gz + base64   │  token  │  unpack ► docker build ► run  │
│  deploy tool call  │         │  nginx ► SSL ► live URL       │
└───────────────────┘         └──────────────────────────────┘
```

## Tests

```bash
bun test
```

## Tech stack

[Bun](https://bun.sh) / TypeScript / Docker / nginx / MCP / StreamableHTTP
