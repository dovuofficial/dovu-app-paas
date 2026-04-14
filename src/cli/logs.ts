import { Command } from "commander";
import chalk from "chalk";
import { readConfig, readState } from "@/engine/state";

export const logsCommand = new Command("logs")
  .argument("<app>", "App name")
  .description("Stream logs from a deployment")
  .action(async (app: string) => {
    const cwd = process.cwd();
    const config = await readConfig(cwd);

    if (!config) {
      console.error(chalk.red("No config found. Run 'deploy-ops init' first."));
      process.exit(1);
    }

    const state = await readState(cwd);
    const dep = state.deployments[app];

    if (!dep) {
      console.error(chalk.red(`Deployment '${app}' not found.`));
      process.exit(1);
    }

    const containerName = `deploy-ops-${app}`;

    if (config.provider === "local") {
      // Stream logs directly — docker exec with docker logs -f
      const proc = Bun.spawn(["docker", "exec", "deploy-ops-mini-droplet", "docker", "logs", "-f", containerName], {
        stdout: "inherit",
        stderr: "inherit",
      });
      process.on("SIGINT", () => proc.kill());
      await proc.exited;
    } else {
      const do_config = config.digitalocean!;
      const sshKey = do_config.sshKey.replace("~", process.env.HOME || "");
      const proc = Bun.spawn(["ssh", "-i", sshKey, "-o", "StrictHostKeyChecking=no", `${do_config.user}@${do_config.host}`, `docker logs -f ${containerName}`], {
        stdout: "inherit",
        stderr: "inherit",
      });
      process.on("SIGINT", () => proc.kill());
      await proc.exited;
    }
  });
