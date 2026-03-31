import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { loadConfig, getEnvsDir, ensureDirs } from "../config.js";
import { SYSTEM_PROMPT, SKELETON_PROMPT, HARNESS_PROMPT, CLARIFICATION_PROMPT } from "./prompt.js";
import { loadRegistry } from "../registry/loader.js";
import { getProviderName, getBaseURL, getCheapModel } from "../providers.js";
import type { EnvironmentSpec, RegistryTool, KairnConfig, Clarification, SkeletonSpec, HarnessContent } from "../types.js";

function buildUserMessage(intent: string, registry: RegistryTool[]): string {
  const registrySummary = registry
    .map(
      (t) =>
        `- ${t.id} (${t.type}, tier ${t.tier}, auth: ${t.auth}): ${t.description} [best_for: ${t.best_for.join(", ")}]`
    )
    .join("\n");

  return `## User Intent\n\n${intent}\n\n## Available Tool Registry\n\n${registrySummary}\n\nGenerate the EnvironmentSpec JSON now.`;
}

function buildSkeletonMessage(intent: string, registry: RegistryTool[]): string {
  const registrySummary = registry
    .map(
      (t) =>
        `- ${t.id} (${t.type}, tier ${t.tier}, auth: ${t.auth}): ${t.description} [best_for: ${t.best_for.join(", ")}]`
    )
    .join("\n");

  return `## User Intent\n\n${intent}\n\n## Available Tool Registry\n\n${registrySummary}\n\nGenerate the skeleton JSON now.`;
}

function buildHarnessMessage(intent: string, skeleton: SkeletonSpec, concise?: boolean): string {
  const skeletonJson = JSON.stringify(skeleton, null, 2);
  const conciseNote = concise
    ? "\n\nIMPORTANT: Be concise. Maximum 80 lines for claude_md. Maximum 5 commands. Keep all content brief."
    : "";
  return `## User Intent\n\n${intent}\n\n## Project Skeleton\n\n${skeletonJson}\n\nGenerate the harness content JSON now.${conciseNote}`;
}

function parseSpecResponse(text: string): Omit<EnvironmentSpec, "id" | "intent" | "created_at"> {
  let cleaned = text.trim();
  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  // Try to extract JSON if there's surrounding text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      "LLM response did not contain valid JSON. Try again or use a different model."
    );
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error(
      `Failed to parse LLM response as JSON: ${err instanceof Error ? err.message : String(err)}\n` +
      `Response started with: ${cleaned.slice(0, 200)}...`
    );
  }
}

