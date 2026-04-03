/**
 * @agent-writer — specialist agent that generates AgentNode[] during compilation.
 *
 * Given a list of agent names (from the skeleton outline) and the user intent,
 * this module calls the LLM to produce fully-formed agent definitions with
 * persona, model hints, disallowedTools, and modelRouting.
 *
 * Batching: if items.length > 8, splits into batches of 6 and merges results.
 */

import { callLLM } from '../../llm.js';
import type { KairnConfig, SkeletonSpec } from '../../types.js';
import type { AgentNode } from '../../ir/types.js';
import type { AgentTask, AgentResult } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum items per LLM call before batching kicks in. */
const BATCH_THRESHOLD = 8;

/** Items per batch when batching is active. */
const BATCH_SIZE = 6;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const AGENT_WRITER_SYSTEM_PROMPT = `You are an expert at designing Claude Code agent personas for the .claude/agents/ directory.

Each agent file uses YAML frontmatter followed by Markdown persona content.

## YAML Frontmatter Conventions
- \`model\`: optional model hint — "opus" for complex reasoning, "sonnet" for balanced, "haiku" for fast/cheap
- \`disallowedTools\`: optional string array of tools the agent should NOT use (e.g. ["Bash", "Write"])
- \`modelRouting\`: optional object for dynamic model selection:
  - \`default\`: base model tier ("haiku", "sonnet", or "opus")
  - \`escalateTo\`: higher tier to escalate to ("sonnet" or "opus")
  - \`escalateWhen\`: description of when to escalate

## Persona Design Principles
- Each agent has a clear, focused role (single responsibility)
- Persona should describe expertise, approach, and boundaries
- Include specific instructions for the agent's domain
- Use second person ("You are...")
- Be concrete about what the agent should and should not do
- Include relevant workflow steps or checklists where appropriate

## Model Tiering Guidelines
- "haiku": formatting, linting, simple lookups, boilerplate generation
- "sonnet": most development tasks, code review, testing, refactoring
- "opus": architecture decisions, complex debugging, cross-cutting changes, security audits

## Output Format
Return a JSON array. Each element:
{
  "name": "agent-name-kebab-case",
  "content": "You are the ... (full persona markdown)",
  "model": "sonnet",
  "disallowedTools": ["Bash"],
  "modelRouting": { "default": "sonnet", "escalateTo": "opus", "escalateWhen": "cross-cutting changes" }
}

Only include model, disallowedTools, and modelRouting when they add value. Not every agent needs all fields.

Return ONLY the JSON array, no surrounding text or code fences.`;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Strip markdown code fences from an LLM response and parse the JSON array.
 */
function parseAgentResponse(text: string): unknown[] {
  let cleaned = text.trim();

  // Strip code fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  // Extract JSON array
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Validate and transform a raw parsed agent object into an AgentNode.
 * Returns null if the object is missing required fields.
 */
function toAgentNode(raw: unknown): AgentNode | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  // Require non-empty name and content
  if (typeof obj['name'] !== 'string' || !obj['name']) {
    return null;
  }
  if (typeof obj['content'] !== 'string' || !obj['content']) {
    return null;
  }

  const node: AgentNode = {
    name: obj['name'],
    content: obj['content'],
  };

  // Optional model
  if (typeof obj['model'] === 'string' && obj['model']) {
    node.model = obj['model'];
  }

  // Optional disallowedTools
  if (Array.isArray(obj['disallowedTools'])) {
    const tools = obj['disallowedTools'].filter(
      (t): t is string => typeof t === 'string' && t.length > 0,
    );
    if (tools.length > 0) {
      node.disallowedTools = tools;
    }
  }

  // Optional modelRouting
  if (typeof obj['modelRouting'] === 'object' && obj['modelRouting'] !== null) {
    const routing = obj['modelRouting'] as Record<string, unknown>;
    const defaultModel = routing['default'];
    if (
      defaultModel === 'haiku' ||
      defaultModel === 'sonnet' ||
      defaultModel === 'opus'
    ) {
      const modelRouting: AgentNode['modelRouting'] = {
        default: defaultModel,
      };

      const escalateTo = routing['escalateTo'];
      if (escalateTo === 'sonnet' || escalateTo === 'opus') {
        modelRouting.escalateTo = escalateTo;
      }

      const escalateWhen = routing['escalateWhen'];
      if (typeof escalateWhen === 'string' && escalateWhen) {
        modelRouting.escalateWhen = escalateWhen;
      }

      node.modelRouting = modelRouting;
    }
  }

  return node;
}

// ---------------------------------------------------------------------------
// User message construction
// ---------------------------------------------------------------------------

/**
 * Build the user message sent to the LLM for a batch of agent names.
 */
function buildUserMessage(
  items: string[],
  intent: string,
  phaseAContext?: string,
): string {
  const parts: string[] = [];

  parts.push(`## User Intent\n\n${intent}`);

  if (phaseAContext) {
    parts.push(`## Project Context (from Phase A)\n\n${phaseAContext}`);
  }

  parts.push(
    `## Agents to Generate\n\nCreate agent persona definitions for each of these agents:\n${items.map((item) => `- ${item}`).join('\n')}`,
  );

  parts.push(
    'Generate the JSON array now. One object per agent listed above.',
  );

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

/**
 * Split an array into chunks of the given size.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate AgentNode[] via the agent-writer specialist agent.
 *
 * Produces agent persona definitions from a list of agent names and user intent.
 * Batches into multiple LLM calls if items.length > 8 (batches of 6).
 *
 * @param intent - The user's natural-language project description
 * @param skeleton - The Pass 1 skeleton (unused directly, available for future context)
 * @param task - The agent task with items (agent names to generate)
 * @param config - Kairn configuration with provider, API key, and model
 * @returns An `AgentResult` with `agent: 'agent-writer'` and generated agents
 */
export async function generateAgents(
  intent: string,
  _skeleton: SkeletonSpec,
  task: AgentTask,
  config: KairnConfig,
): Promise<AgentResult> {
  // Short-circuit: no items means no agents
  if (task.items.length === 0) {
    return { agent: 'agent-writer', agents: [] };
  }

  // Determine whether batching is needed
  const needsBatching = task.items.length > BATCH_THRESHOLD;
  const batches = needsBatching
    ? chunk(task.items, BATCH_SIZE)
    : [task.items];

  const allAgents: AgentNode[] = [];

  for (const batch of batches) {
    const userMessage = buildUserMessage(batch, intent, task.context_hint);

    const response = await callLLM(config, userMessage, {
      systemPrompt: AGENT_WRITER_SYSTEM_PROMPT,
      cacheControl: true,
      maxTokens: task.max_tokens,
    });

    const rawAgents = parseAgentResponse(response);
    for (const raw of rawAgents) {
      const node = toAgentNode(raw);
      if (node !== null) {
        allAgents.push(node);
      }
    }
  }

  return { agent: 'agent-writer', agents: allAgents };
}
