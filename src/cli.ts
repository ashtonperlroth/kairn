import { Command } from "commander";
import chalk from "chalk";
import { initCommand } from "./commands/init.js";
import { describeCommand } from "./commands/describe.js";
import { listCommand } from "./commands/list.js";
import { activateCommand } from "./commands/activate.js";
import { updateRegistryCommand } from "./commands/update-registry.js";
import { optimizeCommand } from "./commands/optimize.js";
import { doctorCommand } from "./commands/doctor.js";
import { registryCommand } from "./commands/registry.js";
import { templatesCommand } from "./commands/templates.js";

const program = new Command();

program
  .name("kairn")
  .description(
    "Compile natural language intent into optimized Claude Code environments"
  )
  .version("1.7.0")
  .option("--no-color", "Disable colored output");

program.addCommand(initCommand);
program.addCommand(describeCommand);
program.addCommand(optimizeCommand);
program.addCommand(listCommand);
program.addCommand(activateCommand);
program.addCommand(updateRegistryCommand);
program.addCommand(doctorCommand);
program.addCommand(registryCommand);
program.addCommand(templatesCommand);

// Check for --no-color before parsing (Commander handles it but chalk needs manual disable)
if (process.argv.includes("--no-color") || process.env.NO_COLOR) {
  chalk.level = 0;
}

program.parse();
