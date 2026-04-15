import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveConfig } from "./config";
import { resolveProvider } from "@/providers/resolve";
import { readState, writeState } from "@/engine/state";
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
      await writeState(cwd, state);
      results.push("Removed from state");
    }

    return { content: [{ type: "text", text: `Destroyed '${app}':\n${results.map(r => `  - ${r}`).join("\n")}` }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
