import { Command } from "commander";
import { input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import { loadConfig } from "../config.js";
import { compile } from "../compiler/compile.js";
import { writeEnvironment, summarizeSpec } from "../adapter/claude-code.js";
import { fileURLToPath } from "url";
import type { RegistryTool } from "../types.js";

async function loadRegistry(): Promise<RegistryTool[]> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const candidates = [
    path.resolve(__dirname, "../registry/tools.json"),
    path.resolve(__dirname, "../src/registry/tools.json"),
    path.resolve(__dirname, "../../src/registry/tools.json"),
  ];
  for (const candidate of candidates) {
    try {
      const data = await fs.readFile(candidate, "utf-8");
      return JSON.parse(data) as RegistryTool[];
    } catch {
      continue;
    }
  }
  throw new Error("Could not find tools.json registry");
}

export const describeCommand = new Command("describe")
  .description("Describe your workflow and generate a Claude Code environment")
  .argument("[intent]", "What you want your agent to do")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (intentArg: string | undefined, options: { yes?: boolean }) => {
    // 1. Check config
    const config = await loadConfig();
    if (!config) {
      console.log(
        chalk.red("\n  No config found. Run ") +
          chalk.bold("kairn init") +
          chalk.red(" first.\n")
      );
      process.exit(1);
    }

    // 2. Get intent
    const intent =
      intentArg ||
      (await input({
        message: "What do you want your agent to do?",
      }));

    if (!intent.trim()) {
      console.log(chalk.red("\n  No description provided. Aborting.\n"));
      process.exit(1);
    }

    // 3. Compile with progress
    console.log("");
    let spec;
    try {
      spec = await compile(intent, (msg) => {
        process.stdout.write(`\r  ${chalk.dim(msg)}                    `);
      });
      process.stdout.write("\r                                              \r");
    } catch (err) {
      process.stdout.write("\r                                              \r");
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\n  Compilation failed: ${msg}\n`));
      process.exit(1);
    }

    // 4. Show results
    const registry = await loadRegistry();
    const summary = summarizeSpec(spec, registry);

    console.log(chalk.green("\n  ✓ Environment compiled\n"));
    console.log(chalk.cyan("  Name: ") + spec.name);
    console.log(chalk.cyan("  Description: ") + spec.description);
    console.log(chalk.cyan("  Tools: ") + summary.toolCount);
    console.log(chalk.cyan("  Commands: ") + summary.commandCount);
    console.log(chalk.cyan("  Rules: ") + summary.ruleCount);
    console.log(chalk.cyan("  Skills: ") + summary.skillCount);
    console.log(chalk.cyan("  Agents: ") + summary.agentCount);

    if (spec.tools.length > 0) {
      console.log(chalk.dim("\n  Selected tools:"));
      for (const tool of spec.tools) {
        const regTool = registry.find((t) => t.id === tool.tool_id);
        const name = regTool?.name || tool.tool_id;
        console.log(chalk.dim(`    - ${name}: ${tool.reason}`));
      }
    }

    if (summary.pluginCommands.length > 0) {
      console.log(chalk.yellow("\n  Plugins to install manually:"));
      for (const cmd of summary.pluginCommands) {
        console.log(chalk.yellow(`    ${cmd}`));
      }
    }

    // 5. Confirm
    console.log("");
    const proceed = options.yes || await confirm({
      message: "Generate environment in current directory?",
      default: true,
    });

    if (!proceed) {
      console.log(chalk.dim("\n  Aborted. Environment saved to ~/.kairn/envs/\n"));
      return;
    }

    // 6. Write
    const targetDir = process.cwd();
    const written = await writeEnvironment(spec, targetDir);

    console.log(chalk.green("\n  ✓ Environment written\n"));
    for (const file of written) {
      console.log(chalk.dim(`    ${file}`));
    }

    if (summary.envSetup.length > 0) {
      console.log(chalk.yellow("\n  API keys needed (set these environment variables):\n"));
      const seen = new Set<string>();
      for (const env of summary.envSetup) {
        if (seen.has(env.envVar)) continue;
        seen.add(env.envVar);
        console.log(chalk.bold(`    export ${env.envVar}="your-key-here"`));
        console.log(chalk.dim(`      ${env.description}`));
        if (env.signupUrl) {
          console.log(chalk.dim(`      Get one at: ${env.signupUrl}`));
        }
        console.log("");
      }
    }

    if (summary.pluginCommands.length > 0) {
      console.log(chalk.yellow("  Install plugins by running these in Claude Code:"));
      for (const cmd of summary.pluginCommands) {
        console.log(chalk.bold(`    ${cmd}`));
      }
    }

    console.log(
      chalk.cyan("\n  Ready! Run ") +
        chalk.bold("claude") +
        chalk.cyan(" to start.\n")
    );
  });
