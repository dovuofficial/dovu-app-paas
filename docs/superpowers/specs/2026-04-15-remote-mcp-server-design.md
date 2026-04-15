# Remote MCP Server — Design Spec

## Overview

A remote HTTP MCP server running on the DigitalOcean droplet, exposing the same 6 deploy-ops tools over StreamableHTTP transport. Secured with a shared bearer token. Team members connect via Claude Code CLI with a single command — no repo clone, no SSH keys, no local setup.

## Goal

Any team member or founder can:
1. Run one `claude mcp add` command
2. Ask Claude to build something and deploy it
3. Get back a link like `landing-page-alice.apps.dovu.ai`

Total onboarding friction: ~30 seconds.

## Team Onboarding

Matt shares two things over Slack:
1. The bearer token
2. The command:

```
claude mcp add deploy-ops --transport http https://mcp.apps.dovu.ai/mcp --header "Authorization: Bearer <token>"
```

That's it. Tools appear in their next Claude Code conversation.

## Architecture

```
Claude Code CLI
  ↓ HTTPS (Bearer token)
nginx (mcp.apps.dovu.ai)
  ↓ proxy_pass
Bun.serve() on localhost:8888
  ↓ WebStandardStreamableHTTPServerTransport
McpServer (same 6 tools)
  ↓
Provider (DigitalOcean — SSH to localhost, since server runs on the droplet)
  ↓
Docker containers + nginx app configs
```

Key insight: since the MCP server runs ON the droplet, the provider can exec docker commands locally instead of over SSH. This simplifies the provider — it's closer to the "local" provider but targeting the host docker daemon directly.

## Transport

Uses `WebStandardStreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` — the Web Standard variant that works natively with `Bun.serve()` (no Express, no Hono).

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/mcp` | Tool calls (JSON-RPC over StreamableHTTP) |
| GET | `/mcp` | SSE stream (server-to-client notifications) |
| DELETE | `/mcp` | Session teardown |
| GET | `/health` | Health check (no auth required) |

### Session Management

Each Claude Code connection gets its own `WebStandardStreamableHTTPServerTransport` instance, tracked by session ID in a `Map<string, transport>`. The SDK handles session lifecycle (creation on initialize, cleanup on delete).

## Auth

Bearer token. ~10 lines of middleware.

### How it works

1. Server reads `TEAM_SECRET` from environment on startup
2. Every request to `/mcp` checks `Authorization: Bearer <token>` header
3. Token must match `TEAM_SECRET` exactly
4. Mismatch or missing → 401 Unauthorized
5. `/health` endpoint is unauthenticated (for monitoring)

### Token management

- Matt SSHes into the droplet and sets `TEAM_SECRET` in the systemd service environment
- To rotate: change the value, restart the service, share new token over Slack
- No token store, no expiry, no refresh — the token is a shared secret, not a session

## Tool Changes

### New `deployer` parameter

The `deploy` and `dev` tools get an optional `deployer` parameter:

```
deployer: z.string().optional().describe("Name of the person deploying (used in subdomain, e.g. 'alice')")
```

**Subdomain logic:**
- If `deployer` is provided: `{app}-{deployer}.apps.dovu.ai`
- If omitted: `{app}.apps.dovu.ai` (existing behavior)

The deployer value is slugified (lowercase, hyphens, no spaces). The AI naturally asks "what's your name?" when the parameter is needed — it's just a tool input with a description.

### Shared tool registration

Tool registration is extracted from `src/mcp/index.ts` into a shared function so both stdio and remote servers use identical tools:

```
src/mcp/
  register.ts    # registerTools(server) — registers all 6 tools
  index.ts       # Stdio transport (existing, calls registerTools)
  remote.ts      # HTTP transport + bearer auth (new, calls registerTools)
  config.ts      # Config resolution (existing)
  tools.ts       # Formatters (existing)
```

### Config resolution for remote server

The remote server runs on the droplet itself, so config is simpler:
- `DEPLOY_OPS_DOMAIN` — base domain (e.g. `apps.dovu.ai`) — required
- No `DEPLOY_OPS_HOST` or `DEPLOY_OPS_SSH_KEY` needed — commands run locally
- The remote server uses a "direct" execution mode: `Bun.spawn()` / `Bun.$` for docker and nginx commands instead of SSH

This means we need a lightweight provider variant (or the existing local provider adapted) that execs commands directly on the host. The simplest approach: a new `host` provider that runs shell commands directly via `Bun.$`, with the same interface as the other providers.

### Working directory difference

The stdio server uses `process.cwd()` because the user runs it from their project directory. The remote server doesn't have a "project directory" — code comes from the client. For v1, the remote server operates on a fixed working directory (e.g. `/opt/deploy-ops/workspace`) and state lives there. The `registerTools()` function accepts a `cwd` parameter rather than calling `process.cwd()` internally, so each entry point can pass the right value.

## Infrastructure

### nginx config for MCP endpoint

```nginx
server {
    listen 443 ssl;
    server_name mcp.apps.dovu.ai;

    ssl_certificate /etc/letsencrypt/live/apps.dovu.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/apps.dovu.ai/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8888;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_buffering off;
    }
}

server {
    listen 80;
    server_name mcp.apps.dovu.ai;
    return 301 https://$host$request_uri;
}
```

Note: `proxy_read_timeout 86400` and `proxy_buffering off` are important for SSE streams.

### systemd service

```ini
[Unit]
Description=deploy-ops MCP Server
After=network.target docker.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/deploy-ops
ExecStart=/usr/local/bin/bun run src/mcp/remote.ts
Restart=always
RestartSec=5
Environment=DEPLOY_OPS_DOMAIN=apps.dovu.ai
Environment=TEAM_SECRET=<token>
Environment=MCP_PORT=8888

[Install]
WantedBy=multi-user.target
```

### Provision script updates

`scripts/provision-droplet.sh` gets new steps:
1. Clone/update deploy-ops repo to `/opt/deploy-ops`
2. `bun install` in `/opt/deploy-ops`
3. Install the systemd service file
4. Add nginx config for `mcp.apps.dovu.ai`
5. Reload nginx, enable and start the service

## File Changes Summary

| File | Change |
|------|--------|
| `src/mcp/register.ts` | **New** — extracted tool registration function |
| `src/mcp/remote.ts` | **New** — HTTP MCP server with Bun.serve() + bearer auth |
| `src/mcp/index.ts` | **Modified** — import and call registerTools() instead of inline registration |
| `src/providers/host.ts` | **New** — direct shell execution provider (for on-droplet use) |
| `scripts/provision-droplet.sh` | **Modified** — add MCP service setup |
| `scripts/deploy-ops-mcp.service` | **New** — systemd unit file |
| `scripts/mcp-nginx.conf` | **New** — nginx config template |

## Error Handling

- **Invalid/missing token** — 401 with `{"error": "Unauthorized"}`
- **Server not configured** — tools return clear error about missing `DEPLOY_OPS_DOMAIN`
- **Docker command failures** — tools return the error output from the failed command
- **Session not found** — SDK handles automatically (404)

## Out of Scope

- OAuth 2.1 (not needed for Claude Code CLI bearer auth)
- Per-user identity beyond the `deployer` tool parameter
- Permission tiers (everyone can do everything)
- Persistent token storage or expiry
- Rate limiting
- claude.ai web integration (blocked by Connectors registration requirement)
- CORS (not needed — Claude Code CLI is not a browser)
