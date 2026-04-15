# Remote MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the deploy-ops MCP server over HTTP on the droplet so team members connect via Claude Code CLI with a single command and a bearer token.

**Architecture:** `Bun.serve()` hosts a `WebStandardStreamableHTTPServerTransport` on port 8888. Bearer token middleware gates `/mcp` endpoints. A new `HostProvider` runs docker/nginx commands directly on the host (no SSH). nginx proxies `mcp.apps.dovu.ai` to localhost:8888.

**Tech Stack:** Bun, `@modelcontextprotocol/sdk` (WebStandardStreamableHTTPServerTransport), systemd, nginx

**Spec:** `docs/superpowers/specs/2026-04-15-remote-mcp-server-design.md`

---

## File Structure

```
src/mcp/
  register.ts    # NEW — registerTools(server, cwd) extracts all 6 tool registrations
  index.ts       # MODIFIED — slim down to stdio transport + registerTools() call
  remote.ts      # NEW — Bun.serve() + StreamableHTTP + bearer auth + registerTools()
  config.ts      # UNCHANGED
  tools.ts       # UNCHANGED

src/providers/
  host.ts        # NEW — HostProvider: exec via Bun.$, no SSH
  provider.ts    # UNCHANGED
  resolve.ts     # MODIFIED — add "host" provider resolution

src/types.ts     # MODIFIED — add "host" to AppConfig.provider union

scripts/
  deploy-ops-mcp.service  # NEW — systemd unit file
  mcp-nginx.conf           # NEW — nginx config for mcp.apps.dovu.ai
  provision-droplet.sh     # MODIFIED — add MCP service provisioning section
```

---

### Task 1: Host Provider

**Files:**
- Create: `src/providers/host.ts`
- Create: `tests/providers/host.test.ts`

The host provider runs commands directly on the machine via `Bun.$`. Used when the MCP server runs on the same machine as Docker. No SSH, no Docker-in-Docker.

- [ ] **Step 1: Write the failing test**

Create `tests/providers/host.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { HostProvider } from "@/providers/host";

describe("HostProvider", () => {
  test("has correct name and baseDomain", () => {
    const provider = new HostProvider("apps.dovu.ai");
    expect(provider.name).toBe("host");
    expect(provider.baseDomain).toBe("apps.dovu.ai");
  });

  test("has correct nginxConfDir", () => {
    const provider = new HostProvider("apps.dovu.ai");
    expect(provider.nginxConfDir).toBe("/etc/nginx/conf.d");
  });

  test("has SSL config derived from baseDomain", () => {
    const provider = new HostProvider("apps.dovu.ai");
    expect(provider.ssl).toEqual({
      certPath: "/etc/letsencrypt/live/apps.dovu.ai/fullchain.pem",
      keyPath: "/etc/letsencrypt/live/apps.dovu.ai/privkey.pem",
    });
  });

  test("exec runs shell commands and returns stdout", async () => {
    const provider = new HostProvider("apps.dovu.ai");
    const result = await provider.exec("echo hello");
    expect(result.trim()).toBe("hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/providers/host.test.ts`
Expected: FAIL — `Cannot find module "@/providers/host"`

- [ ] **Step 3: Write the implementation**

Create `src/providers/host.ts`:

```ts
import { $ } from "bun";
import type { Provider } from "./provider";

export class HostProvider implements Provider {
  readonly name = "host";
  readonly baseDomain: string;
  readonly nginxConfDir = "/etc/nginx/conf.d";
  readonly ssl: { certPath: string; keyPath: string };

  constructor(baseDomain: string) {
    this.baseDomain = baseDomain;
    this.ssl = {
      certPath: `/etc/letsencrypt/live/${baseDomain}/fullchain.pem`,
      keyPath: `/etc/letsencrypt/live/${baseDomain}/privkey.pem`,
    };
  }

  async setup(): Promise<void> {
    await this.exec("docker info > /dev/null 2>&1");
  }

  async teardown(): Promise<void> {}

  async transferImage(tarballPath: string): Promise<void> {
    await this.exec(`docker load -i ${tarballPath} && rm ${tarballPath}`);
  }

  async exec(command: string): Promise<string> {
    const result = await $`sh -c ${command}`.text();
    return result;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/providers/host.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/host.ts tests/providers/host.test.ts
git commit -m "feat: add HostProvider for direct shell execution on droplet"
```

