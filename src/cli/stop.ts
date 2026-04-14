import { Command } from "commander";
import chalk from "chalk";
import { readConfig, readState, writeState } from "@/engine/state";
import { LocalProvider } from "@/providers/local";
import { DigitalOceanProvider } from "@/providers/digitalocean";
import type { Provider } from "@/providers/provider";

function getProvider(config: any): Provider {
  if (config.provider === "local") {
    return new LocalProvider(config.local.baseDomain);
  }
  return new DigitalOceanProvider(config.digitalocean);
}

export const stopCommand = new Command("stop")
  .argument("<app>", "App name")
  .description("Stop a deployment")
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

    const provider = getProvider(config);
    const containerName = `deploy-ops-${app}`;

    // Stop container
    await provider.exec(`docker stop ${containerName}`);
    console.log(chalk.green("✓") + " Container stopped");

    // Disable nginx config (rename to .disabled)
    await provider.exec(
      `mv /etc/nginx/conf.d/deploy-ops-${app}.conf /etc/nginx/conf.d/deploy-ops-${app}.conf.disabled 2>/dev/null || true`
    );
    await provider.exec("nginx -s reload");
    console.log(chalk.green("✓") + " Nginx config disabled");

    // Update state
    dep.status = "stopped";
    dep.updatedAt = new Date().toISOString();
    await writeState(cwd, state);
  });
