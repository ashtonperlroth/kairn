import { Command } from "commander";
import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { ui } from "../ui.js";
import { printCompactBanner } from "../logo.js";

const REGISTRY_URL =
  "https://raw.githubusercontent.com/ashtonperlroth/kairn/main/src/registry/tools.json";

async function getLocalRegistryPath(): Promise<string> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const candidates = [
    path.resolve(__dirname, "../registry/tools.json"),
    path.resolve(__dirname, "../src/registry/tools.json"),
    path.resolve(__dirname, "../../src/registry/tools.json"),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("Could not find local tools.json registry");
}

export const updateRegistryCommand = new Command("update-registry")
  .description("Fetch the latest tool registry from GitHub")
  .option("--url <url>", "Custom registry URL")
  .action(async (options: { url?: string }) => {
    printCompactBanner();

    const url = options.url || REGISTRY_URL;

    console.log(chalk.dim(`  Fetching registry from ${url}...`));

    try {
      const response = await fetch(url);

      if (!response.ok) {
        console.log(
          ui.error(`Failed to fetch registry: ${response.status} ${response.statusText}`)
        );
        console.log(chalk.dim("  The remote registry may not be available yet."));
        console.log(chalk.dim("  Your local registry is still active.\n"));
        return;
      }

      const text = await response.text();

      // Validate it's valid JSON and has the expected structure
      let tools: unknown[];
      try {
        tools = JSON.parse(text);
        if (!Array.isArray(tools)) throw new Error("Not an array");
        if (tools.length === 0) throw new Error("Empty registry");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(ui.error(`Invalid registry format: ${msg}\n`));
        return;
      }

      const registryPath = await getLocalRegistryPath();

      // Back up existing registry
      const backupPath = registryPath + ".bak";
      try {
        await fs.copyFile(registryPath, backupPath);
      } catch {
        // No existing file to back up
      }

      await fs.writeFile(registryPath, JSON.stringify(tools, null, 2), "utf-8");

      console.log(ui.success(`Registry updated: ${tools.length} tools`));
      console.log(chalk.dim(`  Saved to: ${registryPath}`));
      console.log(chalk.dim(`  Backup: ${backupPath}\n`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(ui.error(`Network error: ${msg}`));
      console.log(chalk.dim("  Your local registry is still active.\n"));
    }
  });
