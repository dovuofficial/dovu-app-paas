import { Command } from "commander";
import chalk from "chalk";
import { readConfig, readState, writeState } from "@/engine/state";
import { resolveProvider } from "@/providers/resolve";

export const stopCommand = new Command("stop")
  .argument("<app>", "App name")
  .description("Stop a deployment")
  .action(async (app: string) => {
    const cwd = process.cwd();
    const config = await readConfig(cwd);

    if (!config) {
      console.error(chalk.red("No config found. Run 'dovu-app init' first."));
      process.exit(1);
    }

    const state = await readState(cwd);
    const dep = state.deployments[app];

    if (!dep) {
      console.error(chalk.red(`Deployment '${app}' not found.`));
      process.exit(1);
    }

    const provider = resolveProvider(config);
    const containerName = `dovu-app-paas-${app}`;

    // Stop container
    await provider.exec(`docker stop ${containerName}`);
    console.log(chalk.green("✓") + " Container stopped");

    // Disable nginx config (rename to .disabled)
    await provider.exec(
      `mv ${provider.nginxConfDir}/dovu-app-paas-${app}.conf ${provider.nginxConfDir}/dovu-app-paas-${app}.conf.disabled 2>/dev/null || true`
    );
    await provider.exec("nginx -s reload 2>/dev/null || sudo systemctl reload nginx");
    console.log(chalk.green("✓") + " Nginx config disabled");

    // Update state
    dep.status = "stopped";
    dep.updatedAt = new Date().toISOString();
    await writeState(cwd, state);
  });
