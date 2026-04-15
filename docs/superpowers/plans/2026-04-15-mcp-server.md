# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP tool server (stdio) that exposes deploy-ops commands (deploy, dev, status, logs, ls, destroy) as tools for AI clients.

**Architecture:** A thin MCP layer (`src/mcp/`) that reuses existing engine and provider code. Config resolves from env vars first, then falls back to project `.dovu-app-paas/config.json`. Each tool handler calls the same functions the CLI uses but returns structured JSON instead of printing to stdout.

**Tech Stack:** `@modelcontextprotocol/sdk`, Bun, existing deploy-ops engine/providers

---

## File Structure

```
src/mcp/
  index.ts          # CREATE — MCP server setup, stdio transport, tool registration
  config.ts         # CREATE — Config resolution (env vars -> project config -> error)
  tools.ts          # CREATE — Tool definitions (schemas) and handlers
tests/mcp/
  config.test.ts    # CREATE — Tests for config resolution
  tools.test.ts     # CREATE — Tests for tool handler logic
```

---

### Task 1: Install MCP SDK dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the MCP SDK**

Run: `bun add @modelcontextprotocol/sdk`

- [ ] **Step 2: Verify installation**

Run: `bun -e "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; console.log('MCP SDK loaded')"`
Expected: prints "MCP SDK loaded"

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add @modelcontextprotocol/sdk dependency"
```

---

### Task 2: Create config resolution module

Config resolution checks env vars first, then falls back to the project config file. This is the foundation all tool handlers depend on.

**Files:**
- Create: `src/mcp/config.ts`
- Create: `tests/mcp/config.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/mcp/config.test.ts`:

```ts
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { resolveConfig } from "@/mcp/config";

