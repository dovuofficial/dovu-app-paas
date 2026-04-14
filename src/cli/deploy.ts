import { Command } from "commander";

export const deployCommand = new Command("deploy")
  .description("Deploy the current project")
  .option("--name <name>", "Override app name")
  .option("--domain <domain>", "Use a custom domain")
  .action(async () => {
    console.log("Not yet implemented");
  });
