# DOVU App PaaS

An MCP-native internal app deploy layer for turning AI-built projects into live URLs instantly.

---

DOVU App PaaS is an MCP-native internal deploy layer for trusted teams.
It lets Claude Code or a developer turn a project into a live app with a stable name and shareable URL in one step.

- Built for internal tools, previews, and AI-generated apps
- Runs locally or on a remote box
- Controlled through MCP and CLI
- Current security model is trusted-team auth, not hardened multi-tenant hosting

## How it works

1. **Tell Claude Code what to build.** Describe the app, API, tool, or prototype you want.
2. **Choose the app name.** A stable name like `dashboard` or `invoice-tool`.
3. **Claude calls the MCP server.** The `deploy` tool builds, ships, and routes the app.
4. **A URL comes back immediately.** The app is live. Share the link.
5. **Inspect, redeploy, or destroy through MCP.** `logs`, `status`, `ls`, and `destroy` are all available as MCP tools in the same conversation.

The same workflow works from the CLI: `dovu-app deploy --name dashboard`.

## Why it exists

To collapse time from idea to live software.

When a trusted team member can say "build me X" and get a live URL back in under a minute, the bottleneck shifts from deployment to imagination. Manual deployment work disappears for small internal tools, previews, prototypes, and AI-generated apps.

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

**GitHub Action: CI and branch preview wrapper.** The [GitHub Action](action.yml) wraps the core CLI for CI workflows. It deploys on push, destroys on branch delete, produces branch-aware URLs, and outputs the live URL for PR comments. The action is a distribution channel, not the product identity.

## Security

Bearer token authentication only, for now. Good enough for trusted team workflows where everyone deploying is known and internal.

Not positioned as hardened zero-trust infrastructure. Multi-tenant isolation, per-user auth, and network segmentation are future work. See [docs/security.md](docs/security.md).

---

## Getting started

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

See [docs/digitalocean.md](docs/digitalocean.md) for droplet provisioning.

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

## Providers

**Local** — Docker-in-Docker on your machine. Apps get `*.ops.localhost` domains. Good for development and testing.

**DigitalOcean** — Remote droplet via SSH. Images are cross-compiled for `linux/amd64` and transferred via SCP. Wildcard SSL via Let's Encrypt. One provisioning script sets up everything.

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

### Remote

```
┌───────────────────┐         ┌──────────────────────────────┐
│   Your machine     │  SSH    │         Droplet               │
│                    │ ──────► │                                │
│  dovu-app CLI      │  SCP    │  Docker + nginx + SSL         │
│  docker build      │ ──────► │  *.apps.yourdomain.com        │
└───────────────────┘         └──────────────────────────────┘
```

## Tests

```bash
bun test
```

## Tech stack

[Bun](https://bun.sh) / TypeScript / Docker / nginx / MCP
