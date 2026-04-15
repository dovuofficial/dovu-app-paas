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
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function registerTools(server: McpServer, cwd: string) {
  function getConfigOrError() {
    const config = resolveConfig(cwd);
    if (!config) {
      return {
        error: "No deploy-ops configuration found. Set env vars (DEPLOY_OPS_HOST, DEPLOY_OPS_SSH_KEY, DEPLOY_OPS_DOMAIN) or run 'dovu-app init' in your project.",
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
      const { config, error } = getConfigOrError();
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
      const { config, error } = getConfigOrError();
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
      const { config, error } = getConfigOrError();
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

  server.tool(
    "deploy",
    "Deploy the current project to the configured droplet",
    {
      name: z.string().optional().describe("Override app name (defaults to directory name)"),
      domain: z.string().optional().describe("Override domain"),
      env: z.record(z.string(), z.string()).optional().describe("Environment variables as key-value pairs"),
      deployer: z.string().optional().describe("Name of the person deploying (used in subdomain, e.g. 'alice')"),
    },
    async ({ name, domain, env: envInput, deployer }) => {
      const { config, error } = getConfigOrError();
      if (error) return { content: [{ type: "text", text: error }] };

      const provider = resolveProvider(config!);
      const steps: string[] = [];

      // 1. Inspect project
      const deployConfig = await inspectProject(cwd);
      const appName = name || deployConfig.name;
      const deployerSlug = deployer ? slugify(deployer) : null;
      const subdomainName = deployerSlug ? `${appName}-${deployerSlug}` : appName;
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
      const deployDomain = domain || `${subdomainName}.${provider.baseDomain}`;
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

  server.tool(
    "dev",
    "Start hot-reload dev mode for the current project",
    {
      name: z.string().optional().describe("Override app name"),
      port: z.number().optional().describe("Override host port"),
      env: z.record(z.string(), z.string()).optional().describe("Environment variables as key-value pairs"),
      deployer: z.string().optional().describe("Name of the person deploying (used in subdomain, e.g. 'alice')"),
    },
    async ({ name, port, env: envInput, deployer }) => {
      // Inspect project
      const deployConfig = await inspectProject(cwd);
      const appName = name || deployConfig.name;
      const deployerSlug = deployer ? slugify(deployer) : null;
      const subdomainName = deployerSlug ? `${appName}-${deployerSlug}` : appName;

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
            appName: subdomainName,
            containerId: containerId.slice(0, 12),
            port: hostPort,
            watchCommand: watchCmd.join(" "),
            stopCommand: `docker rm -f ${containerName}`,
          }, null, 2),
        }],
      };
    }
  );
}
