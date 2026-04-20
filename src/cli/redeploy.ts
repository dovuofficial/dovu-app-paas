import { Command } from "commander";
import chalk from "chalk";
import { readConfig, readState } from "@/engine/state";
import { resolveProvider } from "@/providers/resolve";
import { inspectProject } from "@/engine/rules";
import { buildImage, saveImage } from "@/engine/docker";
import { generateNginxConfig } from "@/engine/nginx";
import { join } from "path";
import { tmpdir } from "os";
import { rm } from "fs/promises";

export const redeployCommand = new Command("redeploy-all")
  .description("Redeploy all apps from state (useful after droplet reboot/reset)")
  .action(async () => {
    const cwd = process.cwd();
    const config = await readConfig(cwd);

    if (!config) {
      console.error(chalk.red("No config found. Run 'dovu-app init' first."));
      process.exit(1);
    }

    const state = await readState(cwd);
    const deployments = Object.values(state.deployments);

    if (deployments.length === 0) {
      console.log("No deployments in state. Nothing to redeploy.");
      return;
    }

    const provider = resolveProvider(config);

    console.log(chalk.bold(`\nRedeploying ${deployments.length} app(s)...\n`));

    let succeeded = 0;
    let failed = 0;

    for (const dep of deployments) {
      console.log(chalk.bold(`--- ${dep.name} ---`));

      try {
        // Check if container is already running
        try {
          const running = await provider.exec(
            `docker inspect -f '{{.State.Running}}' dovu-app-paas-${dep.name}`
          );
          if (running.trim() === "true") {
            console.log(chalk.green("  Already running, skipping"));
            succeeded++;
            continue;
          }
        } catch {
          // Container doesn't exist — needs full redeploy
        }

        // Try to just restart the existing container first
        try {
          await provider.exec(`docker start dovu-app-paas-${dep.name}`);
          console.log(chalk.green("  Restarted existing container"));

          // Re-write nginx config
          const nginxConf = generateNginxConfig({
            serverName: dep.domain,
            hostPort: dep.hostPort!,
            ssl: provider.ssl ?? undefined,
          });
          const confB64 = Buffer.from(nginxConf).toString("base64");
          await provider.exec(
            `echo '${confB64}' | base64 -d > ${provider.nginxConfDir}/dovu-app-paas-${dep.name}.conf`
          );

          succeeded++;
          continue;
        } catch {
          // Container gone — need full rebuild
          console.log(chalk.yellow("  Container gone, rebuilding..."));
        }

        // Full rebuild — need the project directory
        // Try common locations relative to cwd
        const possibleDirs = [
          join(cwd, dep.name),
          join(cwd, "sandbox-demo", dep.name),
        ];

        let projectDir: string | null = null;
        for (const dir of possibleDirs) {
          const file = Bun.file(join(dir, "package.json"));
          if (await file.exists()) {
            projectDir = dir;
            break;
          }
          // Check for artisan (Laravel)
          const artisan = Bun.file(join(dir, "artisan"));
          if (await artisan.exists()) {
            projectDir = dir;
            break;
          }
        }

        if (!projectDir) {
          console.log(chalk.red(`  Could not find project directory for ${dep.name}`));
          failed++;
          continue;
        }

        const deployConfig = await inspectProject(projectDir);
        const platform = provider.name === "local" ? undefined : "linux/amd64";
        const imageTag = `dovu-app-paas-${dep.name}:${Date.now().toString(36)}`;

        await buildImage(projectDir, imageTag, deployConfig.dockerfile, {
          runtime: deployConfig.runtime,
          framework: deployConfig.framework,
          entrypoint: deployConfig.entrypoint,
          port: deployConfig.port,
        }, platform);

        const tarball = join(tmpdir(), `dovu-app-paas-${dep.name}.tar`);
        await saveImage(imageTag, tarball);
        await provider.transferImage(tarball);
        await rm(tarball, { force: true });

        // Remove old container if it exists
        try { await provider.exec(`docker rm -f dovu-app-paas-${dep.name}`); } catch {}

        // Query used ports
        let hostPort = dep.hostPort!;
        try {
          const portsOutput = await provider.exec(
            `docker ps --format '{{.Ports}}' | sed 's/,/\\n/g' | sed -n 's/.*:\\([0-9]*\\)->.*/\\1/p' | sort -u`
          );
          const used = new Set(portsOutput.trim().split("\n").filter(Boolean).map(Number));
          while (used.has(hostPort)) hostPort++;
        } catch {}

        const containerId = (
          await provider.exec(
            `docker run -d --name dovu-app-paas-${dep.name} -p 127.0.0.1:${hostPort}:${deployConfig.port} --memory=256m --cpus=0.5 --restart=unless-stopped ${imageTag}`
          )
        ).trim();

        const nginxConf = generateNginxConfig({
          serverName: dep.domain,
          hostPort,
          ssl: provider.ssl ?? undefined,
        });
        const confB64 = Buffer.from(nginxConf).toString("base64");
        await provider.exec(
          `echo '${confB64}' | base64 -d > ${provider.nginxConfDir}/dovu-app-paas-${dep.name}.conf`
        );

        console.log(chalk.green(`  Rebuilt and deployed (${containerId.slice(0, 12)})`));
        succeeded++;
      } catch (err) {
        console.log(chalk.red(`  Failed: ${(err as Error).message}`));
        failed++;
      }
    }

    // Reload nginx once at the end
    try {
      await provider.exec("nginx -s reload 2>/dev/null || sudo systemctl reload nginx");
    } catch {}

    console.log(
      `\n${chalk.bold("Done:")} ${chalk.green(`${succeeded} succeeded`)}, ${failed > 0 ? chalk.red(`${failed} failed`) : "0 failed"}\n`
    );
  });
