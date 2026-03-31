import { Command } from "commander";
import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import { getEnvsDir, getTemplatesDir } from "../config.js";
import { writeEnvironment } from "../adapter/claude-code.js";
import type { EnvironmentSpec } from "../types.js";
import { ui } from "../ui.js";
import { printCompactBanner } from "../logo.js";

export const activateCommand = new Command("activate")
  .description("Re-deploy a saved environment to the current directory")
  .argument("<env_id>", "Environment ID (from kairn list)")
  .action(async (envId: string) => {
    printCompactBanner();

    const envsDir = getEnvsDir();
    const templatesDir = getTemplatesDir();

    // Find the env file — accept full ID or partial match
    let sourceDir: string;
    let match: string | undefined;
    let fromTemplate = false;

    // 1. Search envs dir
    let envFiles: string[] = [];
    try {
      envFiles = await fs.readdir(envsDir);
    } catch {
      // envs dir may not exist yet; continue to templates search
    }

    match = envFiles.find(
      (f) => f === `${envId}.json` || f.startsWith(envId)
    );

    if (match) {
      sourceDir = envsDir;
    } else {
      // 2. Fall back to templates dir
      let templateFiles: string[] = [];
      try {
        templateFiles = await fs.readdir(templatesDir);
      } catch {
        // templates dir may not exist
      }

      match = templateFiles.find(
        (f) => f === `${envId}.json` || f.startsWith(envId)
      );

      if (match) {
        sourceDir = templatesDir;
        fromTemplate = true;
      } else {
        console.log(ui.error(`Environment "${envId}" not found.`));
        console.log(chalk.dim("  Run kairn list to see saved environments."));
        console.log(chalk.dim("  Run kairn templates to see available templates.\n"));
        process.exit(1);
      }
    }

    const data = await fs.readFile(path.join(sourceDir, match), "utf-8");
    const spec = JSON.parse(data) as EnvironmentSpec;

    const label = fromTemplate ? chalk.dim(" (template)") : "";
    console.log(chalk.cyan(`  Activating: ${spec.name}`) + label);
    console.log(chalk.dim(`  ${spec.description}\n`));

    const targetDir = process.cwd();
    const written = await writeEnvironment(spec, targetDir);

    console.log(ui.success("Environment written\n"));
    for (const file of written) {
      console.log(ui.file(file));
    }

    console.log("\n" + ui.success(`Ready! Run: $ claude`) + "\n");
  });