function parseSkeletonResponse(text: string): SkeletonSpec {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Pass 1 (skeleton) did not return valid JSON.");
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    // Validate required fields
    if (!parsed.name || !parsed.tools || !Array.isArray(parsed.tools)) {
      throw new Error("Skeleton missing required fields: name, tools");
    }
    return parsed as SkeletonSpec;
  } catch (err) {
    throw new Error(
      `Failed to parse skeleton JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function parseHarnessResponse(text: string): HarnessContent {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Pass 2 (harness) did not return valid JSON.");
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.claude_md || !parsed.commands) {
      throw new Error("Harness missing required fields: claude_md, commands");
    }
    return parsed as HarnessContent;
  } catch (err) {
    throw new Error(
      `Failed to parse harness JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function classifyError(err: unknown, provider: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  const code = (err as { code?: string })?.code;

  // Network errors
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT") {
    return `Network error: could not reach ${provider} API. Check your internet connection.`;
  }

  // Auth errors
  if (status === 401 || msg.includes("invalid") && msg.includes("key")) {
    return `Invalid API key for ${provider}. Run \`kairn init\` to reconfigure.`;
  }
  if (status === 403) {
    return `Access denied by ${provider}. Your API key may lack permissions for this model.`;
  }

  // Rate limiting
  if (status === 429 || msg.includes("rate limit") || msg.includes("quota")) {
    return `Rate limited by ${provider}. Wait a moment and try again, or switch to a cheaper model with \`kairn init\`.`;
  }

  // Model errors
  if (status === 404 || msg.includes("not found") || msg.includes("does not exist")) {
    return `Model not found on ${provider}. Run \`kairn init\` to select a valid model.`;
  }

  // Overloaded
  if (status === 529 || status === 503 || msg.includes("overloaded")) {
    return `${provider} is temporarily overloaded. Try again in a few seconds.`;
  }

  // Token/context limit
  if (msg.includes("token") && (msg.includes("limit") || msg.includes("exceed"))) {
    return `Request too large for the selected model. Try a shorter workflow description.`;
  }

  // Billing
  if (msg.includes("billing") || msg.includes("payment") || msg.includes("insufficient")) {
    return `Billing issue with your ${provider} account. Check your account dashboard.`;
  }

  // Fallback
  return `${provider} API error: ${msg}`;
}

async function callLLM(
  config: KairnConfig,
  userMessage: string,
  options?: { maxTokens?: number; systemPrompt?: string }
): Promise<string> {
  const maxTokens = options?.maxTokens ?? 8192;
  const systemPrompt = options?.systemPrompt ?? SYSTEM_PROMPT;
  const providerName = getProviderName(config.provider);

  if (config.provider === "anthropic") {
    const client = new Anthropic({ apiKey: config.api_key });
    try {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });
      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text response from compiler LLM");
      }
      return textBlock.text;
    } catch (err) {
      throw new Error(classifyError(err, providerName));
    }
  }

  // All other providers use OpenAI-compatible API
  const resolvedBaseURL = getBaseURL(config.provider, config.base_url);
  const clientOptions: { apiKey: string; baseURL?: string } = { apiKey: config.api_key };
  if (resolvedBaseURL) clientOptions.baseURL = resolvedBaseURL;

  const client = new OpenAI(clientOptions);
  try {
    const response = await client.chat.completions.create({
      model: config.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });
    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error("No text response from compiler LLM");
    }
    return text;
  } catch (err) {
    throw new Error(classifyError(err, providerName));
  }
}

function buildSettings(skeleton: SkeletonSpec, registry: RegistryTool[]): Record<string, unknown> {
  const selectedTools = skeleton.tools
    .map((t) => registry.find((r) => r.id === t.tool_id))
    .filter(Boolean);

  // Build permissions based on workflow type
  const allow = ["Read", "Write", "Edit", "Bash(npm run *)", "Bash(npx *)"];
  const deny = [
    "Bash(rm -rf *)",
    "Bash(curl * | sh)",
    "Bash(wget * | sh)",
    "Read(./.env)",
    "Read(./secrets/**)",
  ];

  // Build hooks
  const hooks: Record<string, unknown[]> = {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command:
              "CMD=$(cat | jq -r '.tool_input.command // empty') && echo \"$CMD\" | grep -qiE 'rm\\s+-rf\\s+/|DROP\\s+TABLE|curl.*\\|\\s*sh' && echo 'Blocked destructive command' >&2 && exit 2 || true",
          },
        ],
      },
    ],
    PostCompact: [
      {
        matcher: "",
        hooks: [
          {
            type: "prompt",
            prompt:
              "Re-read CLAUDE.md and docs/SPRINT.md (if it exists) to restore project context after compaction.",
          },
        ],
      },
    ],
  };

  // Add formatter hook if project uses common formatters
  const techStack = skeleton.outline.tech_stack.map((t) => t.toLowerCase());
  if (
    techStack.some((t) => t.includes("typescript") || t.includes("javascript") || t.includes("react") || t.includes("next"))
  ) {
    hooks.PostToolUse = [
      {
        matcher: "Edit|Write",
        hooks: [
          {
            type: "command",
            command:
              'FILE=$(cat | jq -r \'.tool_input.file_path // empty\') && [ -n "$FILE" ] && npx prettier --write "$FILE" 2>/dev/null || true',
          },
        ],
      },
    ];
  }

  return { permissions: { allow, deny }, hooks };
}

function buildMcpConfig(skeleton: SkeletonSpec, registry: RegistryTool[]): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const tool of skeleton.tools) {
    const reg = registry.find((r) => r.id === tool.tool_id);
    if (reg?.install.mcp_config) {
      config[tool.tool_id] = reg.install.mcp_config;
    }
  }
  return config;
}

