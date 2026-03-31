import { Command } from "commander";
import { input, confirm, checkbox } from "@inquirer/prompts";
import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "../config.js";
import { compile } from "../compiler/compile.js";
import { writeEnvironment, summarizeSpec } from "../adapter/claude-code.js";
import { scanProject } from "../scanner/scan.js";
import type { ProjectProfile } from "../scanner/scan.js";
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

function buildProfileSummary(profile: ProjectProfile): string {
  const lines: string[] = [];
  lines.push(`Project: ${profile.name}`);
  if (profile.description) lines.push(`Description: ${profile.description}`);
  if (profile.language) lines.push(`Language: ${profile.language}`);
  if (profile.framework) lines.push(`Framework: ${profile.framework}`);
  if (profile.dependencies.length > 0) {
    lines.push(`Dependencies: ${profile.dependencies.join(", ")}`);
  }
  if (profile.testCommand) lines.push(`Test command: ${profile.testCommand}`);
  if (profile.buildCommand) lines.push(`Build command: ${profile.buildCommand}`);
  if (profile.lintCommand) lines.push(`Lint command: ${profile.lintCommand}`);
  if (profile.hasDocker) lines.push("Has Docker configuration");
  if (profile.hasCi) lines.push("Has CI/CD (GitHub Actions)");
  if (profile.envKeys.length > 0) {
    lines.push(`Env keys needed: ${profile.envKeys.join(", ")}`);
  }
  return lines.join("\n");
}

function buildAuditSummary(profile: ProjectProfile): string {
  const lines: string[] = [];
  lines.push(`\nExisting .claude/ harness found:`);
  lines.push(`  CLAUDE.md: ${profile.claudeMdLineCount} lines${profile.claudeMdLineCount > 200 ? " (⚠ over 200 — may degrade adherence)" : ""}`);
  lines.push(`  MCP servers: ${profile.mcpServerCount}`);
  lines.push(`  Commands: ${profile.existingCommands.length > 0 ? profile.existingCommands.map(c => `/project:${c}`).join(", ") : "none"}`);
  lines.push(`  Rules: ${profile.existingRules.length > 0 ? profile.existingRules.join(", ") : "none"}`);
  lines.push(`  Skills: ${profile.existingSkills.length > 0 ? profile.existingSkills.join(", ") : "none"}`);
  lines.push(`  Agents: ${profile.existingAgents.length > 0 ? profile.existingAgents.join(", ") : "none"}`);
  return lines.join("\n");
}

function buildOptimizeIntent(profile: ProjectProfile): string {
  const parts: string[] = [];

  parts.push("## Project Profile (scanned from actual codebase)\n");
  parts.push(buildProfileSummary(profile));

  if (profile.hasClaudeDir) {
    parts.push(buildAuditSummary(profile));

    if (profile.existingClaudeMd) {
      parts.push(`\n## Existing CLAUDE.md Content\n\n${profile.existingClaudeMd}`);
    }

    parts.push(`\n## Task\n`);
    parts.push("Analyze this existing Claude Code environment and generate an OPTIMIZED version.");
    parts.push("Preserve what works. Fix what's wrong. Add what's missing. Remove what's bloat.");
    parts.push("Key optimizations to consider:");
    parts.push("- Is CLAUDE.md under 100 lines? If not, move detail to rules/ or docs/");
    parts.push("- Are the right MCP servers selected for these dependencies?");
    parts.push("- Are there missing slash commands (help, tasks, plan, test, commit)?");
    parts.push("- Are security rules present?");
    parts.push("- Is there a continuity rule for session memory?");
    parts.push("- Are there unnecessary MCP servers adding context bloat?");
    if (profile.claudeMdLineCount > 200) {
      parts.push(`- CLAUDE.md is ${profile.claudeMdLineCount} lines — needs aggressive trimming`);
    }
    if (!profile.existingCommands.includes("help")) {
      parts.push("- Missing /project:help command");
    }
    if (!profile.existingRules.includes("security")) {
      parts.push("- Missing security rules");
    }
  } else {
    parts.push(`\n## Task\n`);
    parts.push("Generate an optimal Claude Code environment for this existing project.");
    parts.push("Use the scanned project profile — this is a real codebase, not a description.");
    parts.push("The environment should match the actual tech stack, dependencies, and workflows.");
  }

  return parts.join("\n");
}

