import { Command } from "commander";

export const destroyCommand = new Command("destroy")
  .argument("<app>", "App name")
  .description("Remove a deployment completely")
  .action(async () => {
    console.log("Not yet implemented");
  });
