import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { loadConfig, getEnvsDir, ensureDirs } from "../config.js";
import { SYSTEM_PROMPT, SKELETON_PROMPT, CLARIFICATION_PROMPT } from "./prompt.js";
import { loadRegistry } from "../registry/loader.js";
import { getCheapModel } from "../providers.js";
import { callLLM } from "../llm.js";
import { generatePlan } from "./plan.js";
import { executePlan } from "./batch.js";
import { linkHarness } from "./linker.js";
import { dispatchAgent } from "./agents/dispatch.js";
import { renderClaudeMd } from "../ir/renderer.js";
import type { EnvironmentSpec, RegistryTool, Clarification, SkeletonSpec, CompileProgress, IntentPattern } from "../types.js";
import type { HarnessIR } from "../ir/types.js";
import type { AgentTask, AgentResult } from "./agents/types.js";
import type { BatchProgress } from "./batch.js";

function buildSkeletonMessage(intent: string, registry: RegistryTool[]): string {
  const registrySummary = registry
    .map(
      (t) =>
        `- ${t.id} (${t.type}, tier ${t.tier}, auth: ${t.auth}): ${t.description} [best_for: ${t.best_for.join(", ")}]`
    )
    .join("\n");

  return `## User Intent\n\n${intent}\n\n## Available Tool Registry\n\n${registrySummary}\n\nGenerate the skeleton JSON now.`;
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

/**
 * Build settings.json content (permissions + hooks) derived from the skeleton's tech stack.
 *
 * Permissions are dynamically derived from `skeleton.outline.tech_stack`:
 * - Read/Write/Edit are always allowed
 * - Language-specific CLI tools are added based on detected languages
 * - Falls back to npm/npx if no language-specific stack is recognized
 *
 * Hooks include:
 * - PreToolUse: destructive command blocker (always)
 * - PostCompact: context restore prompt (always)
 * - PostToolUse: formatter hooks (prettier for JS/TS, ruff for Python)
 */
export function buildSettings(skeleton: SkeletonSpec, registry: RegistryTool[]): Record<string, unknown> {
  const _selectedTools = skeleton.tools
    .map((t) => registry.find((r) => r.id === t.tool_id))
    .filter(Boolean);

  const techStack = skeleton.outline.tech_stack.map((t) => t.toLowerCase());

  // Build permissions dynamically from tech stack
  const allow: string[] = ["Read", "Write", "Edit"];

  if (techStack.some((t) => t.includes("python"))) {
    allow.push("Bash(python *)", "Bash(pip *)", "Bash(pytest *)", "Bash(uv *)");
  }
  if (techStack.some((t) => t.includes("typescript") || t.includes("javascript") || t.includes("node"))) {
    allow.push("Bash(npm run *)", "Bash(npx *)");
  }
  if (techStack.some((t) => t.includes("rust"))) {
    allow.push("Bash(cargo *)");
  }
  if (techStack.some((t) => t.includes("go") || t.includes("golang"))) {
    allow.push("Bash(go *)");
  }
  if (techStack.some((t) => t.includes("ruby"))) {
    allow.push("Bash(bundle *)", "Bash(rake *)");
  }
  if (techStack.some((t) => t.includes("docker"))) {
    allow.push("Bash(docker *)", "Bash(docker compose *)");
  }

  // Fallback: if no language-specific permissions matched, add a safe default
  if (allow.length === 3) {
    allow.push("Bash(npm run *)", "Bash(npx *)");
  }

  // Determine if project uses env vars (tools requiring auth, or .env-based config)
  const usesEnvVars = skeleton.tools.some((t) => {
    const reg = registry.find((r) => r.id === t.tool_id);
    return reg?.auth === 'api_key' || (reg?.env_vars && reg.env_vars.length > 0);
  });

  const deny: string[] = [
    "Bash(rm -rf *)",
    "Bash(curl * | sh)",
    "Bash(wget * | sh)",
    "Read(./secrets/**)",
  ];
  // Only deny .env reads when project doesn't use env vars
  if (!usesEnvVars) {
    deny.push("Read(./.env)");
  }

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

  // Add prettier formatter hook for JS/TS projects
  if (
    techStack.some((t) => t.includes("typescript") || t.includes("javascript") || t.includes("react") || t.includes("next"))
  ) {
    if (!hooks.PostToolUse) hooks.PostToolUse = [];
    (hooks.PostToolUse as unknown[]).push({
      matcher: "Edit|Write",
      hooks: [
        {
          type: "command",
          command:
            'FILE=$(cat | jq -r \'.tool_input.file_path // empty\') && [ -n "$FILE" ] && npx prettier --write "$FILE" 2>/dev/null || true',
        },
      ],
    });
  }

  // Add ruff formatter hook for Python projects
  if (techStack.some((t) => t.includes("python"))) {
    if (!hooks.PostToolUse) hooks.PostToolUse = [];
    (hooks.PostToolUse as unknown[]).push({
      matcher: "Edit|Write",
      hooks: [
        {
          type: "command",
          command:
            'FILE=$(cat | jq -r \'.tool_input.file_path // empty\') && [ -n "$FILE" ] && [[ "$FILE" == *.py ]] && ruff format "$FILE" 2>/dev/null || true',
        },
      ],
    });
  }

  // Add doc-update prompt hook — nudges Claude to update living docs
  // after meaningful changes (architectural decisions, debugging insights, etc.)
  if (!hooks.PostToolUse) hooks.PostToolUse = [];
  (hooks.PostToolUse as unknown[]).push({
    matcher: "Write|Edit",
    hooks: [
      {
        type: "prompt",
        prompt: "If this change involves an architectural decision, debugging insight, or task completion, consider updating .claude/docs/. Only update if genuinely useful — don't add noise.",
      },
    ],
  });

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

function validateSpec(spec: EnvironmentSpec): string[] {
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

  return warnings;
}

/**
 * Compile a natural language intent into a full EnvironmentSpec.
 *
 * Uses a multi-agent pipeline:
 *   Pass 1: LLM generates a SkeletonSpec (tool selection + outline)
 *   Pass 2: @orchestrator generates a CompilationPlan
 *   Pass 3: Specialist agents execute in phased batches → HarnessIR, then @linker validates
 *   Pass 4: Deterministic assembly (settings, MCP, intent routing)
 */
export async function compile(
  intent: string,
  onProgress?: (progress: CompileProgress) => void
): Promise<EnvironmentSpec> {
  const startTime = Date.now();
  const config = await loadConfig();
  if (!config) {
    throw new Error("No config found. Run `kairn init` first.");
  }

  // Registry
  onProgress?.({ phase: 'registry', status: 'running', message: 'Loading tool registry...' });
  const registry = await loadRegistry();
  onProgress?.({ phase: 'registry', status: 'success', message: 'Tool registry loaded', detail: `${registry.length} tools` });

  // Pass 1: Skeleton (tool selection + project outline)
  onProgress?.({ phase: 'pass1', status: 'running', message: 'Pass 1: Analyzing workflow & selecting tools...' });
  const skeletonMsg = buildSkeletonMessage(intent, registry);
  const skeletonText = await callLLM(config, skeletonMsg, {
    maxTokens: 2048,
    systemPrompt: SKELETON_PROMPT,
  });
  const skeleton = parseSkeletonResponse(skeletonText);
  const toolNames = skeleton.tools.map(t => t.tool_id).join(', ');
  onProgress?.({
    phase: 'pass1', status: 'success',
    message: `Pass 1: Selected ${skeleton.tools.length} tools`,
    detail: toolNames,
    elapsed: (Date.now() - startTime) / 1000,
  });

  // Pass 2: Compilation plan (@orchestrator)
  onProgress?.({ phase: 'plan', status: 'running', message: 'Pass 2: Planning compilation...' });
  const plan = await generatePlan(intent, skeleton, config);
  const agentCount = plan.phases.reduce((sum, p) => sum + p.agents.length, 0);
  onProgress?.({
    phase: 'plan', status: 'success',
    message: `Pass 2: Compilation plan — ${agentCount} agents across ${plan.phases.length} phases`,
    elapsed: (Date.now() - startTime) / 1000,
  });

  // Pass 3: Execute specialist agents → HarnessIR
  const concurrency = config.auth_type === 'claude-code-oauth' ? 2 : 3;
  const executeAgent = (task: AgentTask): Promise<AgentResult> => dispatchAgent(task, config, intent, skeleton);

  // Map batch progress to CompileProgress
  const batchProgress = (bp: BatchProgress): void => {
    if (bp.status === 'start') {
      const phaseLabel = bp.phaseId as CompileProgress['phase'];
      const detail = bp.detail ? ` (${bp.detail})` : '';
      onProgress?.({ phase: phaseLabel, status: 'running', message: `Pass 3 (${bp.phaseId}): Running ${bp.agentCount} agents${detail}...` });
    } else if (bp.status === 'complete') {
      const phaseLabel = bp.phaseId as CompileProgress['phase'];
      onProgress?.({ phase: phaseLabel, status: 'success', message: `Pass 3 (${bp.phaseId}): Complete`, elapsed: (Date.now() - startTime) / 1000 });
    }
  };
  const rawIR = await executePlan(plan, executeAgent, concurrency, batchProgress);

  // Link: cross-reference validation
  onProgress?.({ phase: 'phase-c', status: 'running', message: 'Pass 3c: Cross-reference validation...' });
  const { ir: linkedIR, report } = linkHarness(rawIR);
  const ir: HarnessIR = linkedIR;
  if (report.warnings.length > 0) {
    for (const w of report.warnings) {
      onProgress?.({ phase: 'phase-c', status: 'warning', message: `⚠ ${w}` });
    }
  }
  onProgress?.({ phase: 'phase-c', status: 'success', message: 'Pass 3c: Cross-reference validation', elapsed: (Date.now() - startTime) / 1000 });

  // Pass 4: Deterministic assembly (settings, MCP, intents)
  onProgress?.({ phase: 'assembly', status: 'running', message: 'Pass 4: Configuring MCP servers & settings...' });
  const settings = buildSettings(skeleton, registry);
  const mcpConfig = buildMcpConfig(skeleton, registry);

  // Intent routing removed in v2.12 — replaced by "Available Commands" section in CLAUDE.md
  const intentPatterns: IntentPattern[] = [];
  const intentPromptTemplate = '';
  const intentHooks: Record<string, string> = {};

  // Collect env vars from selected tools for CLAUDE.md documentation
  const envVars: Array<{ name: string; description: string }> = [];
  for (const tool of skeleton.tools) {
    const reg = registry.find((r) => r.id === tool.tool_id);
    if (reg?.env_vars) {
      for (const ev of reg.env_vars) {
        envVars.push({ name: ev.name, description: ev.description });
      }
    }
  }

  onProgress?.({ phase: 'assembly', status: 'success', message: 'Pass 4: Configured MCP servers & settings' });

  // Populate flat harness fields from IR (backward compatibility)
  const commands: Record<string, string> = {};
  for (const cmd of ir.commands) { commands[cmd.name] = cmd.content; }
  const rules: Record<string, string> = {};
  for (const rule of ir.rules) { rules[rule.name] = rule.content; }
  const agents: Record<string, string> = {};
  for (const agent of ir.agents) { agents[agent.name] = agent.content; }
  const skills: Record<string, string> = {};
  for (const skill of ir.skills) { skills[skill.name] = skill.content; }
  const docs: Record<string, string> = {};
  for (const doc of ir.docs) { docs[doc.name] = doc.content; }

  // Assemble final EnvironmentSpec
  const spec: EnvironmentSpec = {
    id: `env_${crypto.randomUUID()}`,
    intent,
    created_at: new Date().toISOString(),
    name: skeleton.name,
    description: skeleton.description,
    autonomy_level: 1,
    tools: skeleton.tools,
    ir,
    harness: {
      claude_md: renderClaudeMd(
        ir.meta,
        ir.sections,
        ir.commands.map(c => ({
          name: c.name,
          description: c.content.split('\n').find(line => line.trim() && !line.startsWith('#'))?.trim() || c.name,
        })),
        envVars.length > 0 ? envVars : undefined,
      ),
      settings,
      mcp_config: mcpConfig,
      commands,
      rules,
      skills,
      agents,
      docs,
      hooks: intentHooks,
      intent_patterns: intentPatterns,
      intent_prompt_template: intentPromptTemplate,
    },
  };

  const warnings = validateSpec(spec);
  for (const w of warnings) {
    onProgress?.({ phase: 'done', status: 'warning', message: `⚠ ${w}` });
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  onProgress?.({ phase: 'done', status: 'success', message: `Environment compiled in ${totalElapsed}s`, elapsed: (Date.now() - startTime) / 1000 });

  // Save to ~/.kairn/envs/
  await ensureDirs();
  const envPath = path.join(getEnvsDir(), `${spec.id}.json`);
  await fs.writeFile(envPath, JSON.stringify(spec, null, 2), "utf-8");

  return spec;
}

/**
 * Generate clarifying questions for an ambiguous intent.
 *
 * Uses the cheapest available model to minimize cost. This function
 * is unrelated to the multi-agent pipeline — it runs before compilation.
 */
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

  const response = await callLLM(clarificationConfig, CLARIFICATION_PROMPT + "\n\nUser description: " + intent, {
    systemPrompt: SYSTEM_PROMPT,
  });

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
