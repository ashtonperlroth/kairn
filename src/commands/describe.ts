import { Command } from "commander";
import { input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../config.js";
import { generateClarifications, compile } from "../compiler/compile.js";
import { writeEnvironment, summarizeSpec } from "../adapter/claude-code.js";
import { writeHermesEnvironment } from "../adapter/hermes-agent.js";
import { loadRegistry } from "../registry/loader.js";
import { ui } from "../ui.js";
import { printFullBanner } from "../logo.js";
import { collectAndWriteKeys, writeEmptyEnvFile } from "../secrets.js";
import type { RuntimeTarget, Clarification } from "../types.js";

export const describeCommand = new Command("describe")
  .description("Describe your workflow and generate a Claude Code environment")
  .argument("[intent]", "What you want your agent to do")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("-q, --quick", "Skip clarification questions")
  .option("--runtime <runtime>", "Target runtime (claude-code or hermes)", "claude-code")
  .action(async (
    intentArg: string | undefined,
    options: { yes?: boolean; quick?: boolean; runtime?: string }
  ) => {
    // 1. Banner
    printFullBanner("The Agent Environment Compiler");

    // 2. Check config
    const config = await loadConfig();
    if (!config) {
      console.log(
        ui.errorBox(
          "No configuration found",
          `Run ${chalk.bold("kairn init")} to set up your API key.`
        )
      );
      process.exit(1);
    }

    // 3. Get intent
    const intentRaw =
      intentArg ||
      (await input({
        message: "What do you want your agent to do?",
      }));

    if (!intentRaw.trim()) {
      console.log(chalk.red("\n  No description provided. Aborting.\n"));
      process.exit(1);
    }

    // 4. Clarification flow
    let finalIntent = intentRaw;

    if (!options.quick) {
      console.log(ui.section("Clarification"));
      console.log(chalk.dim("  Let me understand your project better."));
      console.log(chalk.dim("  Press Enter to accept the suggestion, or type your own answer.\n"));

      let clarifications: Clarification[] = [];
      try {
        clarifications = await generateClarifications(intentRaw);
      } catch {
        // Non-fatal: proceed without clarifications
      }

      if (clarifications.length > 0) {
        const answers: Array<{ question: string; answer: string }> = [];

        for (const c of clarifications) {
          const answer = await input({
            message: c.question,
            default: c.suggestion,
          });
          answers.push({ question: c.question, answer });
        }

        const clarificationLines = answers
          .map((a) => `- ${a.question}: ${a.answer}`)
          .join("\n");

        finalIntent =
          `User intent: "${intentRaw}"\n\nClarifications:\n${clarificationLines}`;
      }
    }

    // 5. Compilation
    console.log(ui.section("Compilation"));

    const spinner = ora({ text: "Loading tool registry...", indent: 2 }).start();

    let spec;
    try {
      spec = await compile(finalIntent, (msg) => {
        spinner.text = msg;
      });
      spinner.succeed("Environment compiled");
    } catch (err) {
      spinner.fail("Compilation failed");
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\n  ${msg}\n`));
      process.exit(1);
    }

    // 6. Results display
    const registry = await loadRegistry();
    const summary = summarizeSpec(spec, registry);

    console.log("");
    console.log(ui.kv("Name:", spec.name));
    console.log(ui.kv("Description:", spec.description));
    console.log(ui.kv("Tools:", String(summary.toolCount)));
    console.log(ui.kv("Commands:", String(summary.commandCount)));
    console.log(ui.kv("Rules:", String(summary.ruleCount)));
    console.log(ui.kv("Skills:", String(summary.skillCount)));
    console.log(ui.kv("Agents:", String(summary.agentCount)));

    if (spec.tools.length > 0) {
      console.log(ui.section("Selected Tools"));
      console.log("");
      for (const tool of spec.tools) {
        const regTool = registry.find((t) => t.id === tool.tool_id);
        const name = regTool?.name || tool.tool_id;
        console.log(ui.tool(name, tool.reason));
        console.log("");
      }
    }

    // 7. Confirm
    const proceed =
      options.yes ||
      (await confirm({
        message: "Generate environment in current directory?",
        default: true,
      }));

    if (!proceed) {
      console.log(chalk.dim("\n  Aborted. Environment saved to ~/.kairn/envs/\n"));
      return;
    }

    // 8. Write
    const targetDir = process.cwd();
    const runtime = (options.runtime ?? "claude-code") as RuntimeTarget;

    if (runtime === "hermes") {
      await writeHermesEnvironment(spec, registry);
      console.log("\n" + ui.success("Environment written for Hermes"));
      console.log(
        chalk.cyan("\n  Ready! Run ") + chalk.bold("hermes") + chalk.cyan(" to start.\n")
      );
    } else {
      const hasEnvVars = summary.envSetup.length > 0;
      const written = await writeEnvironment(spec, targetDir, { hasEnvVars });

      console.log(ui.section("Files Written"));
      console.log("");
      for (const file of written) {
        console.log(ui.file(file));
      }

      // Interactive key collection or quick-mode placeholder .env
      if (hasEnvVars) {
        if (options.quick) {
          await writeEmptyEnvFile(summary.envSetup, targetDir);
          console.log(ui.success("Empty .env written (gitignored) — fill in keys later: kairn keys"));
        } else {
          await collectAndWriteKeys(summary.envSetup, targetDir);
        }
        console.log("");
      }

      if (summary.pluginCommands.length > 0) {
        console.log(ui.section("Plugins"));
        console.log("");
        for (const cmd of summary.pluginCommands) {
          console.log(ui.cmd(cmd));
        }
        console.log("");
      }

      console.log(ui.divider());
      console.log(ui.success("Ready! Run: $ claude"));
      console.log("");
    }
  });
