import { Command } from "commander";

export const statusCommand = new Command("status")
  .argument("<app>", "App name")
  .description("Show deployment status, resources, and warnings")
  .action(async () => {
    console.log("Not yet implemented");
  });
