/**
 * Claude Code IR Renderer — produces a `.claude/` directory structure from a HarnessIR.
 *
 * This is the inverse of the parser: given a HarnessIR, it emits the file
 * contents that `parseHarness` would read back into the same IR.
 *
 * All file I/O uses `fs.promises`. Directories are created on demand.
 */

import {
  createRenderedHarness,
  renderedHarnessContentMap,
  writeRenderedHarness,
  type RenderedHarness,
  type RenderedHarnessEntry,
} from "../rendered-harness.js";
import type {
  HarnessIR,
  HarnessMeta,
  Section,
  SettingsIR,
  McpServerNode,
  RuleNode,
  AgentNode,
} from "../ir/types.js";

// ---------------------------------------------------------------------------
// renderClaudeMd
// ---------------------------------------------------------------------------

/**
 * Render the CLAUDE.md file content from metadata and sections.
 *
 * Sections are sorted by `order`. Each section is output as
 * `{heading}\n\n{content}` — the heading already includes its `## ` prefix
 * (or `# ` for the preamble). Sections are joined with double newlines.
 *
 * If `commands` are provided, an "Available Commands" section is appended
 * listing each command with its description. This replaces the old intent
 * routing infrastructure (removed in v2.12).
 *
 * If `envVars` are provided, an "Environment Variables" section is appended
 * documenting the expected env vars. This replaces the old SessionStart
 * .env injection hook with honest documentation (v2.12).
 *
 * @param _meta - Harness metadata (name used only if no preamble section provides a title)
 * @param sections - The ordered sections to render
 * @param commands - Optional array of command name/description pairs to list
 * @param envVars - Optional array of environment variable name/description pairs
 * @returns The full CLAUDE.md content string with trailing newline
 */
