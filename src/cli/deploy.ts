import { Command } from "commander";
import chalk from "chalk";
import { join } from "path";
import { tmpdir } from "os";
import { readFile, rm } from "fs/promises";
import { readConfig, readState, writeState, getNextPort } from "@/engine/state";
import { inspectProject } from "@/engine/rules";
import { buildImage, saveImage } from "@/engine/docker";
import { generateNginxConfig } from "@/engine/nginx";
import { resolveProvider } from "@/providers/resolve";
import type { DeploymentRecord } from "@/types";

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function buildEnvFlags(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `-e ${k}=${JSON.stringify(v)}`)
    .join(" ");
}

export const deployCommand = new Command("deploy")
  .description("Deploy the current project")
  .option("--name <name>", "Override app name")
  .option("--domain <domain>", "Use a custom domain")
  .option("-e, --env <KEY=VALUE...>", "Set environment variables", (val: string, acc: string[]) => { acc.push(val); return acc; }, [])
  .action(async (options) => {
    const cwd = process.cwd();
    const config = await readConfig(cwd);

    if (!config) {
      console.error(chalk.red("No config found. Run 'deploy-ops init' first."));
      process.exit(1);
    }

    const provider = resolveProvider(config);

    // 1. Inspect project
    console.log("Inspecting project...");
    const deployConfig = await inspectProject(cwd);
    const appName = options.name || deployConfig.name;

    console.log(`  Runtime: ${deployConfig.runtime}`);
    if (deployConfig.framework !== "none") console.log(`  Framework: ${deployConfig.framework}`);
    console.log(`  Entrypoint: ${deployConfig.entrypoint}`);
    console.log(`  Port: ${deployConfig.port}`);

    // 2. Collect environment variables: .env file + CLI flags
    const env: Record<string, string> = {};

    // Read .env file if it exists
    try {
      const envContent = await readFile(join(cwd, ".env"), "utf-8");
      Object.assign(env, parseEnvFile(envContent));
    } catch {
      // No .env file — that's fine
    }

    // CLI --env flags override .env file
    for (const entry of options.env as string[]) {
      const eqIndex = entry.indexOf("=");
      if (eqIndex !== -1) {
        env[entry.slice(0, eqIndex)] = entry.slice(eqIndex + 1);
      }
    }

    if (Object.keys(env).length > 0) {
      console.log(`  Env vars: ${Object.keys(env).join(", ")}`);
    }

    // 3. Build Docker image
    const imageTag = `deploy-ops-${appName}:${Date.now().toString(36)}`;
    console.log("\nBuilding image...");
    await buildImage(cwd, imageTag, deployConfig.dockerfile, {
      runtime: deployConfig.runtime,
      framework: deployConfig.framework,
      entrypoint: deployConfig.entrypoint,
      port: deployConfig.port,
    });
    console.log(chalk.green("  Built: " + imageTag));

    // 4. Save and transfer image
    const tarballPath = join(tmpdir(), `deploy-ops-${appName}.tar`);
    console.log("Shipping to target...");
    await saveImage(imageTag, tarballPath);
    await provider.transferImage(tarballPath);
    await rm(tarballPath, { force: true });
    console.log(chalk.green("  Transferred"));

    // 5. Handle re-deploy: stop and remove old container by name
    const state = await readState(cwd);
    const existing = state.deployments[appName];
    const containerName = `deploy-ops-${appName}`;
    try {
      await provider.exec(`docker stop ${containerName}`);
      await provider.exec(`docker rm ${containerName}`);
      if (existing) console.log("Replacing existing deployment...");
    } catch {
      // Container may not exist — that's fine
    }

    // 6. Start container — find a free port by querying the provider
    let hostPort = existing?.hostPort || await getNextPort(cwd);
    try {
      const portsOutput = await provider.exec(
        `docker ps --format '{{.Ports}}' | sed 's/,/\\n/g' | sed -n 's/.*0\\.0\\.0\\.0:\\([0-9]*\\).*/\\1/p' | sort -u`
      );
      const used = new Set(portsOutput.trim().split("\n").filter(Boolean).map(Number));
      while (used.has(hostPort)) hostPort++;
    } catch {
      // If we can't query, proceed with the calculated port
    }

    const envFlags = buildEnvFlags(env);
    console.log("Starting container...");
    const containerId = (
      await provider.exec(
        `docker run -d --name ${containerName} -p ${hostPort}:${deployConfig.port} ${envFlags} ${imageTag}`
      )
    ).trim();
    console.log(chalk.green("  Started: " + containerId.slice(0, 12)));

    // 7. Configure nginx
    const domain = options.domain || `${appName}.${provider.baseDomain}`;
    const nginxConf = generateNginxConfig({ serverName: domain, hostPort });
    console.log("Configuring nginx...");
    await provider.exec(
      `cat > ${provider.nginxConfDir}/deploy-ops-${appName}.conf << 'NGINX_EOF'\n${nginxConf}\nNGINX_EOF`
    );
    await provider.exec("nginx -s reload");
    console.log(chalk.green("  Configured"));

    // 8. Update state
    const now = new Date().toISOString();
    const record: DeploymentRecord = {
      name: appName,
      image: imageTag,
      port: deployConfig.port,
      hostPort,
      domain,
      containerId: containerId.slice(0, 12),
      status: "running",
      env,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    state.deployments[appName] = record;
    await writeState(cwd, state);

    console.log(`\n${chalk.green("✓")} Deployed: ${chalk.bold(appName)}`);
    console.log(`  URL: ${chalk.cyan("http://" + domain)}`);
    console.log(`  Container: ${containerId.slice(0, 12)}`);
  });
