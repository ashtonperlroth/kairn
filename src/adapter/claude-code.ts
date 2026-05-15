import type { EnvironmentSpec, RegistryTool } from "../types.js";
import { applyAutonomyLevel } from "../autonomy.js";
import type { RuntimeAdapter } from "./registry.js";
import {
  createRenderedHarness,
  renderedHarnessContentMap,
  writeRenderedHarness,
  type RenderedHarness,
  type RenderedHarnessEntry,
} from "../rendered-harness.js";

const STATUS_LINE = {
  command:
    "printf '%s | %s tasks' \"$(git branch --show-current 2>/dev/null || echo 'no-git')\" \"$(grep -c '\\- \\[ \\]' docs/SPRINT.md 2>/dev/null || echo 0)\"",
};

function isCodeProject(spec: EnvironmentSpec): boolean {
  const commands = spec.harness.commands ?? {};
  return "status" in commands || "test" in commands;
}

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
): Record<string, unknown> | null {
  const settings = spec.harness.settings;
  const base: Record<string, unknown> = settings && Object.keys(settings).length > 0
    ? { ...(settings as Record<string, unknown>) }
    : {};

  // Add statusLine for code projects
  if (!("statusLine" in base) && isCodeProject(spec)) {
    base.statusLine = STATUS_LINE;
  }

  // .env loader hook removed in v2.12 — replaced by "Environment Variables"
  // section in CLAUDE.md for honest, non-contradictory .env handling.

  // Add persist-router hook for L3+ code projects
  // (persistence_routing is set by applyAutonomyLevel for all levels)
  if (isCodeProject(spec) && (spec.autonomy_level ?? 1) >= 3) {
    const hooks = (base.hooks ?? {}) as Record<string, unknown[]>;
    const userPromptSubmit = (hooks.UserPromptSubmit ?? []) as unknown[];
    userPromptSubmit.push(PERSIST_ROUTER_HOOK);
    hooks.UserPromptSubmit = userPromptSubmit;
    base.hooks = hooks;
  }

  // Optional strict classification prompt hook for autonomy level 2+
  // Replaces intent routing regex with a model-based classifier
  if ((spec.autonomy_level ?? 1) >= 2 && spec.harness.commands && Object.keys(spec.harness.commands).length > 0) {
    const cmdList = Object.keys(spec.harness.commands)
      .map((name) => `/project:${name}`)
      .join(', ');
    const hooks = (base.hooks ?? {}) as Record<string, unknown[]>;
    const userPromptSubmit = (hooks.UserPromptSubmit ?? []) as unknown[];
    userPromptSubmit.push({
      matcher: '',
      hooks: [{
        type: 'prompt',
        prompt: `You are routing user intent to project commands. ONLY route if the user EXPLICITLY asks to perform one of these actions. If they're asking a question, discussing code, or the intent is ambiguous, respond naturally — do NOT route.\n\nCommands: ${cmdList}\n\nRespond with ONLY the command name if routing, or "NONE" if not routing.`,
        timeout: 10,
      }],
    });
    hooks.UserPromptSubmit = userPromptSubmit;
    base.hooks = hooks;
  }

  if (Object.keys(base).length === 0) return null;
  return base;
}

/**
 * Detect docs that are just template placeholders with no real content.
 *
 * Returns true for docs that contain only headers, empty tables, or
 * common placeholder phrases — these waste context without adding value.
 */
function isPlaceholderDoc(content: string): boolean {
  // Check for common placeholder patterns
  if (content.includes('(Add decisions here as they are made)')) return true;
  if (content.includes('(Add learnings here as they are discovered)')) return true;

  // Check if non-header content is too short
  const nonHeaderLines = content
    .split('\n')
    .filter((line) => !line.startsWith('#') && !line.startsWith('|--') && line.trim().length > 0);

  // Header-only tables with no data rows
  const hasOnlyHeaderRows = nonHeaderLines.every(
    (line) => line.startsWith('|') || line.startsWith('-') || line.trim() === ''
  );
  if (hasOnlyHeaderRows && nonHeaderLines.length <= 1) return true;

  // Very short total content
  const contentOnly = nonHeaderLines.join('').trim();
  if (contentOnly.length < 50) return true;

  return false;
}