export function renderClaudeMd(
  _meta: HarnessMeta,
  sections: Section[],
  commands?: Array<{ name: string; description: string }>,
  envVars?: Array<{ name: string; description: string }>,
): string {
  // Only render sections targeted at CLAUDE.md (or untagged for backward compat)
  const inlineSections = sections.filter(s => s.target !== 'docs');
  const sorted = [...inlineSections].sort((a, b) => a.order - b.order);

  const blocks: string[] = [];

  for (const section of sorted) {
    if (section.heading && section.content) {
      blocks.push(`${section.heading}\n\n${section.content}`);
    } else if (section.heading) {
      blocks.push(section.heading);
    } else if (section.content) {
      blocks.push(section.content);
    }
    // Skip sections with neither heading nor content
  }

  // Add "Available Commands" section if commands are provided
  if (commands && commands.length > 0) {
    const cmdLines = commands
      .map((c) => `- \`/project:${c.name}\` — ${c.description}`)
      .join('\n');
    blocks.push(
      `## Available Commands\n\nWhen the user explicitly asks to run a workflow, use the appropriate command:\n${cmdLines}\n\nOnly route when the user's clear intent is to execute a workflow.\nNever route questions, discussions, or code reviews.`
    );
  }

  // Add "Environment Variables" section if env vars are provided
  if (envVars && envVars.length > 0) {
    const varLines = envVars
      .map((v) => `- \`${v.name}\` — ${v.description}`)
      .join('\n');
    blocks.push(
      `## Environment Variables\n\nThis project uses environment variables. Expected:\n${varLines}\n\nSet these in your shell before starting Claude.`
    );
  }

  if (blocks.length === 0) {
    return "\n";
  }

  return blocks.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// renderSettings
// ---------------------------------------------------------------------------

/**
 * Render a `settings.json` string from a SettingsIR.
 *
 * Reconstructs the JSON structure that `parseSettings` would parse:
 * - `raw` fields are spread as the base
 * - `denyPatterns` → `permissions.deny`
 * - `statusLine` → `statusLine`
 * - Non-empty hook arrays → `hooks.{EventType}`
 *
 * @param settings - The settings IR to render
 * @returns JSON string with 2-space indent and trailing newline
 */
export function renderSettings(settings: SettingsIR): string {
  // Deep-clone raw as the base
  const result: Record<string, unknown> = JSON.parse(
    JSON.stringify(settings.raw),
  );

  // Add deny patterns
  if (settings.denyPatterns && settings.denyPatterns.length > 0) {
    const permissions =
      (result["permissions"] as Record<string, unknown>) ?? {};
    permissions["deny"] = settings.denyPatterns;
    result["permissions"] = permissions;
  }

  // Add status line
  if (settings.statusLine) {
    result["statusLine"] = settings.statusLine;
  }

  // Add hooks
  const hookEvents = [
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "SessionStart",
    "PostCompact",
  ] as const;

  const hooksObj: Record<string, unknown> = {};
  let hasHooks = false;

  for (const event of hookEvents) {
    const entries = settings.hooks[event];
    if (entries && entries.length > 0) {
      hooksObj[event] = entries;
      hasHooks = true;
    }
  }

  if (hasHooks) {
    result["hooks"] = hooksObj;
  }

  return JSON.stringify(result, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// renderMcpConfig
// ---------------------------------------------------------------------------

/**
 * Render a `.mcp.json` string from an array of MCP server nodes.
 *
 * Builds the `{ mcpServers: { id: { command, args, env? } } }` structure.
 * Returns an empty string if the servers array is empty (no file needed).
 *
 * @param servers - Array of MCP server declarations
 * @returns JSON string with 2-space indent and trailing newline, or empty string
 */
export function renderMcpConfig(servers: McpServerNode[]): string {
  if (servers.length === 0) {
    return "";
  }

  const mcpServers: Record<string, Record<string, unknown>> = {};

  for (const server of servers) {
    const entry: Record<string, unknown> = {
      command: server.command,
      args: server.args,
    };

    if (server.env && Object.keys(server.env).length > 0) {
      entry["env"] = server.env;
    }

    mcpServers[server.id] = entry;
  }

  return JSON.stringify({ mcpServers }, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// renderRuleWithFrontmatter
// ---------------------------------------------------------------------------

/**
 * Render a rule's content, prepending YAML frontmatter if the rule has paths.
 *
 * The frontmatter format matches what `parseYamlFrontmatter` expects:
 * ```
 * ---
 * paths:
 *   - path1
 *   - path2
 * ---
 *
 * {content}
 * ```
 *
 * @param rule - The rule node to render
 * @returns The rendered string (with or without frontmatter)
 */
export function renderRuleWithFrontmatter(rule: RuleNode): string {
  if (!rule.paths || rule.paths.length === 0) {
    return rule.content;
  }

  const yamlLines = ["---", "paths:"];
  for (const p of rule.paths) {
    yamlLines.push(`  - ${p}`);
  }
  yamlLines.push("---");

  return yamlLines.join("\n") + "\n\n" + rule.content;
}

// ---------------------------------------------------------------------------
// renderAgentWithFrontmatter
// ---------------------------------------------------------------------------

/**
 * Render an agent's content, prepending YAML frontmatter if the agent has
 * `model` or `disallowedTools`.
 *
 * The frontmatter format matches what `parseYamlFrontmatter` expects:
 * ```
 * ---
 * model: opus
 * disallowedTools:
 *   - Tool1
 * ---
 *
 * {content}
 * ```
 *
 * @param agent - The agent node to render
 * @returns The rendered string (with or without frontmatter)
 */
export function renderAgentWithFrontmatter(agent: AgentNode): string {
  const hasModel = agent.model !== undefined;
  const hasDisallowed =
    agent.disallowedTools !== undefined && agent.disallowedTools.length > 0;
  const hasRouting = agent.modelRouting !== undefined;
  const hasExtra =
    agent.extraFrontmatter !== undefined &&
    Object.keys(agent.extraFrontmatter).length > 0;

  if (!hasModel && !hasDisallowed && !hasRouting && !hasExtra) {
    return agent.content;
  }

  const yamlLines = ["---"];

  if (hasModel) {
    yamlLines.push(`model: ${agent.model}`);
  }

  if (hasDisallowed) {
    yamlLines.push("disallowedTools:");
    for (const tool of agent.disallowedTools!) {
      yamlLines.push(`  - ${tool}`);
    }
  }

  // Emit modelRouting as nested YAML
  if (hasRouting) {
    yamlLines.push("modelRouting:");
    yamlLines.push(`  default: ${agent.modelRouting!.default}`);
    if (agent.modelRouting!.escalateTo) {
      yamlLines.push(`  escalateTo: ${agent.modelRouting!.escalateTo}`);
    }
    if (agent.modelRouting!.escalateWhen) {
      yamlLines.push(`  escalateWhen: ${agent.modelRouting!.escalateWhen}`);
    }
  }

  // Re-emit all extra frontmatter fields preserved from the original file
  if (hasExtra) {
    for (const [key, value] of Object.entries(agent.extraFrontmatter!)) {
      if (Array.isArray(value)) {
        yamlLines.push(`${key}:`);
        for (const item of value) {
          yamlLines.push(`  - ${String(item)}`);
        }
      } else if (typeof value === 'object' && value !== null) {
        // Nested objects — render as indented YAML
        yamlLines.push(`${key}:`);
        for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
          yamlLines.push(`  ${subKey}: ${String(subVal)}`);
        }
      } else {
        yamlLines.push(`${key}: ${String(value)}`);
      }
    }
  }

  yamlLines.push("---");

  return yamlLines.join("\n") + "\n\n" + agent.content;
}

// ---------------------------------------------------------------------------
// settingsHasContent
// ---------------------------------------------------------------------------

/**
 * Check whether a SettingsIR has any meaningful content beyond empty defaults.
 *
 * Returns false for `{ hooks: {}, raw: {} }` (the output of `createEmptySettings`).
 */
function settingsHasContent(settings: SettingsIR): boolean {
  if (settings.statusLine) return true;
  if (settings.denyPatterns && settings.denyPatterns.length > 0) return true;
  if (Object.keys(settings.raw).length > 0) return true;

  // Check if any hook event has entries
  const hookEvents = [
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "SessionStart",
    "PostCompact",
  ] as const;

  for (const event of hookEvents) {
    const entries = settings.hooks[event];
    if (entries && entries.length > 0) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// renderHarness
// ---------------------------------------------------------------------------

/**
 * Render a complete HarnessIR into a file map.
 *
 * Returns a `Map<string, string>` where keys are relative file paths
 * (e.g., `CLAUDE.md`, `commands/build.md`) and values are file contents.
 *
 * Only files with actual content are included in the map.
 *
 * @param ir - The complete harness IR to render
 * @returns Map of relative file path to file content
 */
export function renderHarness(ir: HarnessIR): Map<string, string> {
  return renderedHarnessContentMap(renderRenderedHarness(ir));
}

/**
 * Render a complete HarnessIR into the shared deterministic rendered contract.
 */
export function renderRenderedHarness(ir: HarnessIR): RenderedHarness {
  const files: RenderedHarnessEntry[] = [];

  // CLAUDE.md — only if sections exist or meta.name is set
  if (ir.sections.length > 0 || ir.meta.name) {
    files.push({
      path: "CLAUDE.md",
      content: renderClaudeMd(ir.meta, ir.sections),
      source: "claude_md",
    });
  }

  // settings.json — only if settings has content beyond empty defaults
  if (settingsHasContent(ir.settings)) {
    files.push({
      path: "settings.json",
      content: renderSettings(ir.settings),
      source: "settings",
    });
  }

  // Commands
  for (const cmd of ir.commands) {
    files.push({
      path: `commands/${cmd.name}.md`,
      content: cmd.content,
      source: "commands",
    });
  }

  // Rules
  for (const rule of ir.rules) {
    files.push({
      path: `rules/${rule.name}.md`,
      content: renderRuleWithFrontmatter(rule),
      source: "rules",
    });
  }

  // Agents
  for (const agent of ir.agents) {
    files.push({
      path: `agents/${agent.name}.md`,
      content: renderAgentWithFrontmatter(agent),
      source: "agents",
    });
  }

  // Skills
  for (const skill of ir.skills) {
    files.push({
      path: `skills/${skill.name}.md`,
      content: skill.content,
      source: "skills",
    });
  }

  // Docs
  for (const doc of ir.docs) {
    files.push({
      path: `docs/${doc.name}.md`,
      content: doc.content,
      source: "docs",
    });
  }

  // Hooks
  for (const hook of ir.hooks) {
    files.push({
      path: `hooks/${hook.name}.mjs`,
      content: hook.content,
      source: "hooks",
    });
  }

  // .mcp.json — only if servers exist
  const mcpContent = renderMcpConfig(ir.mcpServers);
  if (mcpContent) {
    files.push({ path: ".mcp.json", content: mcpContent, source: "mcp" });
  }

  return createRenderedHarness(files, { target: "claude-code", source: "harness-ir" });
}

// ---------------------------------------------------------------------------
// renderHarnessToDir
// ---------------------------------------------------------------------------

/**
 * Render a HarnessIR to a target directory on disk.
 *
 * Calls `renderHarness` to produce the file map, then writes each file
 * to `path.join(targetDir, relativePath)`, creating directories as needed.
 *
 * @param ir - The complete harness IR to render
 * @param targetDir - Absolute path to write files into
 * @returns Array of relative file paths that were written
 */
export async function renderHarnessToDir(
  ir: HarnessIR,
  targetDir: string,
): Promise<string[]> {
  return writeRenderedHarness(renderRenderedHarness(ir), targetDir);
}
