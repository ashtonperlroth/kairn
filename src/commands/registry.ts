import { Command } from "commander";
import chalk from "chalk";
import { input, select } from "@inquirer/prompts";
import { loadRegistry, loadUserRegistry, saveUserRegistry } from "../registry/loader.js";
import type { RegistryTool } from "../types.js";
import { ui } from "../ui.js";
import { printCompactBanner } from "../logo.js";

const listCommand = new Command("list")
  .description("List tools in the registry")
  .option("--category <cat>", "Filter by category")
  .option("--user-only", "Show only user-defined tools")
  .action(async (options: { category?: string; userOnly?: boolean }) => {
    printCompactBanner();

    let all: RegistryTool[];
    let userTools: RegistryTool[];

    try {
      [all, userTools] = await Promise.all([loadRegistry(), loadUserRegistry()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(ui.error(`Failed to load registry: ${msg}\n`));
      process.exit(1);
    }

    const userIds = new Set(userTools.map((t) => t.id));

    let tools = all;

    if (options.userOnly) {
      tools = tools.filter((t) => userIds.has(t.id));
    }

    if (options.category) {
      tools = tools.filter(
        (t) => t.category.toLowerCase() === options.category!.toLowerCase()
      );
    }

    if (tools.length === 0) {
      console.log(chalk.dim("\n  No tools found.\n"));
      return;
    }

    const bundledCount = all.filter((t) => !userIds.has(t.id)).length;
    const userCount = userIds.size;

    console.log(ui.section("Registry Tools"));
    console.log("");

    for (const tool of tools) {
      const isUser = userIds.has(tool.id);
      const meta = [
        tool.category,
        `tier ${tool.tier}`,
        tool.auth,
      ].join(", ");

      console.log(`  ${ui.accent(tool.id)}` + chalk.dim(` (${meta})`));
      console.log(chalk.dim(`    ${tool.description}`));

      if (tool.best_for.length > 0) {
        console.log(chalk.dim(`    Best for: ${tool.best_for.join(", ")}`));
      }

      if (isUser) {
        console.log(chalk.yellow("    [USER-DEFINED]"));
      }

      console.log("");
    }

    const totalShown = tools.length;
    const shownUser = tools.filter((t) => userIds.has(t.id)).length;
    const shownBundled = totalShown - shownUser;

    console.log(
      chalk.dim(
        `  ${totalShown} tool${totalShown !== 1 ? "s" : ""} (${shownBundled} bundled, ${shownUser} user-defined)`
      ) + "\n"
    );
  });

const addCommand = new Command("add")
  .description("Add a tool to the user registry")
  .action(async () => {
    let id: string;
    try {
      id = await input({
        message: "Tool ID (kebab-case)",
        validate: (v) => {
          if (!v) return "ID is required";
          if (!/^[a-z][a-z0-9-]*$/.test(v)) return "ID must be kebab-case (e.g. my-tool)";
          return true;
        },
      });

      const name = await input({ message: "Display name" });
      const description = await input({ message: "Description" });

      const category = await select({
        message: "Category",
        choices: [
          { value: "universal" },
          { value: "code" },
          { value: "search" },
          { value: "data" },
          { value: "communication" },
          { value: "design" },
          { value: "monitoring" },
          { value: "infrastructure" },
          { value: "sandbox" },
        ],
      });

      const tier = await select<number>({
        message: "Tier",
        choices: [
          { name: "1 — Universal", value: 1 },
          { name: "2 — Common", value: 2 },
          { name: "3 — Specialized", value: 3 },
        ],
      });

      const type = await select<"mcp_server" | "plugin" | "hook">({
        message: "Type",
        choices: [
          { value: "mcp_server" },
          { value: "plugin" },
          { value: "hook" },
        ],
      });

      const auth = await select<"none" | "api_key" | "oauth" | "connection_string">({
        message: "Auth",
        choices: [
          { value: "none" },
          { value: "api_key" },
          { value: "oauth" },
          { value: "connection_string" },
        ],
      });

      const env_vars: { name: string; description: string }[] = [];
      if (auth === "api_key" || auth === "connection_string") {
        let addMore = true;
        while (addMore) {
          const varName = await input({ message: "Env var name" });
          const varDesc = await input({ message: "Env var description" });
          env_vars.push({ name: varName, description: varDesc });
          const another = await select<boolean>({
            message: "Add another env var?",
            choices: [
              { name: "No", value: false },
              { name: "Yes", value: true },
            ],
          });
          addMore = another;
        }
      }

      const signup_url_raw = await input({ message: "Signup URL (optional, press enter to skip)" });
      const signup_url = signup_url_raw.trim() || undefined;

      const best_for_raw = await input({ message: "Best-for tags, comma-separated" });
      const best_for = best_for_raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const install: RegistryTool["install"] = {};
      if (type === "mcp_server") {
        const command = await input({ message: "MCP command" });
        const args_raw = await input({ message: "MCP args, comma-separated (leave blank for none)" });
        const args = args_raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        install.mcp_config = { command, args };
      }

      const tool: RegistryTool = {
        id,
        name,
        description,
        category,
        tier,
        type,
        auth,
        best_for,
        install,
        ...(env_vars.length > 0 ? { env_vars } : {}),
        ...(signup_url ? { signup_url } : {}),
      };

      let userToolsList: RegistryTool[];
      try {
        userToolsList = await loadUserRegistry();
      } catch {
        userToolsList = [];
      }

      const existingIdx = userToolsList.findIndex((t) => t.id === id);
      if (existingIdx >= 0) {
        userToolsList[existingIdx] = tool;
      } else {
        userToolsList.push(tool);
      }

      await saveUserRegistry(userToolsList);

      console.log(ui.success(`Tool ${id} added to user registry\n`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(ui.error(`Failed to add tool: ${msg}\n`));
      process.exit(1);
    }
  });

export const registryCommand = new Command("registry")
  .description("Manage the tool registry")
  .addCommand(listCommand)
  .addCommand(addCommand);
