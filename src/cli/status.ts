import { Command } from "commander";
import chalk from "chalk";
import { readConfig, readState } from "@/engine/state";
import { resolveProvider } from "@/providers/resolve";

export const statusCommand = new Command("status")
  .argument("<app>", "App name")
  .description("Show deployment status, resources, and warnings")
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
    const containerName = `dovu-app-${app}`;

    // Get container info
    let isRunning = false;
    let restartCount = 0;
    let uptime = "—";

    try {
      const inspectJson = await provider.exec(
        `docker inspect ${containerName} --format '{{.State.Running}}|{{.RestartCount}}|{{.State.StartedAt}}'`
      );
      const [running, restarts, startedAt] = inspectJson.trim().split("|");
      isRunning = running === "true";
      restartCount = parseInt(restarts, 10) || 0;

      if (isRunning) {
        const diff = Date.now() - new Date(startedAt).getTime();
        const minutes = Math.floor(diff / 60000);
        if (minutes < 60) uptime = `${minutes}m`;
        else {
          const hours = Math.floor(minutes / 60);
          uptime = `${hours}h ${minutes % 60}m`;
        }
      }
    } catch {
      // Container doesn't exist
    }

    const statusColor = isRunning ? chalk.green : chalk.yellow;

    console.log(`Name:       ${chalk.bold(dep.name)}`);
    console.log(`Status:     ${statusColor(isRunning ? "running" : "stopped")}`);
    console.log(`Domain:     ${chalk.cyan("http://" + dep.domain)}`);
    console.log(`Container:  ${dep.containerId}`);
    console.log(`Uptime:     ${uptime}`);
    console.log(`Image:      ${dep.image}`);

    // Resources (only if running)
    if (isRunning) {
      try {
        const stats = await provider.exec(
          `docker stats ${containerName} --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}'`
        );
        const [cpu, mem] = stats.trim().split("|");
        console.log(`\n${chalk.bold("Resources:")}`);
        console.log(`  CPU:      ${cpu}`);
        console.log(`  Memory:   ${mem}`);
      } catch {
        console.log(`\n${chalk.bold("Resources:")}  unavailable`);
      }
    }

    // Warnings
    const warnings: string[] = [];
    if (restartCount > 0) {
      warnings.push(`Container has restarted ${restartCount} time${restartCount > 1 ? "s" : ""}`);
    }

    try {
      const memStats = await provider.exec(
        `docker stats ${containerName} --no-stream --format '{{.MemPerc}}'`
      );
      const memPercent = parseFloat(memStats.trim().replace("%", ""));
      if (memPercent > 80) {
        warnings.push(`Memory usage at ${memPercent.toFixed(0)}% of limit`);
      }
    } catch {}

    console.log(`\n${chalk.bold("Warnings:")}`);
    if (warnings.length === 0) {
      console.log("  (none)");
    } else {
      for (const w of warnings) {
        console.log(chalk.yellow(`  ⚠ ${w}`));
      }
    }
  });
