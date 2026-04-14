import { Command } from "commander";
import chalk from "chalk";
import { readFile } from "fs/promises";
import { join, resolve } from "path";
import { $ } from "bun";
import { inspectProject } from "@/engine/rules";
import { buildImage } from "@/engine/docker";
import { generateNginxConfig } from "@/engine/nginx";
import { readConfig, readState, writeState } from "@/engine/state";
import { resolveProvider } from "@/providers/resolve";
import type { Provider } from "@/providers/provider";

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function getWatchCmd(runtime: string, framework: string, entrypoint: string): string[] {
  switch (framework) {
    case "nextjs":
      return ["npx", "next", "dev"];
    case "laravel":
      return ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"];
    default:
      return ["bun", "--watch", "run", entrypoint];
  }
}

export const devCommand = new Command("dev")
  .description("Run project in dev mode with hot reload (no rebuild on changes)")
  .option("--name <name>", "Override app name")
  .option("--port <port>", "Override host port")
  .option("-e, --env <KEY=VALUE...>", "Set environment variables", (val: string, acc: string[]) => { acc.push(val); return acc; }, [])
  .action(async (options) => {
    const cwd = resolve(process.cwd());

    // 1. Inspect project
    console.log("Inspecting project...");
    const deployConfig = await inspectProject(cwd);
    const appName = options.name || deployConfig.name;

    console.log(`  Runtime: ${deployConfig.runtime}`);
    if (deployConfig.framework !== "none") console.log(`  Framework: ${deployConfig.framework}`);
    console.log(`  Entrypoint: ${deployConfig.entrypoint}`);
    console.log(`  Port: ${deployConfig.port}`);

    // 2. Collect env vars
    const env: Record<string, string> = {};
    try {
      const envContent = await readFile(join(cwd, ".env"), "utf-8");
      Object.assign(env, parseEnvFile(envContent));
    } catch {}
    for (const entry of options.env as string[]) {
      const eqIndex = entry.indexOf("=");
      if (eqIndex !== -1) {
        env[entry.slice(0, eqIndex)] = entry.slice(eqIndex + 1);
      }
    }

    // 3. Build image once (for deps layer)
    const imageTag = `deploy-ops-dev-${appName}:latest`;
    console.log("\nBuilding image (deps only, one-time)...");
    await buildImage(cwd, imageTag, deployConfig.dockerfile, {
      runtime: deployConfig.runtime,
      framework: deployConfig.framework,
      entrypoint: deployConfig.entrypoint,
      port: deployConfig.port,
    });
    console.log(chalk.green("  Built: " + imageTag));

    // 4. Stop any existing deployed container for this app
    const config = await readConfig(cwd);
    let provider: Provider | null = null;
    let domain = `${appName}.ops.localhost`;

    if (config) {
      provider = resolveProvider(config);
      const state = await readState(cwd);
      const existing = state.deployments[appName];

      if (existing) {
        domain = existing.domain;
      }

      // Stop the deployed container inside the mini-droplet
      try {
        await provider.exec(`docker stop deploy-ops-${appName}`);
        console.log(chalk.yellow(`  Stopped deployed ${appName}`));

        if (existing) {
          existing.status = "stopped";
          existing.updatedAt = new Date().toISOString();
          await writeState(cwd, state);
        }
      } catch {}
    }

    // Stop any existing dev container on host
    const containerName = `deploy-ops-dev-${appName}`;
    try {
      await $`docker rm -f ${containerName}`.quiet();
    } catch {}

    // 5. Find a free host port
    let hostPort = options.port ? parseInt(options.port, 10) : deployConfig.port;
    if (!options.port) {
      try {
        const check = Bun.spawn(["lsof", "-i", `:${hostPort}`, "-t"], { stdout: "pipe", stderr: "pipe" });
        const output = await new Response(check.stdout).text();
        if (output.trim()) {
          for (let p = hostPort + 1; p < hostPort + 100; p++) {
            const c = Bun.spawn(["lsof", "-i", `:${p}`, "-t"], { stdout: "pipe", stderr: "pipe" });
            const o = await new Response(c.stdout).text();
            if (!o.trim()) { hostPort = p; break; }
          }
        }
      } catch {}
    }

    // 6. Point nginx in mini-droplet at host.docker.internal:hostPort
    if (provider) {
      const nginxConf = generateNginxConfig({
        serverName: domain,
        hostPort,
        upstream: "host.docker.internal",
      });
      try {
        await provider.exec(
          `cat > ${provider.nginxConfDir}/deploy-ops-${appName}.conf << 'NGINX_EOF'\n${nginxConf}\nNGINX_EOF`
        );
        await provider.exec("nginx -s reload");
      } catch {}
    }

    // 7. Run dev container on host Docker with volume mount
    const watchCmd = getWatchCmd(deployConfig.runtime, deployConfig.framework, deployConfig.entrypoint);
    const envFlags = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);

    console.log(`\n${chalk.green("✓")} Dev server starting...`);
    console.log(`  URL: ${chalk.cyan(`http://${domain}`)}`);
    console.log(`  Also: ${chalk.dim(`http://localhost:${hostPort}`)}`);
    console.log(`  Watch: ${watchCmd.join(" ")}`);
    console.log(`  Volume: ${cwd} → /app`);
    if (Object.keys(env).length > 0) console.log(`  Env: ${Object.keys(env).join(", ")}`);
    console.log(chalk.dim("\n  File changes will reflect instantly. Ctrl+C to stop.\n"));

    const proc = Bun.spawn(
      [
        "docker", "run", "--rm",
        "--name", containerName,
        "-p", `${hostPort}:${deployConfig.port}`,
        "-v", `${cwd}:/app`,
        "-w", "/app",
        ...envFlags,
        imageTag,
        ...watchCmd,
      ],
      {
        stdout: "inherit",
        stderr: "inherit",
      }
    );

    // On Ctrl+C: stop dev container, restore nginx to deployed container
    async function cleanup() {
      proc.kill();
      console.log(`\n${chalk.yellow("Stopping")} dev server...`);

      // Restore nginx to point back at the deployed container if it exists
      if (provider && config) {
        const state = await readState(cwd);
        const existing = state.deployments[appName];
        if (existing) {
          const nginxConf = generateNginxConfig({
            serverName: domain,
            hostPort: existing.hostPort,
          });
          try {
            await provider.exec(
              `cat > ${provider.nginxConfDir}/deploy-ops-${appName}.conf << 'NGINX_EOF'\n${nginxConf}\nNGINX_EOF`
            );
            // Restart the deployed container
            await provider.exec(`docker start deploy-ops-${appName}`);
            existing.status = "running";
            existing.updatedAt = new Date().toISOString();
            await writeState(cwd, state);
            await provider.exec("nginx -s reload");
            console.log(chalk.green("✓") + ` Restored deployed ${appName} at http://${domain}`);
          } catch {
            await provider.exec("nginx -s reload").catch(() => {});
            console.log(chalk.yellow("  Could not restore deployed container. Run 'deploy-ops deploy' to redeploy."));
          }
        }
      }
    }

    process.on("SIGINT", () => cleanup());
    await proc.exited;
  });
