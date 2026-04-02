/**
 * Harness IR — Structured intermediate representation for .claude/ directories.
 *
 * This module defines every node type that the parser emits and the emitter consumes.
 * Types are intentionally simple value objects with no behaviour.
 */

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

/** Top-level metadata extracted from the CLAUDE.md preamble and tech-stack section. */
export interface HarnessMeta {
  name: string;
  purpose: string;
  techStack: {
    language: string;
    framework?: string;
    buildTool?: string;
    testRunner?: string;
    packageManager?: string;
  };
  autonomyLevel: 1 | 2 | 3 | 4;
}

// ---------------------------------------------------------------------------
// Content nodes
// ---------------------------------------------------------------------------

/** A heading-delimited section inside CLAUDE.md. */
export interface Section {
  id: string;
  heading: string;
  content: string;
  order: number;
}

/** A file under `.claude/commands/`. */
export interface CommandNode {
  name: string;
  description: string;
  content: string;
}

/** A file under `.claude/rules/` — may carry YAML frontmatter with `paths`. */
export interface RuleNode {
  name: string;
  paths?: string[];
  content: string;
}

/** A file under `.claude/agents/` — may carry YAML frontmatter with `model` / `disallowedTools`. */
export interface AgentNode {
  name: string;
  model?: string;
  disallowedTools?: string[];
  modelRouting?: {
    default: 'haiku' | 'sonnet' | 'opus';
    escalateTo?: 'sonnet' | 'opus';
    escalateWhen?: string;
  };
  extraFrontmatter?: Record<string, unknown>;  // preserve all other YAML frontmatter fields
  content: string;
}

/** A file under `.claude/skills/`. */
export interface SkillNode {
  name: string;
  content: string;
}

/** A file under `.claude/docs/`. */
export interface DocNode {
  name: string;
  content: string;
}