---

### Task 2: Add "host" to Provider Resolution

**Files:**
- Modify: `src/types.ts`
- Modify: `src/providers/resolve.ts`
- Create: `tests/providers/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/providers/resolve.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { resolveProvider } from "@/providers/resolve";
import type { AppConfig } from "@/types";

describe("resolveProvider", () => {
  test("resolves host provider", () => {
    const config: AppConfig = {
      provider: "host",
      host: { baseDomain: "apps.dovu.ai" },
    };
    const provider = resolveProvider(config);
    expect(provider.name).toBe("host");
    expect(provider.baseDomain).toBe("apps.dovu.ai");
  });

  test("resolves local provider", () => {
    const config: AppConfig = {
      provider: "local",
      local: { baseDomain: "ops.localhost" },
    };
    const provider = resolveProvider(config);
    expect(provider.name).toBe("local");
  });

  test("resolves digitalocean provider", () => {
    const config: AppConfig = {
      provider: "digitalocean",
      digitalocean: {
        host: "1.2.3.4",
        sshKey: "~/.ssh/id_ed25519",
        user: "deploy",
        baseDomain: "apps.dovu.ai",
      },
    };
    const provider = resolveProvider(config);
    expect(provider.name).toBe("digitalocean");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/providers/resolve.test.ts`
Expected: FAIL — TypeScript error on `provider: "host"` (not in union yet)

- [ ] **Step 3: Update types.ts to add host provider**

In `src/types.ts`, add the host config interface and update the AppConfig union:

```ts
export interface HostProviderConfig {
  baseDomain: string;
}

export interface AppConfig {
  provider: "local" | "digitalocean" | "host";
  local?: LocalProviderConfig;
  digitalocean?: DigitalOceanProviderConfig;
  host?: HostProviderConfig;
}
```

- [ ] **Step 4: Update resolve.ts to handle host provider**

In `src/providers/resolve.ts`, add the host case:

```ts
import type { AppConfig } from "@/types";
import type { Provider } from "./provider";
import { LocalProvider } from "./local";
import { DigitalOceanProvider } from "./digitalocean";
import { HostProvider } from "./host";

export function resolveProvider(config: AppConfig): Provider {
  if (config.provider === "local") {
    return new LocalProvider(config.local!.baseDomain);
  }
  if (config.provider === "host") {
    return new HostProvider(config.host!.baseDomain);
  }
  return new DigitalOceanProvider(config.digitalocean!);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/providers/resolve.test.ts`
Expected: All 3 tests PASS

