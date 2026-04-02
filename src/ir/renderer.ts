/**
 * Harness Renderer — produces a `.claude/` directory structure from a HarnessIR.
 *
 * This is the inverse of the parser: given a HarnessIR, it emits the file
 * contents that `parseHarness` would read back into the same IR.
 *
 * All file I/O uses `fs.promises`. Directories are created on demand.
 */

import fs from "fs/promises";
import path from "path";
import type {
  HarnessIR,
  HarnessMeta,
  Section,
  SettingsIR,
  McpServerNode,
  RuleNode,
  AgentNode,
} from "./types.js";

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
 * @param _meta - Harness metadata (name used only if no preamble section provides a title)
 * @param sections - The ordered sections to render
 * @returns The full CLAUDE.md content string with trailing newline
 */
export function renderClaudeMd(_meta: HarnessMeta, sections: Section[]): string {
  const sorted = [...sections].sort((a, b) => a.order - b.order);

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

  if (!hasModel && !hasDisallowed) {
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
  const files = new Map<string, string>();

  // CLAUDE.md — only if sections exist or meta.name is set
  if (ir.sections.length > 0 || ir.meta.name) {
    files.set("CLAUDE.md", renderClaudeMd(ir.meta, ir.sections));
  }

  // settings.json — only if settings has content beyond empty defaults
  if (settingsHasContent(ir.settings)) {
    files.set("settings.json", renderSettings(ir.settings));
  }

  // Commands
  for (const cmd of ir.commands) {
    files.set(`commands/${cmd.name}.md`, cmd.content);
  }

  // Rules
  for (const rule of ir.rules) {
    files.set(`rules/${rule.name}.md`, renderRuleWithFrontmatter(rule));
  }

  // Agents
  for (const agent of ir.agents) {
    files.set(`agents/${agent.name}.md`, renderAgentWithFrontmatter(agent));
  }

  // Skills
  for (const skill of ir.skills) {
    files.set(`skills/${skill.name}.md`, skill.content);
  }

  // Docs
  for (const doc of ir.docs) {
    files.set(`docs/${doc.name}.md`, doc.content);
  }

  // Hooks
  for (const hook of ir.hooks) {
    files.set(`hooks/${hook.name}.mjs`, hook.content);
  }

  // .mcp.json — only if servers exist
  const mcpContent = renderMcpConfig(ir.mcpServers);
  if (mcpContent) {
    files.set(".mcp.json", mcpContent);
  }

  return files;
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
  const fileMap = renderHarness(ir);
  const writtenPaths: string[] = [];

  for (const [relativePath, content] of fileMap) {
    const fullPath = path.join(targetDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
    writtenPaths.push(relativePath);
  }

  return writtenPaths;
}
