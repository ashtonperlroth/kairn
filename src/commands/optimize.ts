import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import fs from "fs/promises";
import path from "path";
import { loadConfig } from "../config.js";
import { compile } from "../compiler/compile.js";
import {
  writeEnvironment,
  summarizeSpec,
  buildFileMap,
} from "../adapter/claude-code.js";
import { writeHermesEnvironment } from "../adapter/hermes-agent.js";
import { loadRegistry } from "../registry/loader.js";
import type { RuntimeTarget } from "../types.js";
import { scanProject } from "../scanner/scan.js";
import type { ProjectProfile } from "../scanner/scan.js";
import type { EnvironmentSpec } from "../types.js";
import { ui } from "../ui.js";
import { printCompactBanner } from "../logo.js";

interface FileDiff {
  path: string;
  status: "new" | "modified" | "unchanged";
  diff: string;
}

function simpleDiff(oldContent: string, newContent: string): string[] {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const output: string[] = [];

  const maxLines = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined) {
      output.push(chalk.green(`+ ${newLine}`));
    } else if (newLine === undefined) {
      output.push(chalk.red(`- ${oldLine}`));
    } else if (oldLine !== newLine) {
      output.push(chalk.red(`- ${oldLine}`));
      output.push(chalk.green(`+ ${newLine}`));
    }
  }

  return output;
}

