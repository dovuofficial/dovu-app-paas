# deploy-ops v1 Design Spec

## Overview

deploy-ops is a CLI tool that enables instant deployment of JS/TS (Bun) projects as Docker containers to pre-provisioned infrastructure. It inspects a project, builds a Docker image, ships it to a target machine, runs it, and configures nginx — all in one command.

The system uses a provider abstraction so that the same deployment structure works identically whether targeting a local Docker environment or a remote DigitalOcean droplet. A static rules engine determines deployment configuration automatically from project files.

Future vision: a UI where non-technical users deploy programs (e.g., DOVU OS audit trail validation nodes) with zero skill, pay monthly, and monitor usage. v1 is the CLI foundation that makes this possible.

## Architecture

### Components

```
Developer Machine                          Target (Local or Remote)
┌─────────────────────────┐                ┌─────────────────────────┐
│  deploy-ops CLI (Bun)   │                │  Nginx                  │
│  ├── Command Router     │   SCP / exec   │  ├── *.ops.localhost    │
│  ├── Rules Engine       │ ──────────────>│  └── *.apps.domain.com  │
│  ├── Docker Build       │                │                         │
│  ├── Provider Adapter   │                │  Docker Engine           │
│  └── State Manager      │                │  ├── [App A] :3001      │
│                         │                │  ├── [App B] :3002      │
│  .deploy-ops/           │                │  └── [App C] :3003      │
│  ├── config.json        │                │                         │
│  └── state.json         │                └─────────────────────────┘
└─────────────────────────┘
```

### Provider Abstraction

A provider is an adapter that handles transport and execution. Core deployment logic (rules engine, state management, nginx templating, Docker image building) is provider-agnostic.

**Provider interface:**

```typescript
interface Provider {
  // Transfer a Docker image tarball to the target
  transferImage(tarballPath: string): Promise<void>;

  // Execute a command on the target, return stdout
  exec(command: string): Promise<string>;

  // The base domain for wildcard routing
  baseDomain: string;

  // Setup/teardown for the provider itself
  setup(): Promise<void>;
  teardown(): Promise<void>;
}
```

**v1 providers:**

| Provider | Transport | Execution | Base Domain | Use Case |
|---|---|---|---|---|
| `local` | `docker exec` pipe | `docker exec` | `ops.localhost` | Local development/testing |
| `digitalocean` | SCP over SSH | SSH | User-configured | Production deployments |

The local provider spins up a "mini-droplet" container (Docker-in-Docker + nginx) bound to port 80 on localhost. `*.ops.localhost` resolves to 127.0.0.1 natively in browsers — zero DNS configuration required.

### State Management

**Config file** (`.deploy-ops/config.json`) — created by `deploy-ops init`:

```json
{
  "provider": "digitalocean",
  "digitalocean": {
    "host": "164.90.xxx.xxx",
    "sshKey": "~/.ssh/id_ed25519",
    "user": "root",
    "baseDomain": "apps.example.com"
  }
}
```

Or for local mode:

```json
{
  "provider": "local",
  "local": {
    "baseDomain": "ops.localhost"
  }
}
```

**State file** (`.deploy-ops/state.json`) — managed by the CLI:

```json
{
  "deployments": {
    "myapp": {
      "name": "myapp",
      "image": "deploy-ops-myapp:a1b2c3d",
      "port": 3000,
      "hostPort": 3001,
      "domain": "myapp.apps.example.com",
      "containerId": "a1b2c3d4e5f6",
      "status": "running",
      "createdAt": "2026-04-14T12:00:00Z",
      "updatedAt": "2026-04-14T12:00:00Z"
    }
  }
}
```

State file is the source of truth for "what should exist." The target machine is the source of truth for "what actually exists." CLI commands reconcile these when needed.

## CLI Commands

### `deploy-ops init`

Interactive setup. Prompts for provider choice, then provider-specific config.

```
$ deploy-ops init
? Provider: (local / digitalocean)
> local

✓ Config saved to .deploy-ops/config.json
✓ Mini-droplet container started
✓ Nginx ready on localhost:80
✓ Deploy with: deploy-ops deploy
```

For DigitalOcean:

```
$ deploy-ops init
? Provider: (local / digitalocean)
> digitalocean
? Droplet IP: 164.90.xxx.xxx
? SSH key path: ~/.ssh/id_ed25519
? SSH user: root
? Wildcard base domain: apps.example.com

✓ Connection verified
✓ Docker detected on droplet
✓ Nginx detected on droplet
✓ Config saved to .deploy-ops/config.json
```

### `deploy-ops deploy`

Run from a project directory. Inspects, builds, ships, runs, configures.

```
$ deploy-ops deploy
Inspecting project...
  Runtime: bun
  Entrypoint: src/index.ts
  Port: 3000

Building image...  [2.1s]
Shipping to droplet...  [1.4s]
Starting container...  [0.3s]
Configuring nginx...  [0.2s]

✓ Deployed: myapp
  URL: http://myapp.ops.localhost
  Container: a1b2c3d4
```

**Re-deploy behavior:** If an app with the same name already exists, `deploy` replaces it — builds a new image, stops the old container, removes it, runs the new one. The domain and nginx config stay the same. This is the update path.

