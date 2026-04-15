# DOVU App PaaS

An MCP native internal app deploy layer for turning AI built projects into live URLs instantly.

---

DOVU App PaaS is an MCP native deploy layer for trusted teams.
It lets Claude Code or a developer turn a project into a live app with a stable name and shareable URL in one step.
Built for internal tools, previews, and AI generated software.
Runs locally or on a remote box.
Controlled through a simple deploy interface, with logs, status, redeploy, and destroy available through MCP and CLI.

## What it is

An MCP native deploy substrate for trusted teams.

It lets Claude Code or a developer deploy apps with a stable name and an instant URL. You give the app a name, call deploy, and get back a live link. No manual Docker, nginx, or SSL configuration.

It is built for internal speed, not general purpose multi-tenant hosting. The assumption is that everyone deploying is trusted, and the priority is collapsing time between "I have an idea" and "here's the URL."

## The main workflow

This is what actually happens:

1. **Tell Claude Code what to build.** Describe the app, API, tool, or prototype you want.
2. **Choose the app name.** Give it a stable, memorable name like `dashboard` or `invoice-tool`.
3. **Claude calls the MCP server.** The deploy tool handles everything: framework detection, Docker build, image transfer, container start, nginx routing, SSL.
4. **The app is built and deployed.** Runtime and framework are auto-detected. Dockerfile is generated if needed. The image is built and shipped to the target.
5. **A URL is returned immediately.** `https://dashboard.apps.yourdomain.com` or `http://dashboard.ops.localhost` depending on provider.
6. **Logs, status, redeploy, and destroy are available.** All through the same MCP interface or CLI.

The same workflow works from the CLI without Claude Code. `dovu-app deploy --name dashboard` does the same thing.

## Why it exists

To collapse time from idea to live software.

When a trusted team member can say "build me X" and get a live URL back in under a minute, the bottleneck shifts from deployment to imagination. Manual deployment work disappears for small internal tools, previews, prototypes, and AI generated apps.

## Current scope

Be clear about what this is and isn't right now:

- **Trusted internal team use.** Not designed for untrusted multi-tenant workloads.
- **Bearer token auth.** Good enough for internal workflows. Not hardened zero-trust.
- **Two providers.** Local (Docker-in-Docker, `*.ops.localhost`) and DigitalOcean (remote droplet via SSH, wildcard SSL via Let's Encrypt).
- **Branch-aware naming and cleanup.** Feature branches get prefixed names. Merged branches auto-destroy.
- **MCP control surface.** Deploy, dev, list, status, logs, and destroy are all MCP tools.
- **Not a full secure multi-tenant platform yet.** That's a future direction, not the current product.

## Product surfaces

### Core: deploy engine + MCP server

The core repo is the product. It contains:

- **MCP server** (`src/mcp/`) — exposes `deploy`, `dev`, `ls`, `status`, `logs`, and `destroy` as MCP tools. This is how Claude Code interacts with the deploy layer.
- **CLI** (`src/cli/`) — the same commands available from the terminal: `dovu-app deploy`, `dovu-app ls`, `dovu-app status`, `dovu-app logs`, `dovu-app destroy`, etc.
- **Deploy engine** (`src/engine/`) — framework detection, Dockerfile generation, nginx config, state management.
- **Providers** (`src/providers/`) — local Docker-in-Docker and DigitalOcean SSH/SCP.

### GitHub Action: CI and branch preview wrapper

The [GitHub Action](action.yml) is a thin wrapper around the core CLI for CI workflows:

- Deploys on push, destroys on branch delete
- Branch-aware naming (feature branches get prefixed URLs)
- Outputs the live URL for PR comments or downstream steps

The action is a distribution channel, not the product identity.

## Use cases

**Instant internal tools.** Tell Claude Code to build an admin dashboard, invoice generator, or data viewer. It deploys and you share the URL with your team.

**PR and branch preview deploys.** Every feature branch gets its own URL. Reviewers click a link instead of checking out code. Branch merges clean up automatically.

**AI generated prototypes shared by URL.** Build something speculative, deploy it, share the link, get feedback. If it's useful, keep it. If not, destroy it.

## Security

Bearer token authentication only, for now. This is good enough for trusted team workflows where everyone deploying is known and internal.

This is not positioned as hardened zero-trust infrastructure. If you need multi-tenant isolation, per-user auth, or network segmentation, that's future work. The current security posture is documented in [docs/security.md](docs/security.md).

## Commands

| Command | Description |
|---------|-------------|
| `dovu-app init` | Initialize provider (local or DigitalOcean) |
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

## Quick start

### Local

```bash
bun install
dovu-app init          # select "local"
cd your-project
dovu-app deploy
# Live at http://your-project.ops.localhost
```

### DigitalOcean

```bash
dovu-app init          # select "digitalocean", enter IP, SSH key, base domain
cd your-project
dovu-app deploy
# Live at https://your-project.apps.yourdomain.com (with SSL)
```

Droplet provisioning is a single script. See [docs/digitalocean.md](docs/digitalocean.md).

## Framework detection

| Framework | Detection | Runtime |
|-----------|-----------|---------|
| **Bun** | `bun.lockb` or default | `oven/bun:1-alpine` |
| **Node.js** | `package.json` engines | `node:20-alpine` |
| **Next.js** | `next.config.*` or `next` in deps | `node:20-alpine` (3-stage build) |
| **Laravel** | `artisan` or `laravel/framework` | `php:8.4-cli` |
| **Custom** | `Dockerfile` present | Your Dockerfile |

Port detection scans source files for `.listen(N)`, `port: N`, and `Bun.serve({ port: N })` patterns.

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
│  │     dovu-app-paas-mini-droplet (DinD)       │  │
│  │                                             │  │
│  │  nginx (port 80)                            │  │
│  │    *.ops.localhost ──► container:port        │  │
│  │                                             │  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │  │
│  │  │ app1 │ │ app2 │ │ app3 │ │ app4 │  ...  │  │
│  │  │:3001 │ │:3002 │ │:3003 │ │:3004 │       │  │
│  │  └──────┘ └──────┘ └──────┘ └──────┘       │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### DigitalOcean

```
┌───────────────────┐         ┌──────────────────────────────┐
│   Your machine     │  SSH    │     DigitalOcean Droplet      │
│                    │ ──────► │                                │
│  dovu-app CLI      │  SCP    │  Docker containers             │
│  docker build      │ ──────► │  nginx + Let's Encrypt SSL    │
│  (linux/amd64)     │         │  *.apps.yourdomain.com        │
└───────────────────┘         └──────────────────────────────┘
```

## Tests

```bash
bun test
```

## Tech stack

- **Runtime:** [Bun](https://bun.sh)
- **CLI:** [Commander.js](https://github.com/tj/commander.js)
- **Containers:** Docker
- **Proxy:** nginx with Let's Encrypt SSL
- **MCP:** Model Context Protocol server for AI tool integration
- **Language:** TypeScript