Run: `bun test`
Expected: All existing tests still PASS (types are backwards-compatible)

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/providers/resolve.ts tests/providers/resolve.test.ts
git commit -m "feat: add host provider to type system and resolver"
```

---

### Task 3: Extract Tool Registration into register.ts

**Files:**
- Create: `src/mcp/register.ts`
- Modify: `src/mcp/index.ts`

This is a pure refactor. Extract all 6 tool registrations from `index.ts` into a `registerTools(server, cwd)` function. The stdio `index.ts` calls it with `process.cwd()`. The remote server (next task) will call it with a fixed workspace path.

- [ ] **Step 1: Create register.ts with the extracted function**

Create `src/mcp/register.ts`. This file contains the `registerTools` function that takes a `McpServer` and a `cwd` string, then registers all 6 tools. The function body is the tool registration code currently in `index.ts` lines 32-436, with every `process.cwd()` replaced by the `cwd` parameter.

Also add the `deployer` parameter to `deploy` and `dev` tools, and a `slugify` helper for the deployer name.

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveConfig } from "./config";
import { resolveProvider } from "@/providers/resolve";
import { readState, writeState, getNextPort } from "@/engine/state";
import { inspectProject } from "@/engine/rules";
import { buildImage, saveImage } from "@/engine/docker";
import { generateNginxConfig } from "@/engine/nginx";
import { readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { DeploymentRecord } from "@/types";
import { formatDeploymentList, formatStatus } from "./tools";
import type { ContainerStats } from "./tools";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function registerTools(server: McpServer, cwd: string) {
  function getConfigOrError() {
    const config = resolveConfig(cwd);
    if (!config) {
      return {
        error:
          "No deploy-ops configuration found. Set env vars (DEPLOY_OPS_HOST, DEPLOY_OPS_SSH_KEY, DEPLOY_OPS_DOMAIN) or run 'dovu-app init' in your project.",
      };
    }
    return { config };
  }

  server.tool("ls", "List all deployments with status", {}, async () => {
    const { config, error } = getConfigOrError();
    if (error) return { content: [{ type: "text", text: error }] };

    const state = await readState(cwd);
    const deployments = state.deployments;

    if (Object.keys(deployments).length === 0) {
      return { content: [{ type: "text", text: "No deployments found." }] };
    }

    const provider = resolveProvider(config!);
    for (const dep of Object.values(deployments)) {
      try {
        const running = await provider.exec(
          `docker inspect -f '{{.State.Running}}' dovu-app-paas-${dep.name}`
        );
        dep.status = running.trim() === "true" ? "running" : "stopped";
      } catch {
        dep.status = "stopped";
      }
    }

    const list = formatDeploymentList(deployments);
    return {
      content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
    };
  });

  server.tool(
    "status",
    "Show deployment status, resources, and warnings",
    { app: z.string().describe("App name") },
    async ({ app }) => {
      const { config, error } = getConfigOrError();
      if (error) return { content: [{ type: "text", text: error }] };

      const state = await readState(cwd);
      const dep = state.deployments[app];

      if (!dep) {
        const available = Object.keys(state.deployments);
        const hint =
          available.length > 0
            ? `Available apps: ${available.join(", ")}`
            : "No deployments found.";
        return {
          content: [
            {
              type: "text",
              text: `Deployment '${app}' not found. ${hint}`,
            },
          ],
        };
      }

      const provider = resolveProvider(config!);
      const containerName = `dovu-app-paas-${app}`;
      const stats: ContainerStats = {
        running: false,
        cpu: null,
        memory: null,
        restartCount: 0,
        uptime: null,
      };

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
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "logs",
    "Get recent logs from a deployment",
    {
      app: z.string().describe("App name"),
      lines: z
        .number()
        .optional()
        .default(50)
        .describe("Number of log lines to return"),
    },
    async ({ app, lines }) => {
      const { config, error } = getConfigOrError();
      if (error) return { content: [{ type: "text", text: error }] };

      const state = await readState(cwd);
      if (!state.deployments[app]) {
        const available = Object.keys(state.deployments);
        const hint =
          available.length > 0
            ? `Available apps: ${available.join(", ")}`
            : "No deployments found.";
        return {
          content: [
            {
              type: "text",
              text: `Deployment '${app}' not found. ${hint}`,
            },
          ],
        };
      }

      const provider = resolveProvider(config!);
      const containerName = `dovu-app-paas-${app}`;

      try {
        const output = await provider.exec(
          `docker logs ${containerName} --tail ${lines} 2>&1`
        );
        return { content: [{ type: "text", text: output }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get logs: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "destroy",
    "Remove a deployment completely (container, image, nginx config)",
    { app: z.string().describe("App name to destroy") },
    async ({ app }) => {
      const { config, error } = getConfigOrError();
      if (error) return { content: [{ type: "text", text: error }] };

      const provider = resolveProvider(config!);
      const containerName = `dovu-app-paas-${app}`;
      const results: string[] = [];

      try {
        await provider.exec(`docker stop ${containerName}`);
        await provider.exec(`docker rm ${containerName}`);
        results.push("Container removed");
      } catch {
        results.push("Container not found or already removed");
      }

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

      try {
        await provider.exec(
          `rm -f ${provider.nginxConfDir}/dovu-app-paas-${app}.conf ${provider.nginxConfDir}/dovu-app-paas-${app}.conf.disabled`
        );
        await provider.exec(
          "nginx -s reload 2>/dev/null || sudo systemctl reload nginx"
        );
        results.push("Nginx config removed");
      } catch {
        results.push("Nginx cleanup failed");
      }

      if (dep) {
        delete state.deployments[app];
        await writeState(cwd, state);
        results.push("Removed from state");
      }

      return {
        content: [
          {
            type: "text",
            text: `Destroyed '${app}':\n${results.map((r) => `  - ${r}`).join("\n")}`,
          },
        ],
      };
    }
  );

  server.tool(
    "deploy",
    "Deploy the current project to the configured droplet",
    {
      name: z
        .string()
        .optional()
        .describe("Override app name (defaults to directory name)"),
      domain: z.string().optional().describe("Override domain"),
      env: z
        .record(z.string(), z.string())
        .optional()
        .describe("Environment variables as key-value pairs"),
      deployer: z
        .string()
        .optional()
        .describe(
          "Name of the person deploying (used in subdomain, e.g. 'alice')"
        ),
    },
    async ({ name, domain, env: envInput, deployer }) => {
      const { config, error } = getConfigOrError();
      if (error) return { content: [{ type: "text", text: error }] };

      const provider = resolveProvider(config!);
      const steps: string[] = [];

      const deployConfig = await inspectProject(cwd);
      const appName = name || deployConfig.name;
      steps.push(
        `Detected: ${deployConfig.runtime}/${deployConfig.framework}, entrypoint=${deployConfig.entrypoint}, port=${deployConfig.port}`
      );

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
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          envVars[key] = value;
        }
      } catch {}
      if (envInput) Object.assign(envVars, envInput);

      const imageTag = `dovu-app-paas-${appName}:${Date.now().toString(36)}`;
      const platform =
        provider.name === "local" ? undefined : "linux/amd64";
      await buildImage(
        cwd,
        imageTag,
        deployConfig.dockerfile,
        {
          runtime: deployConfig.runtime,
          framework: deployConfig.framework,
          entrypoint: deployConfig.entrypoint,
          port: deployConfig.port,
        },
        platform
      );
      steps.push(`Built image: ${imageTag}`);

      const tarballPath = join(
        tmpdir(),
        `dovu-app-paas-${appName}.tar`
      );
      await saveImage(imageTag, tarballPath);
      await provider.transferImage(tarballPath);
      await rm(tarballPath, { force: true });
      steps.push("Image transferred to target");

      const state = await readState(cwd);
      const existing = state.deployments[appName];
      const containerName = `dovu-app-paas-${appName}`;
      try {
        await provider.exec(`docker stop ${containerName}`);
        await provider.exec(`docker rm ${containerName}`);
      } catch {}

      let hostPort = existing?.hostPort || (await getNextPort(cwd));
      try {
        const portsOutput = await provider.exec(
          `docker ps --format '{{.Ports}}' | sed 's/,/\\n/g' | sed -n 's/.*:\\([0-9]*\\)->.*/\\1/p' | sort -u`
        );
        const used = new Set(
          portsOutput
            .trim()
            .split("\n")
            .filter(Boolean)
            .map(Number)
        );
        while (used.has(hostPort)) hostPort++;
      } catch {}

      const envFlags = Object.entries(envVars)
        .map(([k, v]) => `-e ${k}=${JSON.stringify(v)}`)
        .join(" ");
      const containerId = (
        await provider.exec(
          `docker run -d --name ${containerName} -p 127.0.0.1:${hostPort}:${deployConfig.port} --memory=256m --cpus=0.5 --restart=unless-stopped ${envFlags} ${imageTag}`
        )
      ).trim();
      steps.push(`Container started: ${containerId.slice(0, 12)}`);

      // Build domain: {app}-{deployer}.base or {app}.base
      const deployerSlug = deployer ? slugify(deployer) : null;
      const subdomainName = deployerSlug
        ? `${appName}-${deployerSlug}`
        : appName;
      const deployDomain =
        domain || `${subdomainName}.${provider.baseDomain}`;

      const nginxConf = generateNginxConfig({
        serverName: deployDomain,
        hostPort,
        ssl: provider.ssl ?? undefined,
      });
      const confB64 = Buffer.from(nginxConf).toString("base64");
      await provider.exec(
        `echo '${confB64}' | base64 -d > ${provider.nginxConfDir}/dovu-app-paas-${appName}.conf`
      );
      await provider.exec(
        "nginx -s reload 2>/dev/null || sudo systemctl reload nginx"
      );
      steps.push("Nginx configured");

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
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { url, appName, containerId: containerId.slice(0, 12), steps },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "dev",
    "Start hot-reload dev mode for the current project",
    {
      name: z.string().optional().describe("Override app name"),
      port: z.number().optional().describe("Override host port"),
      env: z
        .record(z.string(), z.string())
        .optional()
        .describe("Environment variables as key-value pairs"),
      deployer: z
        .string()
        .optional()
        .describe(
          "Name of the person deploying (used in subdomain, e.g. 'alice')"
        ),
    },
    async ({ name, port, env: envInput, deployer }) => {
      const deployConfig = await inspectProject(cwd);
      const appName = name || deployConfig.name;

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
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          envVars[key] = value;
        }
      } catch {}
      if (envInput) Object.assign(envVars, envInput);

      const imageTag = `dovu-app-paas-dev-${appName}:latest`;
      await buildImage(cwd, imageTag, deployConfig.dockerfile, {
        runtime: deployConfig.runtime,
        framework: deployConfig.framework,
        entrypoint: deployConfig.entrypoint,
        port: deployConfig.port,
      });

      const containerName = `dovu-app-paas-dev-${appName}`;
      try {
        const proc = Bun.spawn(["docker", "rm", "-f", containerName], {
          stdout: "pipe",
          stderr: "pipe",
        });
        await proc.exited;
      } catch {}

      let hostPort = port || deployConfig.port;
      if (!port) {
        try {
          const proc = Bun.spawn(["lsof", "-i", `:${hostPort}`, "-t"], {
            stdout: "pipe",
            stderr: "pipe",
          });
          const output = await new Response(proc.stdout).text();
          if (output.trim()) {
            for (let p = hostPort + 1; p < hostPort + 100; p++) {
              const c = Bun.spawn(["lsof", "-i", `:${p}`, "-t"], {
                stdout: "pipe",
                stderr: "pipe",
              });
              const o = await new Response(c.stdout).text();
              if (!o.trim()) {
                hostPort = p;
                break;
              }
            }
          }
        } catch {}
      }

      let watchCmd: string[];
      switch (deployConfig.framework) {
        case "nextjs":
          watchCmd = ["npx", "next", "dev"];
          break;
        case "laravel":
          watchCmd = [
            "php",
            "artisan",
            "serve",
            "--host=0.0.0.0",
            "--port=8000",
          ];
          break;
        default:
          watchCmd = ["bun", "--watch", "run", deployConfig.entrypoint];
          break;
      }

      const envFlags = Object.entries(envVars).flatMap(([k, v]) => [
        "-e",
        `${k}=${v}`,
      ]);
      const proc = Bun.spawn(
        [
          "docker",
          "run",
          "-d",
          "--name",
          containerName,
          "-p",
          `${hostPort}:${deployConfig.port}`,
          "-v",
          `${cwd}:/app`,
          "-w",
          "/app",
          ...envFlags,
          imageTag,
          ...watchCmd,
        ],
        { stdout: "pipe", stderr: "pipe" }
      );
      const containerId = (await new Response(proc.stdout).text()).trim();

      // Build URL with deployer in subdomain if provided
      const deployerSlug = deployer ? slugify(deployer) : null;
      const subdomainName = deployerSlug
        ? `${appName}-${deployerSlug}`
        : appName;

      const url = `http://localhost:${hostPort}`;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                url,
                appName: subdomainName,
                containerId: containerId.slice(0, 12),
                port: hostPort,
                watchCommand: watchCmd.join(" "),
                stopCommand: `docker rm -f ${containerName}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
```

