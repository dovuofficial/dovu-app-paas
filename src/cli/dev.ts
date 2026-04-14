import { Command } from "commander";
import chalk from "chalk";
import { readFile } from "fs/promises";
import { join, resolve } from "path";
import { $ } from "bun";
import { inspectProject } from "@/engine/rules";
import { buildImage } from "@/engine/docker";

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function getWatchCmd(runtime: string, framework: string, entrypoint: string): string[] {
  switch (framework) {
    case "nextjs":
      return ["npx", "next", "dev"];
    case "laravel":
      return ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"];
    default:
      return ["bun", "--watch", "run", entrypoint];
  }
}

export const devCommand = new Command("dev")
  .description("Run project in dev mode with hot reload (no rebuild on changes)")
  .option("--name <name>", "Override app name")
  .option("--port <port>", "Override host port")
  .option("-e, --env <KEY=VALUE...>", "Set environment variables", (val: string, acc: string[]) => { acc.push(val); return acc; }, [])
  .action(async (options) => {
    const cwd = resolve(process.cwd());

    // 1. Inspect project
    console.log("Inspecting project...");
    const deployConfig = await inspectProject(cwd);
    const appName = options.name || deployConfig.name;

    console.log(`  Runtime: ${deployConfig.runtime}`);
    if (deployConfig.framework !== "none") console.log(`  Framework: ${deployConfig.framework}`);
    console.log(`  Entrypoint: ${deployConfig.entrypoint}`);
    console.log(`  Port: ${deployConfig.port}`);

    // 2. Collect env vars
    const env: Record<string, string> = {};
    try {
      const envContent = await readFile(join(cwd, ".env"), "utf-8");
      Object.assign(env, parseEnvFile(envContent));
    } catch {}
    for (const entry of options.env as string[]) {
      const eqIndex = entry.indexOf("=");
      if (eqIndex !== -1) {
        env[entry.slice(0, eqIndex)] = entry.slice(eqIndex + 1);
      }
    }

    // 3. Build image once (for deps layer)
    const imageTag = `deploy-ops-dev-${appName}:latest`;
    console.log("\nBuilding image (deps only, one-time)...");
    await buildImage(cwd, imageTag, deployConfig.dockerfile, {
      runtime: deployConfig.runtime,
      framework: deployConfig.framework,
      entrypoint: deployConfig.entrypoint,
      port: deployConfig.port,
    });
    console.log(chalk.green("  Built: " + imageTag));

    // 4. Stop any existing dev container
    const containerName = `deploy-ops-dev-${appName}`;
    try {
      await $`docker rm -f ${containerName}`.quiet();
    } catch {}

    // 5. Run with volume mount + watch mode
    const hostPort = options.port ? parseInt(options.port, 10) : deployConfig.port;
    const watchCmd = getWatchCmd(deployConfig.runtime, deployConfig.framework, deployConfig.entrypoint);
    const envFlags = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);

    console.log(`\n${chalk.green("✓")} Starting dev server...`);
    console.log(`  URL: ${chalk.cyan(`http://localhost:${hostPort}`)}`);
    console.log(`  Watch: ${watchCmd.join(" ")}`);
    console.log(`  Volume: ${cwd} → /app`);
    if (Object.keys(env).length > 0) console.log(`  Env: ${Object.keys(env).join(", ")}`);
    console.log(chalk.dim("\n  File changes will reflect instantly. Ctrl+C to stop.\n"));

    const proc = Bun.spawn(
      [
        "docker", "run", "--rm",
        "--name", containerName,
        "-p", `${hostPort}:${deployConfig.port}`,
        "-v", `${cwd}:/app`,
        "-w", "/app",
        ...envFlags,
        imageTag,
        ...watchCmd,
      ],
      {
        stdout: "inherit",
        stderr: "inherit",
      }
    );

    process.on("SIGINT", () => {
      proc.kill();
      console.log(`\n${chalk.yellow("Stopped")} dev server for ${appName}`);
    });

    await proc.exited;
  });
