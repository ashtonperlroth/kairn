export type LLMProvider = "anthropic" | "openai" | "google";

export interface KairnConfig {
  provider: LLMProvider;
  api_key: string;
  model: string;
  default_runtime: string;
  created_at: string;
}

export interface ToolSelection {
  tool_id: string;
  reason: string;
}

export interface EnvironmentSpec {
  id: string;
  name: string;
  description: string;
  intent: string;
  created_at: string;
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
