export type LLMProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "deepseek"
  | "mistral"
  | "groq"
  | "other";

export type AuthType = 'api-key' | 'claude-code-oauth';

export interface KairnConfig {
  provider: LLMProvider;
  api_key: string;
  model: string;
  base_url?: string;
  default_runtime: string;
  created_at: string;
  auth_type?: AuthType;
}

export interface ToolSelection {
  tool_id: string;
  reason: string;
}

export type AutonomyLevel = 1 | 2 | 3 | 4;

export interface EnvironmentSpec {
  id: string;
  name: string;
  description: string;
  intent: string;
  created_at: string;
  autonomy_level: AutonomyLevel;
  tools: ToolSelection[];
  harness: {
    claude_md: string;
    settings: Record<string, unknown>;
    mcp_config: Record<string, unknown>;
    commands: Record<string, string>;
    rules: Record<string, string>;
    skills: Record<string, string>;
    agents: Record<string, string>;
    docs: Record<string, string>;
  };
}

/** Pass 1 output: tool selection + project outline (small JSON, no embedded markdown) */
export interface SkeletonSpec {
  name: string;
  description: string;
  tools: ToolSelection[];
  outline: {
    tech_stack: string[];
    workflow_type: string;
    key_commands: string[];
    custom_rules: string[];
    custom_agents: string[];
    custom_skills: string[];
  };
}

/** Pass 2 output: all harness content (CLAUDE.md, commands, rules, agents, etc.) */
export interface HarnessContent {
  claude_md: string;
  commands: Record<string, string>;
  rules: Record<string, string>;
  agents: Record<string, string>;
  skills: Record<string, string>;
  docs: Record<string, string>;
}

/** Structured progress events emitted during compilation */
export interface CompileProgress {
  phase: 'registry' | 'pass1' | 'pass2' | 'pass2-retry' | 'pass3' | 'done';
  status: 'running' | 'success' | 'warning' | 'error';
  message: string;
  detail?: string;
  elapsed?: number;
  estimate?: string;
}

export type RuntimeTarget = "claude-code" | "hermes";

export interface Clarification {
  question: string;
  suggestion: string;
}

export interface RegistryTool {
  id: string;
  name: string;
  description: string;
  category: string;
  tier: number;
  type: "mcp_server" | "plugin" | "hook";
  auth: "none" | "api_key" | "oauth" | "connection_string";
  best_for: string[];
  env_vars?: { name: string; description: string }[];
  signup_url?: string;
  install: {
    mcp_config?: Record<string, unknown>;
    plugin_command?: string;
    hook_config?: Record<string, unknown>;
    hermes?: {
      mcp_server?: Record<string, unknown>;
      skill_file?: string;
    };
  };
}
