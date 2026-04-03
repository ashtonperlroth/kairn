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

const PERSIST_ROUTER_TEMPLATE = `import { readFileSync } from 'fs';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
const prompt = (input.prompt ?? '').trim();

// Pass-through patterns (fast exit)
const PASSTHROUGH = /^(what|how|why|where|when|can you|does|is |show me|find |search |list |\\/project:)/i;
const SINGLE_FILE = /^(edit|fix the typo|update the comment|change the|rename) .{3,60}$/i;

if (PASSTHROUGH.test(prompt) || SINGLE_FILE.test(prompt) || prompt.length < 20) {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

// Check config for routing mode
let routingMode = 'auto';
try {
  const settings = JSON.parse(readFileSync('.claude/settings.json', 'utf8'));
  routingMode = settings.persistence_routing ?? 'auto';
} catch { /* default to auto */ }

if (routingMode === 'off') {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

// Complexity signals
const signals = [];

if (/\\b(then|after that|and also|next|finally|step \\d|first .* then)\\b/i.test(prompt)) {
  signals.push('multi-step');
}
if (/\\b(add|implement|build|create|integrate|set up)\\b.*\\b(feature|auth|api|endpoint|page|component|module|service|database|migration)\\b/i.test(prompt)) {
  signals.push('feature-scope');
}
if (/\\b(migrate|convert|replace|upgrade|refactor|rewrite|restructure)\\b/i.test(prompt)) {
  signals.push('refactor-scope');
}
if (/\\b(when .* happens|steps to reproduce|broken|crash|regression|fails when)\\b/i.test(prompt)) {
  signals.push('bug-with-repro');
}
if (/\\b(persist|keep working|don't stop|until done|until .* pass)\\b/i.test(prompt)) {
  signals.push('explicit');
}
if (prompt.split(/\\s+/).length > 50) {
  signals.push('long-prompt');
}

const shouldRoute = routingMode === 'manual'
  ? signals.includes('explicit')
  : signals.length >= 2 || signals.includes('explicit');

if (shouldRoute) {
  process.stdout.write(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: [
        'PERSISTENCE ROUTING: This task has complexity signals (' + signals.join(', ') + ').',
        'Execute this using the /project:persist workflow:',
        '1. Ensure acceptance criteria exist in docs/SPRINT.md (create from this prompt if needed)',
        '2. Initialize .claude/progress.json',
        '3. Work criterion-by-criterion until all pass',
        '4. Run review gate before marking complete',
      ].join('\\n'),
    },
  }));
} else {
  process.stdout.write(JSON.stringify({ continue: true }));
}
`;

const PERSIST_ROUTER_HOOK = {
  matcher: '',
  hooks: [{
    type: 'command',
    command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/persist-router.mjs"',
    timeout: 5,
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

  // Add persist-router hook for L3+ code projects
  // (persistence_routing is set by applyAutonomyLevel for all levels)
  if (isCodeProject(spec) && (spec.autonomy_level ?? 1) >= 3) {
    const hooks = (base.hooks ?? {}) as Record<string, unknown[]>;
    const userPromptSubmit = (hooks.UserPromptSubmit ?? []) as unknown[];
    userPromptSubmit.push(PERSIST_ROUTER_HOOK);
    hooks.UserPromptSubmit = userPromptSubmit;
    base.hooks = hooks;
  }

  // Add intent routing hooks if patterns exist
  const hasIntentHooks = spec.harness.hooks &&
    Object.keys(spec.harness.hooks).length > 0;

  if (hasIntentHooks) {
    const hooks = (base.hooks ?? {}) as Record<string, unknown[]>;

    // Tier 1 (regex) + Tier 2 (prompt) on UserPromptSubmit
    const userPromptSubmit = (hooks.UserPromptSubmit ?? []) as unknown[];
    const intentHookEntry: Record<string, unknown> = {
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/intent-router.mjs"',
          timeout: 5,
        },
      ],
    };
    // Add Tier 2 prompt hook if template exists
    if (spec.harness.intent_prompt_template) {
      (intentHookEntry.hooks as unknown[]).push({
        type: 'prompt',
        prompt: spec.harness.intent_prompt_template,
        timeout: 15,
      });
    }
    userPromptSubmit.push(intentHookEntry);
    hooks.UserPromptSubmit = userPromptSubmit;

    // Intent learner on SessionStart
    const sessionStart = (hooks.SessionStart ?? []) as unknown[];
    sessionStart.push({
      matcher: '*',
      hooks: [{
        type: 'command',
        command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/intent-learner.mjs"',
        timeout: 10,
      }],
    });
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

  // Hooks (intent-router.mjs, intent-learner.mjs)
  if (spec.harness.hooks) {
    for (const [name, content] of Object.entries(spec.harness.hooks)) {
      files.set(`.claude/hooks/${name}.mjs`, content);
    }
    // Create empty intent-log.jsonl for Tier 2 logging
    if (Object.keys(spec.harness.hooks).length > 0) {
      files.set('.claude/hooks/intent-log.jsonl', '');
    }
  }

  // Persist-router hook for L3+ code projects
  if (isCodeProject(spec) && (spec.autonomy_level ?? 1) >= 3) {
    files.set('.claude/hooks/persist-router.mjs', PERSIST_ROUTER_TEMPLATE);
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

  // 9. Hooks (intent-router.mjs, intent-learner.mjs)
  if (spec.harness.hooks) {
    for (const [name, content] of Object.entries(spec.harness.hooks)) {
      const p = path.join(claudeDir, "hooks", `${name}.mjs`);
      await writeFile(p, content);
      written.push(`.claude/hooks/${name}.mjs`);
    }
    // Create empty intent-log.jsonl for Tier 2 logging
    if (Object.keys(spec.harness.hooks).length > 0) {
      const logPath = path.join(claudeDir, "hooks", "intent-log.jsonl");
      await writeFile(logPath, '');
      written.push('.claude/hooks/intent-log.jsonl');
    }
  }

  // 10. Persist-router hook for L3+ code projects
  if (isCodeProject(spec) && (spec.autonomy_level ?? 1) >= 3) {
    const p = path.join(claudeDir, "hooks", "persist-router.mjs");
    await writeFile(p, PERSIST_ROUTER_TEMPLATE);
    written.push('.claude/hooks/persist-router.mjs');
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

  // Prefer structured IR counts when available; fall back to flat harness fields
  // for pre-v2.11 saved environments that lack the ir field.
  const counts = spec.ir
    ? {
        commandCount: spec.ir.commands.length,
        ruleCount: spec.ir.rules.length,
        skillCount: spec.ir.skills.length,
        agentCount: spec.ir.agents.length,
      }
    : {
        commandCount: Object.keys(spec.harness.commands || {}).length,
        ruleCount: Object.keys(spec.harness.rules || {}).length,
        skillCount: Object.keys(spec.harness.skills || {}).length,
        agentCount: Object.keys(spec.harness.agents || {}).length,
      };

  return {
    toolCount: spec.tools.length,
    ...counts,
    pluginCommands,
    envSetup,
  };
}
