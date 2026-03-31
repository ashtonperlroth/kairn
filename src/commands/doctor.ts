import { Command } from "commander";
import chalk from "chalk";
import { scanProject } from "../scanner/scan.js";
import type { ProjectProfile } from "../scanner/scan.js";
import { ui } from "../ui.js";
import { printFullBanner } from "../logo.js";

interface Check {
  name: string;
  weight: number; // 1-3
  status: "pass" | "warn" | "fail";
  message: string;
}

function runChecks(profile: ProjectProfile): Check[] {
  const checks: Check[] = [];

  // CLAUDE.md existence and size
  if (!profile.existingClaudeMd) {
    checks.push({
      name: "CLAUDE.md",
      weight: 3,
      status: "fail",
      message: "Missing CLAUDE.md",
    });
  } else if (profile.claudeMdLineCount > 200) {
    checks.push({
      name: "CLAUDE.md",
      weight: 2,
      status: "warn",
      message: `${profile.claudeMdLineCount} lines (recommended: ≤100)`,
    });
  } else {
    checks.push({
      name: "CLAUDE.md",
      weight: 3,
      status: "pass",
      message: `${profile.claudeMdLineCount} lines`,
    });
  }

  // Settings.json with deny rules
  if (!profile.existingSettings) {
    checks.push({
      name: "settings.json",
      weight: 2,
      status: "fail",
      message: "Missing settings.json",
    });
  } else {
    const perms = profile.existingSettings.permissions as
      | Record<string, unknown>
      | undefined;
    const hasDeny =
      perms?.deny &&
      Array.isArray(perms.deny) &&
      (perms.deny as string[]).length > 0;
    checks.push({
      name: "Deny rules",
      weight: 2,
      status: hasDeny ? "pass" : "warn",
      message: hasDeny
        ? "Deny rules configured"
        : "No deny rules in settings.json",
    });
  }

  // MCP server count
  if (profile.mcpServerCount > 8) {
    checks.push({
      name: "MCP servers",
      weight: 1,
      status: "warn",
      message: `${profile.mcpServerCount} servers (recommended: ≤8)`,
    });
  } else if (profile.mcpServerCount > 0) {
    checks.push({
      name: "MCP servers",
      weight: 1,
      status: "pass",
      message: `${profile.mcpServerCount} servers`,
    });
  } else {
    checks.push({
      name: "MCP servers",
      weight: 1,
      status: "warn",
      message: "No MCP servers configured",
    });
  }

  // /project:help command
  checks.push({
    name: "/project:help",
    weight: 2,
    status: profile.existingCommands.includes("help") ? "pass" : "fail",
    message: profile.existingCommands.includes("help")
      ? "Help command present"
      : "Missing /project:help command",
  });

  // /project:tasks command
  checks.push({
    name: "/project:tasks",
    weight: 1,
    status: profile.existingCommands.includes("tasks") ? "pass" : "warn",
    message: profile.existingCommands.includes("tasks")
      ? "Tasks command present"
      : "Missing /project:tasks command",
  });

  // Security rule
  checks.push({
    name: "Security rule",
    weight: 3,
    status: profile.existingRules.includes("security") ? "pass" : "fail",
    message: profile.existingRules.includes("security")
      ? "Security rule present"
      : "Missing rules/security.md",
  });

  // Continuity rule
  checks.push({
    name: "Continuity rule",
    weight: 2,
    status: profile.existingRules.includes("continuity") ? "pass" : "warn",
    message: profile.existingRules.includes("continuity")
      ? "Continuity rule present"
      : "Missing rules/continuity.md",
  });

  // Hooks
  const hasHooks = profile.existingSettings?.hooks;
  checks.push({
    name: "Hooks",
    weight: 1,
    status: hasHooks ? "pass" : "warn",
    message: hasHooks ? "Hooks configured" : "No hooks in settings.json",
  });

  // .env protection
  const perms = profile.existingSettings?.permissions as
    | Record<string, unknown>
    | undefined;
  const denyList = (perms?.deny as string[] | undefined) || [];
  const envProtected = denyList.some((d: string) => d.includes(".env"));
  checks.push({
    name: ".env protection",
    weight: 2,
    status: envProtected ? "pass" : "warn",
    message: envProtected ? ".env in deny list" : ".env not in deny list",
  });

  // CLAUDE.md sections check (if exists)
  if (profile.existingClaudeMd) {
    const requiredSections = ["## Purpose", "## Commands", "## Tech Stack"];
    const missingSections = requiredSections.filter(
      (s) => !profile.existingClaudeMd!.includes(s)
    );
    if (missingSections.length > 0) {
      checks.push({
        name: "CLAUDE.md sections",
        weight: 1,
        status: "warn",
        message: `Missing: ${missingSections.join(", ")}`,
      });
    } else {
      checks.push({
        name: "CLAUDE.md sections",
        weight: 1,
        status: "pass",
        message: "Required sections present",
      });
    }
  }

  return checks;
}

export const doctorCommand = new Command("doctor")
  .description(
    "Validate the current Claude Code environment against best practices"
  )
  .action(async () => {
    printFullBanner("Doctor");

    const targetDir = process.cwd();

    console.log(chalk.dim("  Checking .claude/ environment...\n"));

    const profile = await scanProject(targetDir);

    if (!profile.hasClaudeDir) {
      console.log(ui.error("No .claude/ directory found.\n"));
      console.log(
        chalk.dim("  Run ") +
          chalk.bold("kairn describe") +
          chalk.dim(" or ") +
          chalk.bold("kairn optimize") +
          chalk.dim(" to generate one.\n")
      );
      process.exit(1);
    }

    const checks = runChecks(profile);

    console.log(ui.section("Health Check"));
    console.log("");

    // Display results
    for (const check of checks) {
      if (check.status === "pass") {
        console.log(ui.success(`${check.name}: ${check.message}`));
      } else if (check.status === "warn") {
        console.log(ui.warn(`${check.name}: ${check.message}`));
      } else {
        console.log(ui.error(`${check.name}: ${check.message}`));
      }
    }

    // Calculate score
    const maxScore = checks.reduce((sum, c) => sum + c.weight, 0);
    const score = checks.reduce((sum, c) => {
      if (c.status === "pass") return sum + c.weight;
      if (c.status === "warn") return sum + Math.floor(c.weight / 2);
      return sum;
    }, 0);

    const percentage = Math.round((score / maxScore) * 100);
    const scoreColor =
      percentage >= 80
        ? chalk.green
        : percentage >= 50
          ? chalk.yellow
          : chalk.red;

    console.log(
      `\n  Score: ${scoreColor(`${score}/${maxScore}`)} (${scoreColor(`${percentage}%`)})\n`
    );

    if (percentage < 80) {
      console.log(
        chalk.dim("  Run ") +
          chalk.bold("kairn optimize") +
          chalk.dim(" to fix issues.\n")
      );
    }
  });
