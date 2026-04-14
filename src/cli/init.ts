import { Command } from "commander";
import chalk from "chalk";
import { writeConfig, readConfig } from "@/engine/state";
import { LocalProvider } from "@/providers/local";
import type { AppConfig } from "@/types";

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

export const initCommand = new Command("init")
  .description("Initialize deploy-ops configuration")
  .action(async () => {
    const cwd = process.cwd();

    const existing = await readConfig(cwd);
    if (existing) {
      const overwrite = await prompt("Config already exists. Overwrite? (y/N) ");
      if (overwrite.toLowerCase() !== "y") {
        console.log("Cancelled.");
        return;
      }
    }

    const providerChoice = await prompt("Provider (local/digitalocean): ");

    let config: AppConfig;

    if (providerChoice === "local") {
      config = {
        provider: "local",
        local: { baseDomain: "ops.localhost" },
      };

      await writeConfig(cwd, config);
      console.log(chalk.green("✓") + " Config saved to .deploy-ops/config.json");

      console.log("Starting mini-droplet...");
      const provider = new LocalProvider(config.local!.baseDomain);
      await provider.setup();
      console.log(chalk.green("✓") + " Mini-droplet container started");
      console.log(chalk.green("✓") + " Nginx ready on localhost:80");
      console.log(chalk.green("✓") + " Deploy with: " + chalk.bold("deploy-ops deploy"));
    } else if (providerChoice === "digitalocean") {
      const host = await prompt("Droplet IP: ");
      const sshKey = await prompt("SSH key path (~/.ssh/id_ed25519): ") || "~/.ssh/id_ed25519";
      const user = await prompt("SSH user (root): ") || "root";
      const baseDomain = await prompt("Wildcard base domain: ");

      config = {
        provider: "digitalocean",
        digitalocean: { host, sshKey, user, baseDomain },
      };

      await writeConfig(cwd, config);
      console.log(chalk.green("✓") + " Config saved to .deploy-ops/config.json");

      // Verify connection
      console.log("Verifying connection...");
      const { DigitalOceanProvider } = await import("@/providers/digitalocean");
      const provider = new DigitalOceanProvider(config.digitalocean!);
      await provider.setup();
      console.log(chalk.green("✓") + " Connection verified");
      console.log(chalk.green("✓") + " Deploy with: " + chalk.bold("deploy-ops deploy"));
    } else {
      console.error(chalk.red("Unknown provider: " + providerChoice));
      process.exit(1);
    }
  });
