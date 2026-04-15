#!/usr/bin/env bun
import { Command } from "commander";
import { initCommand } from "./init";
import { deployCommand } from "./deploy";
import { devCommand } from "./dev";
import { lsCommand } from "./ls";
import { statusCommand } from "./status";
import { logsCommand } from "./logs";
import { stopCommand } from "./stop";
import { destroyCommand } from "./destroy";
import { redeployCommand } from "./redeploy";

const program = new Command();

program
  .name("dovu-app")
  .description("Instant deployment of JS/TS projects to Docker containers")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(deployCommand);
program.addCommand(devCommand);
program.addCommand(lsCommand);
program.addCommand(statusCommand);
program.addCommand(logsCommand);
program.addCommand(stopCommand);
program.addCommand(destroyCommand);
program.addCommand(redeployCommand);

program.parse();
