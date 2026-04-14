import { Command } from "commander";

export const lsCommand = new Command("ls")
  .description("List all deployments")
  .action(async () => {
    console.log("Not yet implemented");
  });
