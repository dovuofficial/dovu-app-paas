import { Command } from "commander";

export const stopCommand = new Command("stop")
  .argument("<app>", "App name")
  .description("Stop a deployment")
  .action(async () => {
    console.log("Not yet implemented");
  });