- [ ] **Step 2: Slim down index.ts to use registerTools**

Replace the contents of `src/mcp/index.ts` with:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./register";

const server = new McpServer({
  name: "deploy-ops",
  version: "0.1.0",
});

registerTools(server, process.cwd());

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 3: Run all existing tests to verify no regressions**

Run: `bun test`
Expected: All 33 tests PASS. The refactor is purely structural — same tools, same behavior.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/register.ts src/mcp/index.ts
git commit -m "refactor: extract tool registration into register.ts"
```

---

### Task 4: Slugify Helper Tests

**Files:**
- Create: `tests/mcp/register.test.ts`

The `slugify` function is internal to `register.ts` but critical for deployer subdomains. Export it and test it.

- [ ] **Step 1: Export slugify from register.ts**

In `src/mcp/register.ts`, change `function slugify` to `export function slugify`.

- [ ] **Step 2: Write the test**

Create `tests/mcp/register.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { slugify } from "@/mcp/register";

describe("slugify", () => {
  test("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Alice Smith")).toBe("alice-smith");
  });

  test("removes special characters", () => {
    expect(slugify("Matt's App!")).toBe("matt-s-app");
  });

  test("trims leading/trailing hyphens", () => {
    expect(slugify("  hello  ")).toBe("hello");
  });

  test("collapses multiple hyphens", () => {
    expect(slugify("a---b")).toBe("a-b");
  });

  test("handles simple name", () => {
    expect(slugify("alice")).toBe("alice");
  });
});
```

- [ ] **Step 3: Run the test**

Run: `bun test tests/mcp/register.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/mcp/register.ts tests/mcp/register.test.ts
git commit -m "test: add slugify helper tests for deployer subdomain"
```

---

### Task 5: Remote MCP Server (remote.ts)

**Files:**
- Create: `src/mcp/remote.ts`
- Create: `tests/mcp/remote.test.ts`

The HTTP MCP server with Bun.serve(), bearer auth, and session management.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/remote.test.ts`:

```ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const TEST_PORT = 9876;
const TEST_SECRET = "test-secret-token";
let serverProc: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  serverProc = Bun.spawn(["bun", "run", "src/mcp/remote.ts"], {
    env: {
      ...process.env,
      MCP_PORT: String(TEST_PORT),
      TEAM_SECRET: TEST_SECRET,
      DEPLOY_OPS_DOMAIN: "test.localhost",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  // Wait for server to start
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${TEST_PORT}/health`);
      if (res.ok) break;
    } catch {}
    await Bun.sleep(100);
  }
});

afterAll(() => {
  serverProc.kill();
});

describe("Remote MCP Server", () => {
  test("health endpoint returns ok without auth", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("MCP endpoint rejects missing auth", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  test("MCP endpoint rejects wrong token", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  test("MCP endpoint accepts correct token and initializes", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    // Should have a session ID header
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/mcp/remote.test.ts`
Expected: FAIL — `src/mcp/remote.ts` doesn't exist yet

- [ ] **Step 3: Write the remote server**

Create `src/mcp/remote.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerTools } from "./register";

const PORT = parseInt(process.env.MCP_PORT || "8888", 10);
const TEAM_SECRET = process.env.TEAM_SECRET;
const WORKSPACE = process.env.MCP_WORKSPACE || process.cwd();

if (!TEAM_SECRET) {
  console.error("TEAM_SECRET environment variable is required");
  process.exit(1);
}

// Session tracking: sessionId -> { transport, server }
const sessions = new Map<
  string,
  {
    transport: WebStandardStreamableHTTPServerTransport;
    server: McpServer;
  }
>();

function checkAuth(req: Request): Response | null {
  const auth = req.headers.get("authorization");
  if (!auth || auth !== `Bearer ${TEAM_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Health check — no auth
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // All /mcp routes require auth
    if (url.pathname === "/mcp") {
      const authError = checkAuth(req);
      if (authError) return authError;

      // Route by method
      if (req.method === "POST") {
        return handlePost(req);
      }
      if (req.method === "GET") {
        return handleGet(req);
      }
      if (req.method === "DELETE") {
        return handleDelete(req);
      }

      return new Response("Method not allowed", { status: 405 });
    }

    return new Response("Not found", { status: 404 });
  },
});

async function handlePost(req: Request): Promise<Response> {
  const sessionId = req.headers.get("mcp-session-id");

  // Existing session
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    return session.transport.handleRequest(req);
  }

  // New session — must be an initialize request
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const messages = Array.isArray(body) ? body : [body];
  if (!messages.some(isInitializeRequest)) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Create new transport and server for this session
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (sid) => {
      sessions.set(sid, { transport, server });
    },
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) sessions.delete(sid);
  };

  const server = new McpServer({
    name: "deploy-ops",
    version: "0.1.0",
  });

  registerTools(server, WORKSPACE);
  await server.connect(transport);

  return transport.handleRequest(req, { parsedBody: body });
}

async function handleGet(req: Request): Promise<Response> {
  const sessionId = req.headers.get("mcp-session-id");
  if (!sessionId || !sessions.has(sessionId)) {
    return new Response("Invalid or missing session ID", { status: 400 });
  }
  return sessions.get(sessionId)!.transport.handleRequest(req);
}

async function handleDelete(req: Request): Promise<Response> {
  const sessionId = req.headers.get("mcp-session-id");
  if (!sessionId || !sessions.has(sessionId)) {
    return new Response("Invalid or missing session ID", { status: 400 });
  }
  return sessions.get(sessionId)!.transport.handleRequest(req);
}

console.log(`deploy-ops MCP server listening on port ${PORT}`);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/mcp/remote.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 6: Add mcp:remote script to package.json**

In `package.json`, add to `scripts`:

```json
"mcp:remote": "bun run src/mcp/remote.ts"
```

- [ ] **Step 7: Commit**

```bash
git add src/mcp/remote.ts tests/mcp/remote.test.ts package.json
git commit -m "feat: add remote HTTP MCP server with bearer auth"
```

---

### Task 6: Infrastructure Files

**Files:**
- Create: `scripts/deploy-ops-mcp.service`
- Create: `scripts/mcp-nginx.conf`

- [ ] **Step 1: Create systemd unit file**

Create `scripts/deploy-ops-mcp.service`:

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
Environment=MCP_PORT=8888
Environment=MCP_WORKSPACE=/opt/deploy-ops/workspace
EnvironmentFile=-/etc/deploy-ops/env

[Install]
WantedBy=multi-user.target
```

Note: `EnvironmentFile=-/etc/deploy-ops/env` loads `TEAM_SECRET` from a file (the `-` means don't fail if missing). This avoids putting the secret in the unit file itself.

- [ ] **Step 2: Create nginx config template**

Create `scripts/mcp-nginx.conf`:

```nginx
server {
    listen 443 ssl;
    server_name mcp.apps.dovu.ai;

    ssl_certificate /etc/letsencrypt/live/apps.dovu.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/apps.dovu.ai/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

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

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy-ops-mcp.service scripts/mcp-nginx.conf
git commit -m "feat: add systemd service and nginx config for remote MCP"
```

---

### Task 7: Provision Script Update

**Files:**
- Modify: `scripts/provision-droplet.sh`

- [ ] **Step 1: Add MCP server provisioning section**

Append the following section to `scripts/provision-droplet.sh`, before the final "Verify" step (before line 286 `step "Verification"`):

```bash
# ── Bun runtime ────────────────────────────────────────
step "Installing Bun"

if command -v bun &>/dev/null; then
  warn "Bun already installed: $(bun --version)"
else
  curl -fsSL https://bun.sh/install | bash
  # Make bun available system-wide
  ln -sf /root/.bun/bin/bun /usr/local/bin/bun
  log "Bun installed: $(bun --version)"
fi

# ── MCP Server ─────────────────────────────────────────
step "Setting up remote MCP server"

MCP_DIR="/opt/deploy-ops"
MCP_WORKSPACE="/opt/deploy-ops/workspace"

# Clone or update repo
if [ -d "$MCP_DIR/.git" ]; then
  cd "$MCP_DIR" && git pull --ff-only
  warn "deploy-ops repo updated"
else
  git clone git@github.com:dovuofficial/dovu-app-paas.git "$MCP_DIR"
  log "deploy-ops repo cloned"
fi

cd "$MCP_DIR"
bun install --frozen-lockfile
log "Dependencies installed"

# Create workspace directory for state
mkdir -p "$MCP_WORKSPACE/.dovu-app-paas"
chown -R deploy:deploy "$MCP_WORKSPACE"

# Write host provider config
cat > "$MCP_WORKSPACE/.dovu-app-paas/config.json" << EOF
{
  "provider": "host",
  "host": {
    "baseDomain": "${DOMAIN}"
  }
}
EOF
chown deploy:deploy "$MCP_WORKSPACE/.dovu-app-paas/config.json"
log "Workspace configured"

# Create env file for secrets
mkdir -p /etc/deploy-ops
if [ ! -f /etc/deploy-ops/env ]; then
  GENERATED_SECRET=$(openssl rand -hex 24)
  echo "TEAM_SECRET=${GENERATED_SECRET}" > /etc/deploy-ops/env
  chmod 600 /etc/deploy-ops/env
  log "Team secret generated: ${GENERATED_SECRET}"
  warn "Save this secret — you'll share it with your team"
else
  warn "Team secret already exists at /etc/deploy-ops/env"
fi

# Install systemd service
cp "$MCP_DIR/scripts/deploy-ops-mcp.service" /etc/systemd/system/
# Replace domain placeholder in service file
sed -i "s/apps.dovu.ai/${DOMAIN}/g" /etc/systemd/system/deploy-ops-mcp.service
systemctl daemon-reload
systemctl enable deploy-ops-mcp
systemctl start deploy-ops-mcp
log "MCP server service installed and started"

# Install nginx config for MCP endpoint
cp "$MCP_DIR/scripts/mcp-nginx.conf" /etc/nginx/conf.d/deploy-ops-mcp.conf
sed -i "s/apps.dovu.ai/${DOMAIN}/g" /etc/nginx/conf.d/deploy-ops-mcp.conf
nginx -t && systemctl reload nginx
log "nginx configured for mcp.${DOMAIN}"

chown -R deploy:deploy "$MCP_DIR"
```

- [ ] **Step 2: Verify provision script is valid bash**

Run: `bash -n scripts/provision-droplet.sh`
Expected: No syntax errors

- [ ] **Step 3: Commit**

```bash
git add scripts/provision-droplet.sh
git commit -m "feat: add MCP server provisioning to droplet setup script"
```

---

### Task 8: Final Integration Verification

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests PASS (original 33 + new tests for host provider, resolve, slugify, remote server)

- [ ] **Step 2: Run typecheck**

Run: `bun x tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Manual smoke test of remote server**

Start the server locally:

```bash
TEAM_SECRET=test123 DEPLOY_OPS_DOMAIN=test.localhost MCP_PORT=8888 bun run src/mcp/remote.ts
```

In another terminal, verify health endpoint:

```bash
curl http://localhost:8888/health
# Expected: {"status":"ok"}
```

Verify auth rejection:

```bash
curl -X POST http://localhost:8888/mcp -H "Content-Type: application/json" -d '{}'
# Expected: 401
```

Verify auth acceptance:

```bash
curl -X POST http://localhost:8888/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer test123" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
# Expected: 200 with JSON-RPC response and mcp-session-id header
```

- [ ] **Step 4: Final commit with all files**

If any fixes were needed during verification, commit them:

```bash
git add -A
git commit -m "fix: integration test fixes for remote MCP server"
```