export const optimizeCommand = new Command("optimize")
  .description("Scan an existing project and generate or optimize its Claude Code environment")
  .option("-y, --yes", "Skip confirmation prompts")
  .option("--audit-only", "Only audit the existing harness, don't generate changes")
  .action(async (options: { yes?: boolean; auditOnly?: boolean }) => {
    const config = await loadConfig();
    if (!config) {
      console.log(
        chalk.red("\n  No config found. Run ") +
          chalk.bold("kairn init") +
          chalk.red(" first.\n")
      );
      process.exit(1);
    }

    const targetDir = process.cwd();

    // 1. Scan
    console.log(chalk.dim("\n  Scanning project..."));
    const profile = await scanProject(targetDir);

    // 2. Show profile
    console.log(chalk.cyan("\n  Project Profile\n"));
    if (profile.language) console.log(chalk.dim(`  Language:   ${profile.language}`));
    if (profile.framework) console.log(chalk.dim(`  Framework:  ${profile.framework}`));
    console.log(chalk.dim(`  Dependencies: ${profile.dependencies.length}`));
    if (profile.testCommand) console.log(chalk.dim(`  Tests:      ${profile.testCommand}`));
    if (profile.buildCommand) console.log(chalk.dim(`  Build:      ${profile.buildCommand}`));
    if (profile.hasDocker) console.log(chalk.dim("  Docker:     yes"));
    if (profile.hasCi) console.log(chalk.dim("  CI/CD:      yes"));
    if (profile.envKeys.length > 0) console.log(chalk.dim(`  Env keys:   ${profile.envKeys.join(", ")}`));

    // 3. Audit existing harness
    if (profile.hasClaudeDir) {
      console.log(chalk.yellow("\n  Existing .claude/ harness detected\n"));
      console.log(chalk.dim(`  CLAUDE.md:  ${profile.claudeMdLineCount} lines${profile.claudeMdLineCount > 200 ? chalk.yellow(" ⚠ bloated") : chalk.green(" ✓")}`));
      console.log(chalk.dim(`  MCP servers: ${profile.mcpServerCount}`));
      console.log(chalk.dim(`  Commands:   ${profile.existingCommands.length > 0 ? profile.existingCommands.map(c => c).join(", ") : "none"}`));
      console.log(chalk.dim(`  Rules:      ${profile.existingRules.length > 0 ? profile.existingRules.join(", ") : "none"}`));
      console.log(chalk.dim(`  Skills:     ${profile.existingSkills.length > 0 ? profile.existingSkills.join(", ") : "none"}`));
      console.log(chalk.dim(`  Agents:     ${profile.existingAgents.length > 0 ? profile.existingAgents.join(", ") : "none"}`));

      // Quick audit checks
      const issues: string[] = [];
      if (profile.claudeMdLineCount > 200) issues.push("CLAUDE.md over 200 lines — move detail to rules/ or docs/");
      if (!profile.existingCommands.includes("help")) issues.push("Missing /project:help command");
      if (!profile.existingRules.includes("security")) issues.push("Missing security rules");
      if (!profile.existingRules.includes("continuity")) issues.push("Missing continuity rule for session memory");
      if (profile.mcpServerCount > 8) issues.push(`${profile.mcpServerCount} MCP servers — may cause context bloat`);
      if (profile.mcpServerCount === 0 && profile.dependencies.length > 0) issues.push("No MCP servers configured");
      if (profile.hasTests && !profile.existingCommands.includes("test")) issues.push("Has tests but no /project:test command");
      if (!profile.existingCommands.includes("tasks")) issues.push("Missing /project:tasks command");

      if (issues.length > 0) {
        console.log(chalk.yellow("\n  Issues Found:\n"));
        for (const issue of issues) {
          console.log(chalk.yellow(`    ⚠ ${issue}`));
        }
      } else {
        console.log(chalk.green("\n  ✓ No obvious issues found"));
      }

      if (options.auditOnly) {
        console.log(chalk.dim("\n  Audit complete. Run without --audit-only to generate optimized environment.\n"));
        return;
      }

      // Ask before overwriting
      if (!options.yes) {
        console.log("");
        const proceed = await confirm({
          message: "Generate optimized environment? This will overwrite existing .claude/ files.",
          default: false,
        });
        if (!proceed) {
          console.log(chalk.dim("\n  Aborted.\n"));
          return;
        }
      }
    } else {
      console.log(chalk.dim("\n  No existing .claude/ directory found — generating from scratch.\n"));

      if (!options.yes) {
        const proceed = await confirm({
          message: "Generate Claude Code environment for this project?",
          default: true,
        });
        if (!proceed) {
          console.log(chalk.dim("\n  Aborted.\n"));
          return;
        }
      }
    }

    // 4. Compile with scanned profile
    const intent = buildOptimizeIntent(profile);
    let spec;
    try {
      spec = await compile(intent, (msg) => {
        process.stdout.write(`\r  ${chalk.dim(msg)}                    `);
      });
      process.stdout.write("\r                                              \r");
    } catch (err) {
      process.stdout.write("\r                                              \r");
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\n  Optimization failed: ${msg}\n`));
      process.exit(1);
    }

    // 5. Show results
    const registry = await loadRegistry();
    const summary = summarizeSpec(spec, registry);

    console.log(chalk.green("  ✓ Environment compiled\n"));
    console.log(chalk.cyan("  Name: ") + spec.name);
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

    // 6. Write
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
