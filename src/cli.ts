import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { describeCommand } from "./commands/describe.js";
import { listCommand } from "./commands/list.js";
import { activateCommand } from "./commands/activate.js";
import { updateRegistryCommand } from "./commands/update-registry.js";

const program = new Command();

program
  .name("kairn")
  .description(
    "Compile natural language intent into optimized Claude Code environments"
  )
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(describeCommand);
program.addCommand(listCommand);
program.addCommand(activateCommand);
program.addCommand(updateRegistryCommand);

program.parse();
