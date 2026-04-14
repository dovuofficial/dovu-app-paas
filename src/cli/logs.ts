import { Command } from "commander";

export const logsCommand = new Command("logs")
  .argument("<app>", "App name")
  .description("Stream logs from a deployment")
  .action(async () => {
    console.log("Not yet implemented");
  });