**Flags:**
- `--name <name>` — override app name (default: directory name)
- `--domain <domain>` — use a custom domain instead of wildcard subdomain

### `deploy-ops ls`

```
$ deploy-ops ls
NAME       STATUS    DOMAIN                      UPTIME
myapp      running   myapp.ops.localhost          2h 14m
api        running   api.ops.localhost            45m
worker     stopped   worker.ops.localhost         —
```

### `deploy-ops status <app>`

```
$ deploy-ops status myapp
Name:       myapp
Status:     running
Domain:     http://myapp.ops.localhost
Container:  a1b2c3d4
Uptime:     2h 14m
Image:      deploy-ops-myapp:a1b2c3d

Resources:
  CPU:      2.3%
  Memory:   48.2 MiB / 512 MiB

Warnings:
  (none)
```

When there are warnings:

```
Warnings:
  ⚠ Container has restarted 3 times
  ⚠ Memory usage at 89% of limit
```

### `deploy-ops logs <app>`

Streams container logs via SSH / docker exec.

```
$ deploy-ops logs myapp
[2026-04-14 12:00:01] Server started on port 3000
[2026-04-14 12:00:05] GET / 200 12ms
...
```

Streams until Ctrl+C.

### `deploy-ops stop <app>`

Stops the container. Keeps image and state. Marks nginx inactive.

```
$ deploy-ops stop myapp
✓ Container stopped
✓ Nginx config disabled
```

### `deploy-ops destroy <app>`

Removes container, image, and nginx config. Removes from state.

```
$ deploy-ops destroy myapp
? Remove myapp and all its data? (y/N) y
✓ Container removed
✓ Image removed
✓ Nginx config removed
✓ Removed from state
```

## Rules Engine

The rules engine inspects a project directory and produces a deployment config. No user input required.

### Inspection Steps

1. **Check for existing Dockerfile** — if present, use it. User knows best.
2. **Detect runtime** — presence of `bun.lockb` → Bun. Otherwise check `package.json` engines field. Fallback: Bun.
3. **Find entrypoint** — check `package.json` `scripts.start`, then look for `index.ts`, `server.ts`, `app.ts`, `main.ts` in root and `src/`.
4. **Detect port** — scan entrypoint for `.listen()` calls, check for `PORT` env var usage, check start script for `--port` flags. Fallback: 3000.

### Dockerfile Generation

When no Dockerfile exists, generate one:

```dockerfile
FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production
COPY . .
EXPOSE {port}
CMD ["bun", "run", "{entrypoint}"]
```

### Host Port Allocation

- Query existing deployments in state.json
- Find next available port starting from 3001
- Each new deployment gets the next free port

### Nginx Config Generation

```nginx
server {
    listen 80;
    server_name {app}.{baseDomain};

    location / {
        proxy_pass http://127.0.0.1:{hostPort};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

WebSocket headers included by default. Custom domain support via `--domain` flag replaces the `server_name`.

## Local Provider Detail

`deploy-ops init --local` (or selecting "local" during init) creates a Docker container that acts as the mini-droplet:

- Runs Docker-in-Docker (DinD) + nginx
- Binds port 80 to localhost
- `*.ops.localhost` resolves to 127.0.0.1 natively in browsers (no DNS config)
- Image transfer: `docker save | docker exec -i mini-droplet docker load`
- Command execution: `docker exec mini-droplet <command>`

The mini-droplet container is managed by the CLI — created on `init`, available across deploys, removable via `deploy-ops teardown`.

## Project Structure

```
deploy-ops/
├── src/
│   ├── cli/
│   │   ├── index.ts            # Entry point, command routing
│   │   ├── init.ts             # deploy-ops init
│   │   ├── deploy.ts           # deploy-ops deploy
│   │   ├── destroy.ts          # deploy-ops destroy
│   │   ├── ls.ts               # deploy-ops ls
│   │   ├── logs.ts             # deploy-ops logs <app>
│   │   ├── stop.ts             # deploy-ops stop <app>
│   │   └── status.ts           # deploy-ops status <app>
│   ├── engine/
│   │   ├── rules.ts            # Static rules engine
│   │   ├── docker.ts           # Build image, save tarball
│   │   ├── nginx.ts            # Generate nginx config
│   │   └── state.ts            # Read/write state.json
│   ├── providers/
│   │   ├── provider.ts         # Provider interface
│   │   ├── local.ts            # Local Docker-in-Docker provider
│   │   └── digitalocean.ts     # DigitalOcean SSH provider
│   └── types.ts                # Shared types
├── templates/
│   ├── Dockerfile.bun          # Default Dockerfile for Bun projects
│   └── nginx.conf.tmpl         # Nginx site config template
├── package.json
├── bunfig.toml
└── tsconfig.json
```

## Not In v1

- SSL/HTTPS (user can add certbot separately)
- LLM-assisted configuration
- Container registry
- Droplet provisioning
- UI / dashboard
- Billing / payments
- Multi-node / clustering
- Database provisioning
- Custom environment variables beyond PORT
- Multi-process apps