function validateSpec(spec: EnvironmentSpec, onProgress?: (msg: string) => void): void {
  const warnings: string[] = [];

  if (spec.tools.length > 8) {
    warnings.push(`${spec.tools.length} MCP servers selected (recommended: ≤6)`);
  }

  if (spec.harness.claude_md) {
    const lines = spec.harness.claude_md.split('\n').length;
    if (lines > 150) {
      warnings.push(`CLAUDE.md is ${lines} lines (recommended: ≤150)`);
    }
  }

  if (spec.harness.skills && Object.keys(spec.harness.skills).length > 5) {
    warnings.push(`${Object.keys(spec.harness.skills).length} skills (recommended: ≤3)`);
  }

  for (const warning of warnings) {
    onProgress?.(`⚠ ${warning}`);
  }
}

export async function compile(
  intent: string,
  onProgress?: (msg: string) => void
): Promise<EnvironmentSpec> {
  const config = await loadConfig();
  if (!config) {
    throw new Error("No config found. Run `kairn init` first.");
  }

  onProgress?.("Loading tool registry...");
  const registry = await loadRegistry();

  // Pass 1: Skeleton (tool selection + project outline)
  onProgress?.("Analyzing workflow...");
  const skeletonMsg = buildSkeletonMessage(intent, registry);
  const skeletonText = await callLLM(config, skeletonMsg, {
    maxTokens: 2048,
    systemPrompt: SKELETON_PROMPT,
  });
  const skeleton = parseSkeletonResponse(skeletonText);

  // Pass 2: Harness content (CLAUDE.md + commands + rules + agents)
  onProgress?.("Generating environment...");
  const harnessMsg = buildHarnessMessage(intent, skeleton);
  let harness: HarnessContent;
  try {
    const harnessText = await callLLM(config, harnessMsg, {
      maxTokens: 8192,
      systemPrompt: HARNESS_PROMPT,
    });
    harness = parseHarnessResponse(harnessText);
  } catch {
    // Retry with concise mode if Pass 2 fails (likely JSON truncation)
    onProgress?.("Retrying with concise mode...");
    const retryMsg = buildHarnessMessage(intent, skeleton, true);
    const retryText = await callLLM(config, retryMsg, {
      maxTokens: 8192,
      systemPrompt: HARNESS_PROMPT,
    });
    harness = parseHarnessResponse(retryText);
  }

  // Pass 3: Settings + MCP config (deterministic, no LLM)
  onProgress?.("Configuring tools...");
  const settings = buildSettings(skeleton, registry);
  const mcpConfig = buildMcpConfig(skeleton, registry);

  // Assemble final EnvironmentSpec
  const spec: EnvironmentSpec = {
    id: `env_${crypto.randomUUID()}`,
    intent,
    created_at: new Date().toISOString(),
    name: skeleton.name,
    description: skeleton.description,
    autonomy_level: 1,
    tools: skeleton.tools,
    harness: {
      claude_md: harness.claude_md,
      settings,
      mcp_config: mcpConfig,
      commands: harness.commands,
      rules: harness.rules,
      skills: harness.skills ?? {},
      agents: harness.agents ?? {},
      docs: harness.docs,
    },
  };

  validateSpec(spec, onProgress);

  // Save to ~/.kairn/envs/
  await ensureDirs();
  const envPath = path.join(getEnvsDir(), `${spec.id}.json`);
  await fs.writeFile(envPath, JSON.stringify(spec, null, 2), "utf-8");

  return spec;
}

export async function generateClarifications(
  intent: string,
  onProgress?: (msg: string) => void
): Promise<Clarification[]> {
  const config = await loadConfig();
  if (!config) {
    throw new Error("No config found. Run `kairn init` first.");
  }

  onProgress?.("Analyzing your request...");

  // Use the cheapest model for clarifications regardless of selected compilation model
  const clarificationConfig = { ...config };
  clarificationConfig.model = getCheapModel(config.provider, config.model);

  const response = await callLLM(clarificationConfig, CLARIFICATION_PROMPT + "\n\nUser description: " + intent);

  try {
    let cleaned = response.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as Clarification[];
  } catch {
    return [];
  }
}
