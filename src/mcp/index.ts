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
