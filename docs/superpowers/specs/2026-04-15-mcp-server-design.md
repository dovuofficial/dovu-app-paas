# deploy-ops MCP Server — Design Spec

## Overview

An MCP tool server (stdio transport) that exposes deploy-ops commands as tools. Any MCP-compatible AI client (Claude Code, etc.) can deploy, monitor, and manage apps on a user's DigitalOcean droplet during development.

## Tools

| Tool | Parameters | Returns |
|------|-----------|---------|
| `deploy` | `name?`, `domain?`, `env?` | URL, container ID |
| `dev` | `name?`, `port?`, `env?` | Local dev URL |
| `status` | `app` (required) | CPU, memory, uptime, warnings |
| `logs` | `app` (required), `lines?` (default 50) | Log output |
| `ls` | none | List of deployments with status |
| `destroy` | `app` (required) | Confirmation message |

### Tool Details

**deploy** — Deploys the current working directory to the configured droplet. Runs the same pipeline as the CLI: inspect project, build Docker image, transfer, run container, configure nginx. Returns the deployed URL and container ID.

**dev** — Starts hot-reload dev mode with volume mount. Returns the local dev URL. Note: managing the background process lifecycle (cleanup on exit) is complex in MCP context — v1 may return instructions for the user to stop manually.

**status** — Returns structured data: CPU percentage, memory usage (MB and percentage), uptime, restart count, and warnings (high memory, frequent restarts).

**logs** — Returns the last N lines of container logs. Default 50, configurable via `lines` parameter.

**ls** — Returns a list of all deployments with name, domain, status, and container ID.

**destroy** — Removes a deployment (container, image, nginx config, state). Always runs with `--force` (no interactive prompt in MCP context).

## Config Resolution

Order of precedence (first found wins):

1. **Environment variables** — set in the MCP server config or shell profile:
   - `DEPLOY_OPS_HOST` — Droplet IP address (required)
   - `DEPLOY_OPS_SSH_KEY` — Path to SSH private key (required)
   - `DEPLOY_OPS_USER` — SSH username (optional, defaults to `deploy`)
   - `DEPLOY_OPS_DOMAIN` — Base domain (required, e.g. `apps.dovu.ai`)

2. **Project config** — `.dovu-app-paas/config.json` in the working directory (created by `dovu-app init`)

3. **Error** — if neither provides connection info, tools return a clear error explaining what to configure.

## MCP Server Configuration

User adds to their Claude Code settings (`~/.claude/claude_desktop_config.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "deploy-ops": {
      "command": "bun",
      "args": ["run", "/path/to/deploy-ops/src/mcp/index.ts"],
      "env": {
        "DEPLOY_OPS_HOST": "104.248.170.42",
        "DEPLOY_OPS_SSH_KEY": "~/.ssh/id_ed25519",
        "DEPLOY_OPS_DOMAIN": "apps.dovu.ai"
      }
    }
  }
}
```

## Architecture

A thin MCP layer over the existing engine and provider code.

### File Structure

```
src/mcp/
  index.ts          # MCP server setup, stdio transport, tool registration
  tools.ts          # Tool definitions (schemas) and handlers
  config.ts         # Config resolution (env vars -> project config -> error)
```

### How Tools Work

Each tool handler:
1. Resolves config via `config.ts` (env vars first, then project config)
2. Creates the appropriate provider (DigitalOcean or local)
3. Calls existing engine functions (`inspectProject`, `buildImage`, `saveImage`, etc.) and provider methods
4. Returns structured JSON results to the AI client

The key difference from the CLI: tools return structured data instead of printing to stdout with chalk colors. The existing engine code (`src/engine/*`) and providers (`src/providers/*`) stay untouched.

### Dependencies

Uses the `@modelcontextprotocol/sdk` package for MCP server implementation. The SDK provides:
- `Server` class with stdio transport
- Tool registration with JSON Schema input validation
- Structured result formatting

## Error Handling

- **Missing config** — tool returns error message listing which env vars or config fields are missing, with setup instructions
- **SSH connection failure** — tool returns error with host/user info for debugging
- **Container not found** — tool returns error with available app names (from `ls`) so the AI can suggest the correct name
- **Build failure** — tool returns the Docker build error output
- **Port conflict** — handled automatically (same as CLI — finds next available port)

## Out of Scope (v1)

- `init`, `stop`, `redeploy-all` tools
- MCP resources or prompts
- Streaming logs (return last N lines only)
- `dev` mode background process lifecycle management (may just start and return, with manual stop)
- Local provider support (DigitalOcean only for v1 — local provider can be added later)
