import { Command } from "commander";
import chalk from "chalk";
import { readConfig, readState } from "@/engine/state";
import { resolveProvider } from "@/providers/resolve";

function formatUptime(createdAt: string, status: string): string {
  if (status === "stopped") return "—";
  const diff = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMins = minutes % 60;
  if (hours < 24) return `${hours}h ${remainMins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export const lsCommand = new Command("ls")
  .description("List all deployments")
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
      console.log("No deployments.");
      return;
    }

    // Reconcile status with live data
    const provider = resolveProvider(config);
    for (const dep of deployments) {
      try {
        const running = await provider.exec(`docker inspect -f '{{.State.Running}}' dovu-app-${dep.name}`);
        dep.status = running.trim() === "true" ? "running" : "stopped";
      } catch {
        dep.status = "stopped";
      }
    }

    // Print table
    const nameWidth = Math.max(4, ...deployments.map((d) => d.name.length));
    const domainWidth = Math.max(6, ...deployments.map((d) => d.domain.length));

    console.log(
      chalk.bold(
        "NAME".padEnd(nameWidth + 2) +
        "STATUS".padEnd(10) +
        "DOMAIN".padEnd(domainWidth + 2) +
        "UPTIME"
      )
    );

    for (const dep of deployments) {
      const statusColor = dep.status === "running" ? chalk.green : chalk.yellow;
      console.log(
        dep.name.padEnd(nameWidth + 2) +
        statusColor(dep.status.padEnd(10)) +
        dep.domain.padEnd(domainWidth + 2) +
        formatUptime(dep.createdAt, dep.status)
      );
    }
  });