export function buildRenderedHarness(
  spec: EnvironmentSpec,
): RenderedHarness {
  // Apply autonomy-level content before building file map
  applyAutonomyLevel(spec);

  const files: RenderedHarnessEntry[] = [];

  if (spec.harness.claude_md) {
    files.push({
      path: ".claude/CLAUDE.md",
      content: spec.harness.claude_md,
      source: "claude_md",
    });
  }
  const resolvedSettings = resolveSettings(spec);
  if (resolvedSettings) {
    files.push({
      path: ".claude/settings.json",
      content: JSON.stringify(resolvedSettings, null, 2),
      source: "settings",
    });
  }
  if (
    spec.harness.mcp_config &&
    Object.keys(spec.harness.mcp_config).length > 0
  ) {
    files.push({
      path: ".mcp.json",
      content: JSON.stringify({ mcpServers: spec.harness.mcp_config }, null, 2),
      source: "mcp",
    });
  }
  if (spec.harness.commands) {
    for (const [name, content] of Object.entries(spec.harness.commands)) {
      files.push({
        path: `.claude/commands/${name}.md`,
        content,
        source: "commands",
      });
    }
  }
  if (spec.harness.rules) {
    for (const [name, content] of Object.entries(spec.harness.rules)) {
      files.push({
        path: `.claude/rules/${name}.md`,
        content,
        source: "rules",
      });
    }
  }
  if (spec.harness.skills) {
    for (const [skillPath, content] of Object.entries(spec.harness.skills)) {
      files.push({
        path: `.claude/skills/${skillPath}.md`,
        content,
        source: "skills",
      });
    }
  }
  if (spec.harness.agents) {
    for (const [name, content] of Object.entries(spec.harness.agents)) {
      files.push({
        path: `.claude/agents/${name}.md`,
        content,
        source: "agents",
      });
    }
  }
  if (spec.harness.docs) {
    for (const [name, content] of Object.entries(spec.harness.docs)) {
      if (!isPlaceholderDoc(content)) {
        files.push({
          path: `.claude/docs/${name}.md`,
          content,
          source: "docs",
        });
      }
    }
  }

  // Intent routing hooks removed in v2.12 — no intent-router.mjs, intent-learner.mjs, or intent-log.jsonl

  // Persist-router hook for L3+ code projects
  if (isCodeProject(spec) && (spec.autonomy_level ?? 1) >= 3) {
    files.push({
      path: ".claude/hooks/persist-router.mjs",
      content: PERSIST_ROUTER_TEMPLATE,
      source: "hooks",
    });
  }

  return createRenderedHarness(files, { target: "claude-code", source: "environment-spec" });
}

export function buildFileMap(
  spec: EnvironmentSpec,
): Map<string, string> {
  return renderedHarnessContentMap(buildRenderedHarness(spec));
}

export async function writeEnvironment(
  spec: EnvironmentSpec,
  targetDir: string,
): Promise<string[]> {
  return writeRenderedHarness(buildRenderedHarness(spec), targetDir);
}

export const claudeCodeAdapter: RuntimeAdapter = {
  target: "claude-code",
  displayName: "Claude Code",
  aliases: ["claude", "claude_code", "claudecode", "cc"],
  launchCommand: "claude",
  envSetupStrategy: "project-env-file",
  pluginInstructionStrategy: "project-cli",
  capabilities: {
    commands: true,
    hooks: {
      supported: true,
      events: ["PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart", "PostCompact"],
      handlerTypes: ["command", "prompt"],
    },
    tools: { mcpServers: true, commandRequired: true },
    agents: true,
    skills: true,
    docs: true,
    permissions: true,
    memory: true,
    limitations: [],
  },
  render: ({ spec }) => buildRenderedHarness(spec),
  buildFileMap: ({ spec }) => buildFileMap(spec),
  write: ({ spec, targetDir }) => writeEnvironment(spec, targetDir),
};

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