async function generateDiff(
  spec: EnvironmentSpec,
  targetDir: string
): Promise<FileDiff[]> {
  const fileMap = buildFileMap(spec);
  const results: FileDiff[] = [];

  for (const [relativePath, newContent] of fileMap) {
    const absolutePath = path.join(targetDir, relativePath);
    let oldContent: string | null = null;
    try {
      oldContent = await fs.readFile(absolutePath, "utf-8");
    } catch {
      // File does not exist yet
    }

    if (oldContent === null) {
      results.push({
        path: relativePath,
        status: "new",
        diff: chalk.green("+ NEW FILE"),
      });
    } else if (oldContent === newContent) {
      results.push({
        path: relativePath,
        status: "unchanged",
        diff: "",
      });
    } else {
      const diffLines = simpleDiff(oldContent, newContent);
      results.push({
        path: relativePath,
        status: "modified",
        diff: diffLines.join("\n"),
      });
    }
  }

  return results;
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
    parts.push("- Are hooks configured in settings.json for destructive command blocking?");
    parts.push("- Are there path-scoped rules for different code domains (api, testing, frontend)?");
    parts.push("- Does the project have a /project:status command with live git output?");
    parts.push("- Is there a /project:fix command for issue-driven development?");
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
  .option("--diff", "Preview changes as a diff without writing")
  .option("--runtime <runtime>", "Target runtime (claude-code or hermes)", "claude-code")
  .action(async (options: { yes?: boolean; auditOnly?: boolean; diff?: boolean; runtime?: string }) => {
    printCompactBanner();

    const config = await loadConfig();
    if (!config) {
      console.log(ui.errorBox("KAIRN — Error", "No config found. Run kairn init first."));
      process.exit(1);
    }

    const targetDir = process.cwd();

    // 1. Scan
    console.log(ui.section("Project Scan"));
    const scanSpinner = ora({ text: "Scanning project...", indent: 2 }).start();
    const profile = await scanProject(targetDir);
    scanSpinner.stop();

    // 2. Show profile
    if (profile.language) console.log(ui.kv("Language:", profile.language));
    if (profile.framework) console.log(ui.kv("Framework:", profile.framework));
    console.log(ui.kv("Dependencies:", String(profile.dependencies.length)));
    if (profile.testCommand) console.log(ui.kv("Tests:", profile.testCommand));
    if (profile.buildCommand) console.log(ui.kv("Build:", profile.buildCommand));
    if (profile.hasDocker) console.log(ui.kv("Docker:", "yes"));
    if (profile.hasCi) console.log(ui.kv("CI/CD:", "yes"));
    if (profile.envKeys.length > 0) console.log(ui.kv("Env keys:", profile.envKeys.join(", ")));

    // 3. Audit existing harness
    if (profile.hasClaudeDir) {
      console.log(ui.section("Harness Audit"));
      console.log(ui.kv("CLAUDE.md:", `${profile.claudeMdLineCount} lines${profile.claudeMdLineCount > 200 ? " ⚠ bloated" : " ✓"}`));
      console.log(ui.kv("MCP servers:", String(profile.mcpServerCount)));
      console.log(ui.kv("Commands:", profile.existingCommands.length > 0 ? profile.existingCommands.join(", ") : "none"));
      console.log(ui.kv("Rules:", profile.existingRules.length > 0 ? profile.existingRules.join(", ") : "none"));
      console.log(ui.kv("Skills:", profile.existingSkills.length > 0 ? profile.existingSkills.join(", ") : "none"));
      console.log(ui.kv("Agents:", profile.existingAgents.length > 0 ? profile.existingAgents.join(", ") : "none"));

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
      if (!profile.existingSettings?.hooks) issues.push("No hooks configured — missing destructive command blocking");
      const scopedRules = profile.existingRules.filter(r => r !== "security" && r !== "continuity");
      if (profile.hasSrc && scopedRules.length === 0) issues.push("No path-scoped rules — consider adding api.md, testing.md, or frontend.md rules");

      if (issues.length > 0) {
        console.log("");
        for (const issue of issues) {
          console.log(ui.warn(issue));
        }
      } else {
        console.log(ui.success("No obvious issues found"));
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
    const spinner = ora({ text: "Compiling optimized environment...", indent: 2 }).start();
    try {
      spec = await compile(intent, (msg) => {
        spinner.text = msg;
      });
      spinner.succeed("Environment compiled");
    } catch (err) {
      spinner.fail("Compilation failed");
      const msg = err instanceof Error ? err.message : String(err);
      console.log(ui.errorBox("KAIRN — Error", `Optimization failed: ${msg}`));
      process.exit(1);
    }

    // 5. Show results
    const registry = await loadRegistry();
    const summary = summarizeSpec(spec, registry);

    console.log("");
    console.log(ui.kv("Name:", spec.name));
    console.log(ui.kv("Tools:", String(summary.toolCount)));
    console.log(ui.kv("Commands:", String(summary.commandCount)));
    console.log(ui.kv("Rules:", String(summary.ruleCount)));
    console.log(ui.kv("Skills:", String(summary.skillCount)));
    console.log(ui.kv("Agents:", String(summary.agentCount)));

    if (spec.tools.length > 0) {
      console.log(ui.section("Selected Tools"));
      for (const tool of spec.tools) {
        const regTool = registry.find((t) => t.id === tool.tool_id);
        const name = regTool?.name || tool.tool_id;
        console.log(ui.tool(name, tool.reason));
      }
    }

    // 6. Diff preview or direct write
    if (options.diff) {
      const diffs = await generateDiff(spec, targetDir);
      const changedDiffs = diffs.filter((d) => d.status !== "unchanged");

      if (changedDiffs.length === 0) {
        console.log(ui.success("No changes needed — environment is already up to date."));
        console.log("");
        return;
      }

      console.log(ui.section("Changes Preview"));
      for (const d of changedDiffs) {
        console.log(chalk.cyan(`\n  --- ${d.path}`));
        if (d.status === "new") {
          console.log(`    ${d.diff}`);
        } else {
          for (const line of d.diff.split("\n")) {
            console.log(`    ${line}`);
          }
        }
      }
      console.log("");

      const apply = await confirm({
        message: "Apply these changes?",
        default: true,
      });
      if (!apply) {
        console.log(chalk.dim("\n  Aborted.\n"));
        return;
      }
    }

    const runtime = (options.runtime ?? "claude-code") as RuntimeTarget;

    if (runtime === "hermes") {
      await writeHermesEnvironment(spec, registry);
      console.log(ui.divider());
      console.log(ui.success(`Ready! Run: $ hermes`));
      console.log("");
    } else {
      const written = await writeEnvironment(spec, targetDir);

      console.log(ui.section("Files Written"));
      for (const file of written) {
        console.log(ui.file(file));
      }

      if (summary.envSetup.length > 0) {
        console.log(ui.section("Setup Required"));
        const seen = new Set<string>();
        for (const env of summary.envSetup) {
          if (seen.has(env.envVar)) continue;
          seen.add(env.envVar);
          console.log(ui.envVar(env.envVar, env.description, env.signupUrl));
          console.log("");
        }
      }

      if (summary.pluginCommands.length > 0) {
        console.log(ui.section("Plugins"));
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
