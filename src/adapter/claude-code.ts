import fs from "fs/promises";
import path from "path";
import type { EnvironmentSpec, RegistryTool } from "../types.js";
import { applyAutonomyLevel } from "../autonomy.js";

const STATUS_LINE = {
  command:
    "printf '%s | %s tasks' \"$(git branch --show-current 2>/dev/null || echo 'no-git')\" \"$(grep -c '\\- \\[ \\]' docs/SPRINT.md 2>/dev/null || echo 0)\"",
};

function isCodeProject(spec: EnvironmentSpec): boolean {
  const commands = spec.harness.commands ?? {};
  return "status" in commands || "test" in commands;
}

const ENV_LOADER_HOOK = {
  matcher: "",
  hooks: [{
    type: "command",
    command: 'if [ -f .env ] && [ -n "$CLAUDE_ENV_FILE" ]; then grep -v "^#" .env | grep -v "^$" | grep "=" >> "$CLAUDE_ENV_FILE"; fi',
  }],
};

function resolveSettings(
  spec: EnvironmentSpec,
  options?: { hasEnvVars?: boolean }
): Record<string, unknown> | null {
  const settings = spec.harness.settings;
  const base: Record<string, unknown> = settings && Object.keys(settings).length > 0
    ? { ...(settings as Record<string, unknown>) }
    : {};

  // Add statusLine for code projects
  if (!("statusLine" in base) && isCodeProject(spec)) {
    base.statusLine = STATUS_LINE;
  }

  // Add SessionStart hook for .env loading
  if (options?.hasEnvVars) {
    const hooks = (base.hooks ?? {}) as Record<string, unknown[]>;
    const sessionStart = (hooks.SessionStart ?? []) as unknown[];
    sessionStart.push(ENV_LOADER_HOOK);
    hooks.SessionStart = sessionStart;
    base.hooks = hooks;
  }

  if (Object.keys(base).length === 0) return null;
  return base;
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

export function buildFileMap(
  spec: EnvironmentSpec,
  options?: { hasEnvVars?: boolean }
): Map<string, string> {
  // Apply autonomy-level content before building file map
  applyAutonomyLevel(spec);

  const files = new Map<string, string>();

  if (spec.harness.claude_md) {
    files.set(".claude/CLAUDE.md", spec.harness.claude_md);
  }
  const resolvedSettings = resolveSettings(spec, options);
  if (resolvedSettings) {
    files.set(".claude/settings.json", JSON.stringify(resolvedSettings, null, 2));
  }
  if (
    spec.harness.mcp_config &&
    Object.keys(spec.harness.mcp_config).length > 0
  ) {
    files.set(
      ".mcp.json",
      JSON.stringify({ mcpServers: spec.harness.mcp_config }, null, 2)
    );
  }
  if (spec.harness.commands) {
    for (const [name, content] of Object.entries(spec.harness.commands)) {
      files.set(`.claude/commands/${name}.md`, content);
    }
  }
  if (spec.harness.rules) {
    for (const [name, content] of Object.entries(spec.harness.rules)) {
      files.set(`.claude/rules/${name}.md`, content);
    }
  }
  if (spec.harness.skills) {
    for (const [skillPath, content] of Object.entries(spec.harness.skills)) {
      files.set(`.claude/skills/${skillPath}.md`, content);
    }
  }
  if (spec.harness.agents) {
    for (const [name, content] of Object.entries(spec.harness.agents)) {
      files.set(`.claude/agents/${name}.md`, content);
    }
  }
  if (spec.harness.docs) {
    for (const [name, content] of Object.entries(spec.harness.docs)) {
      files.set(`.claude/docs/${name}.md`, content);
    }
  }

  return files;
}

export async function writeEnvironment(
  spec: EnvironmentSpec,
  targetDir: string,
  options?: { hasEnvVars?: boolean }
): Promise<string[]> {
  // Apply autonomy-level content before writing
  applyAutonomyLevel(spec);

  const claudeDir = path.join(targetDir, ".claude");
  const written: string[] = [];

  // 1. CLAUDE.md
  if (spec.harness.claude_md) {
    const p = path.join(claudeDir, "CLAUDE.md");
    await writeFile(p, spec.harness.claude_md);
    written.push(".claude/CLAUDE.md");
  }

  // 2. settings.json
  const resolvedSettings = resolveSettings(spec, options);
  if (resolvedSettings) {
    const p = path.join(claudeDir, "settings.json");
    await writeFile(p, JSON.stringify(resolvedSettings, null, 2));
    written.push(".claude/settings.json");
  }

  // 3. .mcp.json (project-scoped, goes in project root)
  if (
    spec.harness.mcp_config &&
    Object.keys(spec.harness.mcp_config).length > 0
  ) {
    const p = path.join(targetDir, ".mcp.json");
    const mcpContent = { mcpServers: spec.harness.mcp_config };
    await writeFile(p, JSON.stringify(mcpContent, null, 2));
    written.push(".mcp.json");
  }

  // 4. Commands
  if (spec.harness.commands) {
    for (const [name, content] of Object.entries(spec.harness.commands)) {
      const p = path.join(claudeDir, "commands", `${name}.md`);
      await writeFile(p, content);
      written.push(`.claude/commands/${name}.md`);
    }
  }

  // 5. Rules
  if (spec.harness.rules) {
    for (const [name, content] of Object.entries(spec.harness.rules)) {
      const p = path.join(claudeDir, "rules", `${name}.md`);
      await writeFile(p, content);
      written.push(`.claude/rules/${name}.md`);
    }
  }

  // 6. Skills
  if (spec.harness.skills) {
    for (const [skillPath, content] of Object.entries(spec.harness.skills)) {
      const p = path.join(claudeDir, "skills", `${skillPath}.md`);
      await writeFile(p, content);
      written.push(`.claude/skills/${skillPath}.md`);
    }
  }

  // 7. Agents
  if (spec.harness.agents) {
    for (const [name, content] of Object.entries(spec.harness.agents)) {
      const p = path.join(claudeDir, "agents", `${name}.md`);
      await writeFile(p, content);
      written.push(`.claude/agents/${name}.md`);
    }
  }

  // 8. Docs
  if (spec.harness.docs) {
    for (const [name, content] of Object.entries(spec.harness.docs)) {
      const p = path.join(claudeDir, "docs", `${name}.md`);
      await writeFile(p, content);
      written.push(`.claude/docs/${name}.md`);
    }
  }

  return written;
}

export interface EnvSetupInfo {
  toolName: string;
  envVar: string;
  description: string;
  signupUrl?: string;
}

export function summarizeSpec(
  spec: EnvironmentSpec,
  registry: RegistryTool[]
): {
  toolCount: number;
  commandCount: number;
  ruleCount: number;
  skillCount: number;
  agentCount: number;
  pluginCommands: string[];
  envSetup: EnvSetupInfo[];
} {
  const pluginCommands: string[] = [];
  const envSetup: EnvSetupInfo[] = [];

  for (const selected of spec.tools) {
    const tool = registry.find((t) => t.id === selected.tool_id);
    if (!tool) continue;

    if (tool.install.plugin_command) {
      pluginCommands.push(tool.install.plugin_command);
    }

    if (tool.env_vars) {
      for (const ev of tool.env_vars) {
        envSetup.push({
          toolName: tool.name,
          envVar: ev.name,
          description: ev.description,
          signupUrl: tool.signup_url,
        });
      }
    }
  }

  return {
    toolCount: spec.tools.length,
    commandCount: Object.keys(spec.harness.commands || {}).length,
    ruleCount: Object.keys(spec.harness.rules || {}).length,
    skillCount: Object.keys(spec.harness.skills || {}).length,
    agentCount: Object.keys(spec.harness.agents || {}).length,
    pluginCommands,
    envSetup,
  };
}
