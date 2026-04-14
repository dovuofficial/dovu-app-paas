import { Command } from "commander";
import chalk from "chalk";
import { readConfig, readState, writeState } from "@/engine/state";
import { resolveProvider } from "@/providers/resolve";

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

export const destroyCommand = new Command("destroy")
  .argument("<app>", "App name")
  .description("Remove a deployment completely")
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

    const confirm = await prompt(`Remove ${app} and all its data? (y/N) `);
    if (confirm.toLowerCase() !== "y") {
      console.log("Cancelled.");
      return;
    }

    const provider = resolveProvider(config);
    const containerName = `deploy-ops-${app}`;

    // Remove container
    try {
      await provider.exec(`docker stop ${containerName}`);
    } catch {}
    try {
      await provider.exec(`docker rm ${containerName}`);
    } catch {}
    console.log(chalk.green("✓") + " Container removed");

    // Remove image
    try {
      await provider.exec(`docker rmi ${dep.image}`);
    } catch {}
    console.log(chalk.green("✓") + " Image removed");

    // Remove nginx config
    await provider.exec(`rm -f /etc/nginx/conf.d/deploy-ops-${app}.conf /etc/nginx/conf.d/deploy-ops-${app}.conf.disabled`);
    await provider.exec("nginx -s reload");
    console.log(chalk.green("✓") + " Nginx config removed");

    // Remove from state
    delete state.deployments[app];
    await writeState(cwd, state);
    console.log(chalk.green("✓") + " Removed from state");
  });