describe("resolveConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("returns config from env vars when all are set", () => {
    process.env.DEPLOY_OPS_HOST = "1.2.3.4";
    process.env.DEPLOY_OPS_SSH_KEY = "~/.ssh/id_ed25519";
    process.env.DEPLOY_OPS_DOMAIN = "apps.example.com";
    delete process.env.DEPLOY_OPS_USER;

    const config = resolveConfig("/tmp/nonexistent");
    expect(config).toEqual({
      provider: "digitalocean",
      digitalocean: {
        host: "1.2.3.4",
        sshKey: "~/.ssh/id_ed25519",
        user: "deploy",
        baseDomain: "apps.example.com",
      },
    });
  });

  test("uses DEPLOY_OPS_USER when set", () => {
    process.env.DEPLOY_OPS_HOST = "1.2.3.4";
    process.env.DEPLOY_OPS_SSH_KEY = "~/.ssh/id_ed25519";
    process.env.DEPLOY_OPS_DOMAIN = "apps.example.com";
    process.env.DEPLOY_OPS_USER = "admin";

    const config = resolveConfig("/tmp/nonexistent");
    expect(config!.digitalocean!.user).toBe("admin");
  });

  test("returns null when env vars are partial and no project config", () => {
    process.env.DEPLOY_OPS_HOST = "1.2.3.4";
    delete process.env.DEPLOY_OPS_SSH_KEY;
    delete process.env.DEPLOY_OPS_DOMAIN;

    const config = resolveConfig("/tmp/nonexistent");
    expect(config).toBeNull();
  });

  test("returns null when no env vars and no project config", () => {
    delete process.env.DEPLOY_OPS_HOST;
    delete process.env.DEPLOY_OPS_SSH_KEY;
    delete process.env.DEPLOY_OPS_DOMAIN;

    const config = resolveConfig("/tmp/nonexistent");
    expect(config).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/mcp/config.test.ts`
Expected: FAIL — `resolveConfig` does not exist

- [ ] **Step 3: Implement config resolution**

In `src/mcp/config.ts`:

```ts
import { readFileSync } from "fs";
import { join } from "path";
import type { AppConfig } from "@/types";

export function resolveConfig(cwd: string): AppConfig | null {
  // 1. Try env vars first
  const host = process.env.DEPLOY_OPS_HOST;
  const sshKey = process.env.DEPLOY_OPS_SSH_KEY;
  const domain = process.env.DEPLOY_OPS_DOMAIN;
  const user = process.env.DEPLOY_OPS_USER || "deploy";

  if (host && sshKey && domain) {
    return {
      provider: "digitalocean",
      digitalocean: { host, sshKey, user, baseDomain: domain },
    };
  }

  // 2. Fall back to project config file
  try {
    const configPath = join(cwd, ".dovu-app-paas", "config.json");
    const data = readFileSync(configPath, "utf-8");
    return JSON.parse(data) as AppConfig;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/mcp/config.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/config.ts tests/mcp/config.test.ts
git commit -m "feat: add MCP config resolution (env vars -> project config)"
```

---

### Task 3: Create MCP server with `ls` and `status` tools

Start with the read-only tools. These don't modify any state and are the simplest to implement and test.

**Files:**
- Create: `src/mcp/index.ts`
- Create: `src/mcp/tools.ts`
- Create: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write failing tests for tool registration and ls/status handlers**

In `tests/mcp/tools.test.ts`:

```ts
import { test, expect, describe } from "bun:test";
import { formatDeploymentList, formatStatus } from "@/mcp/tools";

describe("formatDeploymentList", () => {
  test("returns empty array when no deployments", () => {
    const result = formatDeploymentList({});
    expect(result).toEqual([]);
  });

  test("returns formatted deployment entries", () => {
    const result = formatDeploymentList({
      "my-app": {
        name: "my-app",
        image: "dovu-app-paas-my-app:abc",
        port: 3000,
        hostPort: 3001,
        domain: "my-app.apps.dovu.ai",
        containerId: "abc123",
        status: "running",
        env: {},
        createdAt: "2026-04-15T00:00:00Z",
        updatedAt: "2026-04-15T00:00:00Z",
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("my-app");
    expect(result[0].domain).toBe("my-app.apps.dovu.ai");
    expect(result[0].status).toBe("running");
  });
});

describe("formatStatus", () => {
  test("formats running container stats", () => {
    const result = formatStatus(
      {
        name: "my-app",
        image: "dovu-app-paas-my-app:abc",
        port: 3000,
        hostPort: 3001,
        domain: "my-app.apps.dovu.ai",
        containerId: "abc123",
        status: "running",
        env: {},
        createdAt: "2026-04-15T00:00:00Z",
        updatedAt: "2026-04-15T00:00:00Z",
      },
      { running: true, cpu: "0.50%", memory: "45MiB / 256MiB", restartCount: 0, uptime: "2h 30m" }
    );
    expect(result.name).toBe("my-app");
    expect(result.running).toBe(true);
    expect(result.cpu).toBe("0.50%");
    expect(result.memory).toBe("45MiB / 256MiB");
  });

  test("formats stopped container", () => {
    const result = formatStatus(
      {
        name: "my-app",
        image: "dovu-app-paas-my-app:abc",
        port: 3000,
        hostPort: 3001,
        domain: "my-app.apps.dovu.ai",
        containerId: "abc123",
        status: "stopped",
        env: {},
        createdAt: "2026-04-15T00:00:00Z",
        updatedAt: "2026-04-15T00:00:00Z",
      },
      { running: false, cpu: null, memory: null, restartCount: 0, uptime: null }
    );
    expect(result.running).toBe(false);
    expect(result.cpu).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/mcp/tools.test.ts`
Expected: FAIL — `formatDeploymentList` and `formatStatus` do not exist

- [ ] **Step 3: Implement tool formatting helpers**

In `src/mcp/tools.ts`:

```ts
import type { DeploymentRecord } from "@/types";

export interface ContainerStats {
  running: boolean;
  cpu: string | null;
  memory: string | null;
  restartCount: number;
  uptime: string | null;
}

export interface DeploymentListEntry {
  name: string;
  domain: string;
  status: string;
  containerId: string;
}

export interface StatusResult {
  name: string;
  domain: string;
  running: boolean;
  containerId: string;
  image: string;
  cpu: string | null;
  memory: string | null;
  restartCount: number;
  uptime: string | null;
  warnings: string[];
}

export function formatDeploymentList(
  deployments: Record<string, DeploymentRecord>
): DeploymentListEntry[] {
  return Object.values(deployments).map((dep) => ({
    name: dep.name,
    domain: dep.domain,
    status: dep.status,
    containerId: dep.containerId,
  }));
}

export function formatStatus(
  dep: DeploymentRecord,
  stats: ContainerStats
): StatusResult {
  const warnings: string[] = [];
  if (stats.restartCount > 0) {
    warnings.push(`Container has restarted ${stats.restartCount} time${stats.restartCount > 1 ? "s" : ""}`);
  }
  if (stats.memory) {
    const match = stats.memory.match(/([\d.]+)MiB\s*\/\s*([\d.]+)MiB/);
    if (match) {
      const used = parseFloat(match[1]);
      const limit = parseFloat(match[2]);
      if (limit > 0 && (used / limit) > 0.8) {
        warnings.push(`Memory usage at ${((used / limit) * 100).toFixed(0)}% of limit`);
      }
    }
  }

  return {
    name: dep.name,
    domain: dep.domain,
    running: stats.running,
    containerId: dep.containerId,
    image: dep.image,
    cpu: stats.cpu,
    memory: stats.memory,
    restartCount: stats.restartCount,
    uptime: stats.uptime,
    warnings,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/mcp/tools.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Create the MCP server with ls and status tools**

In `src/mcp/index.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveConfig } from "./config";
import { resolveProvider } from "@/providers/resolve";
import { readState } from "@/engine/state";
import { formatDeploymentList, formatStatus } from "./tools";
import type { ContainerStats } from "./tools";

const server = new McpServer({
  name: "deploy-ops",
  version: "0.1.0",
});

function getConfigOrError(cwd: string) {
  const config = resolveConfig(cwd);
  if (!config) {
    return {
      error: "No deploy-ops configuration found. Set env vars (DEPLOY_OPS_HOST, DEPLOY_OPS_SSH_KEY, DEPLOY_OPS_DOMAIN) or run 'dovu-app init' in your project.",
    };
  }
  return { config };
}

server.tool("ls", "List all deployments with status", {}, async () => {
  const cwd = process.cwd();
  const { config, error } = getConfigOrError(cwd);
  if (error) return { content: [{ type: "text", text: error }] };

  const state = await readState(cwd);
  const deployments = state.deployments;

  if (Object.keys(deployments).length === 0) {
    return { content: [{ type: "text", text: "No deployments found." }] };
  }

  // Reconcile live status
  const provider = resolveProvider(config!);
  for (const dep of Object.values(deployments)) {
    try {
      const running = await provider.exec(`docker inspect -f '{{.State.Running}}' dovu-app-paas-${dep.name}`);
      dep.status = running.trim() === "true" ? "running" : "stopped";
    } catch {
      dep.status = "stopped";
    }
  }

  const list = formatDeploymentList(deployments);
  return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
});

server.tool(
  "status",
  "Show deployment status, resources, and warnings",
  { app: z.string().describe("App name") },
  async ({ app }) => {
    const cwd = process.cwd();
    const { config, error } = getConfigOrError(cwd);
    if (error) return { content: [{ type: "text", text: error }] };

    const state = await readState(cwd);
    const dep = state.deployments[app];

    if (!dep) {
      const available = Object.keys(state.deployments);
      const hint = available.length > 0
        ? `Available apps: ${available.join(", ")}`
        : "No deployments found.";
      return { content: [{ type: "text", text: `Deployment '${app}' not found. ${hint}` }] };
    }

    const provider = resolveProvider(config!);
    const containerName = `dovu-app-paas-${app}`;
    const stats: ContainerStats = { running: false, cpu: null, memory: null, restartCount: 0, uptime: null };

    try {
      const inspectJson = await provider.exec(
        `docker inspect ${containerName} --format '{{.State.Running}}|{{.RestartCount}}|{{.State.StartedAt}}'`
      );
      const [running, restarts, startedAt] = inspectJson.trim().split("|");
      stats.running = running === "true";
      stats.restartCount = parseInt(restarts, 10) || 0;

      if (stats.running) {
        const diff = Date.now() - new Date(startedAt).getTime();
        const minutes = Math.floor(diff / 60000);
        if (minutes < 60) stats.uptime = `${minutes}m`;
        else {
          const hours = Math.floor(minutes / 60);
          stats.uptime = `${hours}h ${minutes % 60}m`;
        }

        const dockerStats = await provider.exec(
          `docker stats ${containerName} --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}'`
        );
        const [cpu, mem] = dockerStats.trim().split("|");
        stats.cpu = cpu;
        stats.memory = mem;
      }
    } catch {}

    const result = formatStatus(dep, stats);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: All tests pass (previous 25 + 4 new = 29)

- [ ] **Step 7: Commit**

```bash
git add src/mcp/index.ts src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: add MCP server with ls and status tools"
```

---

### Task 4: Add `logs` and `destroy` tools

Two more tools that interact with existing containers. `logs` returns last N lines, `destroy` uses the existing `--force` flag.

**Files:**
- Modify: `src/mcp/index.ts`

- [ ] **Step 1: Add logs and destroy tools to the MCP server**

Append these tool registrations before the `const transport = ...` line in `src/mcp/index.ts`:

```ts
server.tool(
  "logs",
  "Get recent logs from a deployment",
  {
    app: z.string().describe("App name"),
    lines: z.number().optional().default(50).describe("Number of log lines to return"),
  },
  async ({ app, lines }) => {
    const cwd = process.cwd();
    const { config, error } = getConfigOrError(cwd);
    if (error) return { content: [{ type: "text", text: error }] };

    const state = await readState(cwd);
    if (!state.deployments[app]) {
      const available = Object.keys(state.deployments);
      const hint = available.length > 0
        ? `Available apps: ${available.join(", ")}`
        : "No deployments found.";
      return { content: [{ type: "text", text: `Deployment '${app}' not found. ${hint}` }] };
    }

    const provider = resolveProvider(config!);
    const containerName = `dovu-app-paas-${app}`;

    try {
      const output = await provider.exec(`docker logs ${containerName} --tail ${lines} 2>&1`);
      return { content: [{ type: "text", text: output }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed to get logs: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

server.tool(
  "destroy",
  "Remove a deployment completely (container, image, nginx config)",
  { app: z.string().describe("App name to destroy") },
  async ({ app }) => {
    const cwd = process.cwd();
    const { config, error } = getConfigOrError(cwd);
    if (error) return { content: [{ type: "text", text: error }] };

    const provider = resolveProvider(config!);
    const containerName = `dovu-app-paas-${app}`;
    const results: string[] = [];

    // Stop and remove container
    try {
      await provider.exec(`docker stop ${containerName}`);
      await provider.exec(`docker rm ${containerName}`);
      results.push("Container removed");
    } catch {
      results.push("Container not found or already removed");
    }

    // Remove image if known from state
    const state = await readState(cwd);
    const dep = state.deployments[app];
    if (dep?.image) {
      try {
        await provider.exec(`docker rmi ${dep.image}`);
        results.push("Image removed");
      } catch {
        results.push("Image not found or already removed");
      }
    }

    // Remove nginx config
    try {
      await provider.exec(`rm -f ${provider.nginxConfDir}/dovu-app-paas-${app}.conf ${provider.nginxConfDir}/dovu-app-paas-${app}.conf.disabled`);
      await provider.exec("nginx -s reload 2>/dev/null || sudo systemctl reload nginx");
      results.push("Nginx config removed");
    } catch {
      results.push("Nginx cleanup failed");
    }

    // Update state
    if (dep) {
      delete state.deployments[app];
      const { writeState } = await import("@/engine/state");
      await writeState(cwd, state);
      results.push("Removed from state");
    }

    return { content: [{ type: "text", text: `Destroyed '${app}':\n${results.map(r => `  - ${r}`).join("\n")}` }] };
  }
);
```

- [ ] **Step 2: Verify the import for `writeState` is at the top of the file**

Add `writeState` to the existing import from `@/engine/state` at the top of `src/mcp/index.ts`:

Change:
```ts
import { readState } from "@/engine/state";
```
To:
```ts
import { readState, writeState } from "@/engine/state";
```

And change the inline import in the destroy handler to use the top-level `writeState`:
```ts
await writeState(cwd, state);
```
(Remove the `const { writeState } = await import("@/engine/state");` line.)

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/mcp/index.ts
git commit -m "feat: add logs and destroy MCP tools"
```

---

### Task 5: Add `deploy` tool

The core tool. Runs the same pipeline as the CLI deploy command: inspect, build, ship, run, route, state.

**Files:**
- Modify: `src/mcp/index.ts`

- [ ] **Step 1: Add deploy tool to the MCP server**

Add this import at the top of `src/mcp/index.ts`:

```ts
import { inspectProject } from "@/engine/rules";
import { buildImage, saveImage } from "@/engine/docker";
import { generateNginxConfig } from "@/engine/nginx";
import { getNextPort } from "@/engine/state";
import { readFile, rm } from "fs/promises";
import { join, basename } from "path";
import { tmpdir } from "os";
import type { DeploymentRecord } from "@/types";
```

Then add this tool registration before the `const transport = ...` line:

```ts
server.tool(
  "deploy",
  "Deploy the current project to the configured droplet",
  {
    name: z.string().optional().describe("Override app name (defaults to directory name)"),
    domain: z.string().optional().describe("Override domain"),
    env: z.record(z.string()).optional().describe("Environment variables as key-value pairs"),
  },
  async ({ name, domain, env: envInput }) => {
    const cwd = process.cwd();
    const { config, error } = getConfigOrError(cwd);
    if (error) return { content: [{ type: "text", text: error }] };

    const provider = resolveProvider(config!);
    const steps: string[] = [];

    // 1. Inspect project
    const deployConfig = await inspectProject(cwd);
    const appName = name || deployConfig.name;
    steps.push(`Detected: ${deployConfig.runtime}/${deployConfig.framework}, entrypoint=${deployConfig.entrypoint}, port=${deployConfig.port}`);

    // 2. Collect env vars
    const envVars: Record<string, string> = {};
    try {
      const envContent = await readFile(join(cwd, ".env"), "utf-8");
      for (const line of envContent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        envVars[key] = value;
      }
    } catch {}

    // Override with provided env vars
    if (envInput) Object.assign(envVars, envInput);

    // 3. Build image
    const imageTag = `dovu-app-paas-${appName}:${Date.now().toString(36)}`;
    const platform = provider.name === "local" ? undefined : "linux/amd64";
    await buildImage(cwd, imageTag, deployConfig.dockerfile, {
      runtime: deployConfig.runtime,
      framework: deployConfig.framework,
      entrypoint: deployConfig.entrypoint,
      port: deployConfig.port,
    }, platform);
    steps.push(`Built image: ${imageTag}`);

    // 4. Ship image
    const tarballPath = join(tmpdir(), `dovu-app-paas-${appName}.tar`);
    await saveImage(imageTag, tarballPath);
    await provider.transferImage(tarballPath);
    await rm(tarballPath, { force: true });
    steps.push("Image transferred to target");

    // 5. Stop old container
    const state = await readState(cwd);
    const existing = state.deployments[appName];
    const containerName = `dovu-app-paas-${appName}`;
    try {
      await provider.exec(`docker stop ${containerName}`);
      await provider.exec(`docker rm ${containerName}`);
    } catch {}

    // 6. Find free port and start container
    let hostPort = existing?.hostPort || await getNextPort(cwd);
    try {
      const portsOutput = await provider.exec(
        `docker ps --format '{{.Ports}}' | sed 's/,/\\n/g' | sed -n 's/.*:\\([0-9]*\\)->.*/\\1/p' | sort -u`
      );
      const used = new Set(portsOutput.trim().split("\n").filter(Boolean).map(Number));
      while (used.has(hostPort)) hostPort++;
    } catch {}

    const envFlags = Object.entries(envVars).map(([k, v]) => `-e ${k}=${JSON.stringify(v)}`).join(" ");
    const containerId = (
      await provider.exec(
        `docker run -d --name ${containerName} -p 127.0.0.1:${hostPort}:${deployConfig.port} --memory=256m --cpus=0.5 --restart=unless-stopped ${envFlags} ${imageTag}`
      )
    ).trim();
    steps.push(`Container started: ${containerId.slice(0, 12)}`);

    // 7. Configure nginx
    const deployDomain = domain || `${appName}.${provider.baseDomain}`;
    const nginxConf = generateNginxConfig({
      serverName: deployDomain,
      hostPort,
      ssl: provider.ssl ?? undefined,
    });
    const confB64 = Buffer.from(nginxConf).toString("base64");
    await provider.exec(
      `echo '${confB64}' | base64 -d > ${provider.nginxConfDir}/dovu-app-paas-${appName}.conf`
    );
    await provider.exec("nginx -s reload 2>/dev/null || sudo systemctl reload nginx");
    steps.push("Nginx configured");

    // 8. Update state
    const now = new Date().toISOString();
    const record: DeploymentRecord = {
      name: appName,
      image: imageTag,
      port: deployConfig.port,
      hostPort,
      domain: deployDomain,
      containerId: containerId.slice(0, 12),
      status: "running",
      env: envVars,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    state.deployments[appName] = record;
    await writeState(cwd, state);

    const url = `https://${deployDomain}`;
    steps.push(`Deployed: ${url}`);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ url, appName, containerId: containerId.slice(0, 12), steps }, null, 2),
      }],
    };
  }
);
```

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/mcp/index.ts
git commit -m "feat: add deploy MCP tool"
```

---

### Task 6: Add `dev` tool

Starts hot-reload dev mode. Returns the local URL. Note: the dev tool starts the container but lifecycle management (cleanup on exit) is limited in MCP context — it starts the container and returns info, the user stops manually.

**Files:**
- Modify: `src/mcp/index.ts`

- [ ] **Step 1: Add dev tool to the MCP server**

Add this tool registration before the `const transport = ...` line in `src/mcp/index.ts`:

```ts
server.tool(
  "dev",
  "Start hot-reload dev mode for the current project",
  {
    name: z.string().optional().describe("Override app name"),
    port: z.number().optional().describe("Override host port"),
    env: z.record(z.string()).optional().describe("Environment variables as key-value pairs"),
  },
  async ({ name, port, env: envInput }) => {
    const cwd = process.cwd();

    // Inspect project
    const deployConfig = await inspectProject(cwd);
    const appName = name || deployConfig.name;

    // Collect env vars
    const envVars: Record<string, string> = {};
    try {
      const envContent = await readFile(join(cwd, ".env"), "utf-8");
      for (const line of envContent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        envVars[key] = value;
      }
    } catch {}
    if (envInput) Object.assign(envVars, envInput);

    // Build image for deps
    const imageTag = `dovu-app-paas-dev-${appName}:latest`;
    await buildImage(cwd, imageTag, deployConfig.dockerfile, {
      runtime: deployConfig.runtime,
      framework: deployConfig.framework,
      entrypoint: deployConfig.entrypoint,
      port: deployConfig.port,
    });

    // Stop any existing dev container
    const containerName = `dovu-app-paas-dev-${appName}`;
    try {
      const proc = Bun.spawn(["docker", "rm", "-f", containerName], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
    } catch {}

    // Find free port
    let hostPort = port || deployConfig.port;
    if (!port) {
      try {
        const proc = Bun.spawn(["lsof", "-i", `:${hostPort}`, "-t"], { stdout: "pipe", stderr: "pipe" });
        const output = await new Response(proc.stdout).text();
        if (output.trim()) {
          for (let p = hostPort + 1; p < hostPort + 100; p++) {
            const c = Bun.spawn(["lsof", "-i", `:${p}`, "-t"], { stdout: "pipe", stderr: "pipe" });
            const o = await new Response(c.stdout).text();
            if (!o.trim()) { hostPort = p; break; }
          }
        }
      } catch {}
    }

    // Determine watch command
    let watchCmd: string[];
    switch (deployConfig.framework) {
      case "nextjs": watchCmd = ["npx", "next", "dev"]; break;
      case "laravel": watchCmd = ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]; break;
      default: watchCmd = ["bun", "--watch", "run", deployConfig.entrypoint]; break;
    }

    // Start dev container (detached so we can return)
    const envFlags = Object.entries(envVars).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const proc = Bun.spawn(
      [
        "docker", "run", "-d",
        "--name", containerName,
        "-p", `${hostPort}:${deployConfig.port}`,
        "-v", `${cwd}:/app`,
        "-w", "/app",
        ...envFlags,
        imageTag,
        ...watchCmd,
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    const containerId = (await new Response(proc.stdout).text()).trim();

    const url = `http://localhost:${hostPort}`;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          url,
          appName,
          containerId: containerId.slice(0, 12),
          port: hostPort,
          watchCommand: watchCmd.join(" "),
          stopCommand: `docker rm -f ${containerName}`,
        }, null, 2),
      }],
    };
  }
);
```

- [ ] **Step 2: Add missing import for `Bun.spawn`**

`Bun.spawn` is a global — no import needed. Verify the `readFile` and `join` imports from Task 5 are still at the top.

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/mcp/index.ts
git commit -m "feat: add dev MCP tool with hot-reload"
```

---

### Task 7: Add `mcp` script to package.json and verify server starts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add mcp script to package.json**

Add to the `"scripts"` section in `package.json`:

```json
"mcp": "bun run src/mcp/index.ts"
```

- [ ] **Step 2: Verify the MCP server starts and responds**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | timeout 5 bun run src/mcp/index.ts 2>/dev/null || true`

Expected: JSON response with server info including tool list

- [ ] **Step 3: Run full test suite one final time**

Run: `bun test`
Expected: All tests pass (25 original + 4 MCP = 29)

- [ ] **Step 4: Run typecheck**

Run: `bun x tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "feat: add mcp script to package.json"
```
