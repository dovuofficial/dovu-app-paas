import { Command } from "commander";
import chalk from "chalk";
import { join } from "path";
import { tmpdir } from "os";
import { rm } from "fs/promises";
import { readConfig, readState, writeState, getNextPort } from "@/engine/state";
import { inspectProject } from "@/engine/rules";
import { buildImage, saveImage } from "@/engine/docker";
import { generateNginxConfig } from "@/engine/nginx";
import { resolveProvider } from "@/providers/resolve";
import type { DeploymentRecord } from "@/types";

export const deployCommand = new Command("deploy")
  .description("Deploy the current project")
  .option("--name <name>", "Override app name")
  .option("--domain <domain>", "Use a custom domain")
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
    console.log(`  Entrypoint: ${deployConfig.entrypoint}`);
    console.log(`  Port: ${deployConfig.port}`);

    // 2. Build Docker image
    const imageTag = `deploy-ops-${appName}:${Date.now().toString(36)}`;
    console.log("\nBuilding image...");
    await buildImage(cwd, imageTag, deployConfig.dockerfile, {
      runtime: deployConfig.runtime,
      entrypoint: deployConfig.entrypoint,
      port: deployConfig.port,
    });
    console.log(chalk.green("  Built: " + imageTag));

    // 3. Save and transfer image
    const tarballPath = join(tmpdir(), `deploy-ops-${appName}.tar`);
    console.log("Shipping to target...");
    await saveImage(imageTag, tarballPath);
    await provider.transferImage(tarballPath);
    await rm(tarballPath, { force: true });
    console.log(chalk.green("  Transferred"));

    // 4. Handle re-deploy: stop and remove old container by name
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

    // 5. Start container
    const hostPort = existing?.hostPort || await getNextPort(cwd);
    console.log("Starting container...");
    const containerId = (
      await provider.exec(
        `docker run -d --name deploy-ops-${appName} -p ${hostPort}:${deployConfig.port} ${imageTag}`
      )
    ).trim();
    console.log(chalk.green("  Started: " + containerId.slice(0, 12)));

    // 6. Configure nginx
    const domain = options.domain || `${appName}.${provider.baseDomain}`;
    const nginxConf = generateNginxConfig({ serverName: domain, hostPort });
    console.log("Configuring nginx...");
    await provider.exec(
      `cat > ${provider.nginxConfDir}/deploy-ops-${appName}.conf << 'NGINX_EOF'\n${nginxConf}\nNGINX_EOF`
    );
    await provider.exec("nginx -s reload");
    console.log(chalk.green("  Configured"));

    // 7. Update state
    const now = new Date().toISOString();
    const record: DeploymentRecord = {
      name: appName,
      image: imageTag,
      port: deployConfig.port,
      hostPort,
      domain,
      containerId: containerId.slice(0, 12),
      status: "running",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    state.deployments[appName] = record;
    await writeState(cwd, state);

    console.log(`\n${chalk.green("✓")} Deployed: ${chalk.bold(appName)}`);
    console.log(`  URL: ${chalk.cyan("http://" + domain)}`);
    console.log(`  Container: ${containerId.slice(0, 12)}`);
  });