/** A file under `.claude/hooks/` (ESM `.mjs`). */
export interface HookNode {
  name: string;
  content: string;
  type: "command" | "prompt";
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** A single hook entry inside `settings.json` hooks map. */
export interface HookEntry {
  matcher: string;
  hooks: Array<{
    type: "command" | "prompt";
    command?: string;
    prompt?: string;
    timeout?: number;
  }>;
}

/** Parsed representation of `settings.json`. */
export interface SettingsIR {
  statusLine?: { command: string };
  hooks: {
    PreToolUse?: HookEntry[];
    PostToolUse?: HookEntry[];
    UserPromptSubmit?: HookEntry[];
    SessionStart?: HookEntry[];
    PostCompact?: HookEntry[];
  };
  denyPatterns?: string[];
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

/** An MCP server declaration from `.mcp.json`. */
export interface McpServerNode {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

/** Maps natural-language patterns to slash-commands for intent routing. */
export interface IntentNode {
  commandName: string;
  patterns: string[];
  priority: number;
}

// ---------------------------------------------------------------------------
// Root IR
// ---------------------------------------------------------------------------

/** The complete intermediate representation of a `.claude/` harness directory. */
export interface HarnessIR {
  meta: HarnessMeta;
  sections: Section[];
  commands: CommandNode[];
  rules: RuleNode[];
  agents: AgentNode[];
  skills: SkillNode[];
  docs: DocNode[];
  hooks: HookNode[];
  settings: SettingsIR;
  mcpServers: McpServerNode[];
  intents: IntentNode[];
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Create a HarnessIR with all fields set to safe defaults. */
export function createEmptyIR(): HarnessIR {
  return {
    meta: {
      name: "",
      purpose: "",
      techStack: { language: "" },
      autonomyLevel: 2,
    },
    sections: [],
    commands: [],
    rules: [],
    agents: [],
    skills: [],
    docs: [],
    hooks: [],
    settings: createEmptySettings(),
    mcpServers: [],
    intents: [],
  };
}

/** Create a SettingsIR with all fields set to safe defaults. */
export function createEmptySettings(): SettingsIR {
  return { hooks: {}, raw: {} };
}

/** Convenience factory for Section nodes. */
export function createSection(
  id: string,
  heading: string,
  content: string,
  order: number,
): Section {
  return { id, heading, content, order };
}

/** Convenience factory for CommandNode with an optional description (defaults to empty string). */
export function createCommandNode(
  name: string,
  content: string,
  description?: string,
): CommandNode {
  return { name, description: description ?? "", content };
}

/** Convenience factory for RuleNode with optional path scoping. */
export function createRuleNode(
  name: string,
  content: string,
  paths?: string[],
): RuleNode {
  const node: RuleNode = { name, content };
  if (paths !== undefined) {
    node.paths = paths;
  }
  return node;
}

/** Convenience factory for AgentNode with optional model hint. */
export function createAgentNode(
  name: string,
  content: string,
  model?: string,
): AgentNode {
  const node: AgentNode = { name, content };
  if (model !== undefined) {
    node.model = model;
  }
  return node;
}

// ---------------------------------------------------------------------------
// Mutation types
// ---------------------------------------------------------------------------

/** Discriminated union of all possible IR mutations. */
export type IRMutation =
  | { type: "update_section"; sectionId: string; content: string; rationale: string }
  | { type: "add_section"; section: Section; rationale: string }
  | { type: "remove_section"; sectionId: string; rationale: string }
  | { type: "reorder_section"; sectionId: string; newOrder: number; rationale: string }
  | { type: "add_command"; command: CommandNode; rationale: string }
  | { type: "update_command"; name: string; content: string; rationale: string }
  | { type: "remove_command"; name: string; rationale: string }
  | { type: "add_rule"; rule: RuleNode; rationale: string }
  | { type: "update_rule"; name: string; content: string; rationale: string }
  | { type: "remove_rule"; name: string; rationale: string }
  | { type: "add_agent"; agent: AgentNode; rationale: string }
  | { type: "update_agent"; name: string; changes: Partial<AgentNode>; rationale: string }
  | { type: "remove_agent"; name: string; rationale: string }
  | { type: "add_mcp_server"; server: McpServerNode; rationale: string }
  | { type: "remove_mcp_server"; id: string; rationale: string }
  | { type: "update_settings"; path: string; value: unknown; rationale: string }
  | {
      type: "raw_text";
      file: string;
      action: "replace" | "add_section" | "create_file" | "delete_section" | "delete_file";
      oldText?: string;
      newText: string;
      rationale: string;
    };

// ---------------------------------------------------------------------------
// Diff types
// ---------------------------------------------------------------------------

/** Structural diff between two HarnessIR snapshots. */
export interface IRDiff {
  sections: {
    added: Section[];
    removed: Section[];
    modified: Array<{ id: string; before: string; after: string }>;
    reordered: Array<{ id: string; oldOrder: number; newOrder: number }>;
  };
  commands: {
    added: CommandNode[];
    removed: string[];
    modified: Array<{ name: string; before: string; after: string }>;
  };
  rules: {
    added: RuleNode[];
    removed: string[];
    modified: Array<{ name: string; before: string; after: string }>;
  };
  agents: {
    added: AgentNode[];
    removed: string[];
    modified: Array<{ name: string; changes: string }>;
  };
  mcpServers: {
    added: McpServerNode[];
    removed: string[];
  };
  settings: {
    changes: Array<{ path: string; before: unknown; after: unknown }>;
  };
}

/** Create an empty IRDiff with all collections empty. */
export function createEmptyDiff(): IRDiff {
  return {
    sections: {
      added: [],
      removed: [],
      modified: [],
      reordered: [],
    },
    commands: {
      added: [],
      removed: [],
      modified: [],
    },
    rules: {
      added: [],
      removed: [],
      modified: [],
    },
    agents: {
      added: [],
      removed: [],
      modified: [],
    },
    mcpServers: {
      added: [],
      removed: [],
    },
    settings: {
      changes: [],
    },
  };
}
