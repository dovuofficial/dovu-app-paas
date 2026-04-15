# dovu-app-paas

One-command deployment of JS/TS/PHP projects to Docker containers. Zero config, automatic framework detection, wildcard domains, hot-reload dev mode.

**Both providers working:**
- **Local** — Docker-in-Docker on your machine, `*.ops.localhost` domains
- **DigitalOcean** — Remote droplet via SSH, wildcard SSL via Let's Encrypt. See [docs/digitalocean.md](docs/digitalocean.md)
- Security comparison with Forge, Coolify, raw droplets: [docs/security.md](docs/security.md)

## Quick start (local)

```bash
# Prerequisites: Bun, Docker Desktop running
bun install

# Initialize (creates a Docker-in-Docker "mini-droplet" with nginx)
bun run dev init    # select "local"

# Deploy any project
cd your-project
dovu-app deploy

# That's it. Live at http://your-project.ops.localhost
```

## Quick start (DigitalOcean)

```bash
# Prerequisites: Bun, a provisioned droplet (see docs/digitalocean.md)
bun run dev init    # select "digitalocean", enter IP, SSH key, base domain

cd your-project
dovu-app deploy

# Live at https://your-project.apps.yourdomain.com (with SSL)
```

## Setup

### Requirements

- [Bun](https://bun.sh) v1.3+
- [Docker Desktop](https://docker.com/products/docker-desktop) running
- macOS or Linux (Windows untested)

### Install

```bash
git clone <repo>
cd dovu-app-paas
bun install
```

### Initialize

```bash
dovu-app init
```

**Local:** Select `local`. Creates a Docker-in-Docker container with nginx on port 80. Wildcard `*.ops.localhost` domains resolve natively.

**DigitalOcean:** Select `digitalocean`. Enter your droplet IP, SSH key path, SSH user (`deploy` recommended — not root), and base domain. See [docs/digitalocean.md](docs/digitalocean.md) for full provisioning guide.

## Commands

| Command | Description |
|---------|-------------|
| `dovu-app init` | Initialize provider (local or digitalocean) |
| `dovu-app deploy` | Deploy current directory |
| `dovu-app dev` | Hot-reload dev mode with volume mount |
| `dovu-app ls` | List all deployments with status |
| `dovu-app status <app>` | CPU, memory, uptime, warnings |
| `dovu-app logs <app>` | Stream container logs |
| `dovu-app stop <app>` | Stop a deployment (nginx disabled) |
| `dovu-app destroy <app>` | Remove deployment completely |
| `dovu-app redeploy-all` | Redeploy all apps from state (after droplet reboot) |

Run commands with:

```bash
dovu-app <command>

# or via bun:
bun run dev <command>
```

### Deploy

```bash
cd my-project
dovu-app deploy
```

Options:

```
--name <name>       Override app name (default: directory name)
--domain <domain>   Use a custom domain instead of <name>.<baseDomain>
-e KEY=VALUE        Set environment variables (repeatable)
```

Environment variables are also read from `.env` files in the project directory. CLI flags override `.env` values.

When deploying to DigitalOcean, images are automatically cross-compiled for `linux/amd64` and transferred via SCP. SSL is configured automatically using the wildcard certificate.

### Dev mode

```bash
cd my-project
dovu-app dev
```

Runs your project in a container with the source code volume-mounted for hot reload. On exit (Ctrl+C), the deployed container is restored. Dev mode is local-only.

Options:

```
--name <name>       Override app name
```

### Redeploy all

```bash
dovu-app redeploy-all
```

Reads the state file and redeploys all apps. For each app:
- If already running — skips
- If container exists but stopped — restarts it
- If container is gone (droplet reset) — full rebuild from source

## Framework detection

Inspects your project and auto-detects:

| Framework | Detection | Runtime | Port |
|-----------|-----------|---------|------|
| **Bun** | `bun.lockb` or default | `oven/bun:1-alpine` | Scanned from source, fallback 3000 |
| **Node.js** | `package.json` engines | `node:20-alpine` | Scanned from source, fallback 3000 |
| **Next.js** | `next.config.*` or `next` in deps | `node:20-alpine` (3-stage build) | 3000 |
| **Laravel** | `artisan` file or `laravel/framework` in composer.json | `php:8.4-cli` | 8000 |
| **Custom** | `Dockerfile` present | Your Dockerfile | Your config |

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
│  │  │simple│ │ api  │ │nextjs│ │laravel│  ...  │  │
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

## How deployment works

1. **Inspect** — detect runtime, framework, entrypoint, port
2. **Build** — generate Dockerfile if needed, `docker build` (cross-compile for remote)
3. **Ship** — `docker save` to tarball, SCP to target, `docker load`
4. **Run** — `docker run` bound to `127.0.0.1`, with memory/CPU limits, auto-restart
5. **Route** — write nginx config (with SSL for DO), reload nginx
6. **State** — save to `.dovu-app-paas/state.json`

Re-deploys automatically stop and replace the old container.

## Sandbox demos

The `sandbox-demo/` directory contains test projects for each supported framework:

| Demo | Type | Description |
|------|------|-------------|
| `simple/` | Bun | Minimal `Bun.serve()` — returns "hello!" |
| `api/` | Bun | REST API with SQLite CRUD (`/keys` endpoint) |
| `website/` | Bun | Static file server with landing page |
| `ui/` | Bun | Frontend app |
| `watcher/` | Bun | Long-running background process |
| `nextjs/` | Next.js | Default Next.js 16 app |
| `laravel/` | Laravel | Laravel 13 with SQLite |
| `luminus-app/` | Clojure | Luminus framework with Undertow + SQLite |

Deploy all locally:

```bash
for dir in simple api website ui nextjs laravel luminus-app; do
  (cd sandbox-demo/$dir && dovu-app deploy --name $dir)
done
```

Local URLs:
- http://simple.ops.localhost
- http://api.ops.localhost
- http://website.ops.localhost
- http://nextjs.ops.localhost
- http://laravel.ops.localhost

## Droplet provisioning

Provision a fresh DigitalOcean droplet with one script:

```bash
ssh root@<droplet-ip> 'bash -s' < scripts/provision-droplet.sh
```

Installs Docker, nginx, certbot, fail2ban, creates `deploy` user, gets wildcard SSL cert, configures firewall and rate limiting. See [docs/digitalocean.md](docs/digitalocean.md) for full details.

## Project structure

```
src/
  cli/
    index.ts          CLI entry point (commander)
    init.ts           Provider setup
    deploy.ts         Build + ship + run pipeline
    dev.ts            Hot-reload dev mode
    ls.ts             List deployments
    status.ts         Container stats + warnings
    logs.ts           Stream container logs
    stop.ts           Stop deployment
    destroy.ts        Full removal
    redeploy.ts       Redeploy all from state
  engine/
    rules.ts          Framework + runtime detection
    docker.ts         Dockerfile generation + cross-compilation
    nginx.ts          Reverse proxy config (HTTP + HTTPS)
    state.ts          JSON state management
  providers/
    provider.ts       Provider interface
    local.ts          Docker-in-Docker local provider
    digitalocean.ts   SSH/SCP remote provider
    resolve.ts        Provider factory
  types.ts            TypeScript interfaces
tests/
  engine/             Rules, Docker, nginx, state tests
  providers/          Provider interface tests
scripts/
  provision-droplet.sh  One-command droplet provisioning
docs/
  digitalocean.md     DO provisioning + SSL guide
  security.md         Security posture + comparison with Forge, Coolify, etc.
```

## Tests

```bash
bun test
```

23 tests across 5 files covering framework detection, Dockerfile generation, nginx config, state management, and provider interface compliance.

## Local provider details

The local provider creates a single container named `dovu-app-paas-mini-droplet`:

- **Image:** `docker:dind` (Docker-in-Docker)
- **Port mapping:** `80:80` (nginx)
- **Nginx:** Installed via `apk add nginx`, configs in `/etc/nginx/http.d/`
- **Domains:** `*.ops.localhost` resolves to `127.0.0.1` natively
- **Storage:** All images and containers live inside the mini-droplet

To reset everything:

```bash
docker rm -f dovu-app-paas-mini-droplet
rm .dovu-app-paas/state.json
dovu-app init   # recreates the mini-droplet
```

## Tech stack

- **Runtime:** [Bun](https://bun.sh)
- **CLI:** [Commander.js](https://github.com/tj/commander.js)
- **Containers:** Docker (Docker-in-Docker for local, native Docker for DO)
- **Proxy:** nginx with Let's Encrypt SSL
- **SSH:** ssh2 + SCP (for DigitalOcean provider)
- **Language:** TypeScript (strict mode, path aliases)
