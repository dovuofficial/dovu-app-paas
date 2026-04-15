import { Command } from "commander";
import chalk from "chalk";
import { readConfig, readState, writeState } from "@/engine/state";
import { resolveProvider } from "@/providers/resolve";
import type { DeploymentRecord } from "@/types";

const readline = await import("readline");

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function buildDestroyCommands(app: string, dep: DeploymentRecord | null) {
  return {
    containerName: `dovu-app-paas-${app}`,
    image: dep?.image ?? null,
  };
}

export const destroyCommand = new Command("destroy")
  .argument("<app>", "App name")
  .option("--force", "Skip confirmation and work without state")
  .description("Remove a deployment completely")
  .action(async (app: string, options: { force?: boolean }) => {
    const cwd = process.cwd();
    const config = await readConfig(cwd);

    if (!config) {
      console.error(chalk.red("No config found. Run 'dovu-app init' first."));
      process.exit(1);
    }

    const state = await readState(cwd);
    const dep = state.deployments[app] ?? null;

    if (!dep && !options.force) {
      console.error(chalk.red(`Deployment '${app}' not found.`));
      process.exit(1);
    }

    if (!options.force) {
      const confirm = await prompt(`Remove ${app} and all its data? (y/N) `);
      if (confirm.toLowerCase() !== "y") {
        console.log("Cancelled.");
        return;
      }
    }

    const provider = resolveProvider(config);
    const { containerName, image } = buildDestroyCommands(app, dep);

    // Remove container
    try {
      await provider.exec(`docker stop ${containerName}`);
    } catch {}
    try {
      await provider.exec(`docker rm ${containerName}`);
    } catch {}
    console.log(chalk.green("✓") + " Container removed");

    // Remove image
    if (image) {
      try {
        await provider.exec(`docker rmi ${image}`);
      } catch {}
      console.log(chalk.green("✓") + " Image removed");
    }

    // Remove nginx config
    await provider.exec(`rm -f ${provider.nginxConfDir}/dovu-app-paas-${app}.conf ${provider.nginxConfDir}/dovu-app-paas-${app}.conf.disabled`);
    await provider.exec("nginx -s reload 2>/dev/null || sudo systemctl reload nginx");
    console.log(chalk.green("✓") + " Nginx config removed");

    // Remove from state
    if (dep) {
      delete state.deployments[app];
      await writeState(cwd, state);
      console.log(chalk.green("✓") + " Removed from state");
    }
  });
