/**
 * @rule-writer -- Specialist agent that generates RuleNode[] during compilation.
 *
 * Given a list of rule names from the skeleton spec, this agent calls the LLM
 * to produce path-scoped rule content. It guarantees that `security` and
 * `continuity` rules always exist in the output -- injecting sensible defaults
 * if the LLM omits them.
 */

import { callLLM } from '../../llm.js';
import { createRuleNode } from '../../ir/types.js';
import type { RuleNode } from '../../ir/types.js';
import type { KairnConfig, SkeletonSpec } from '../../types.js';
import type { AgentTask, AgentResult } from './types.js';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the @rule-writer specialist inside the Kairn compilation pipeline.

Your job is to generate Claude Code rule files (.claude/rules/*.md) for a project.

Each rule file may be **global** (applies everywhere) or **path-scoped** (applies only
when the user edits files matching certain globs).

## Output format

Return a JSON array. Each element:

{
  "name": "rule-slug",
  "content": "Markdown content of the rule file.",
  "paths": null
}

- **name**: kebab-case slug (e.g. "security", "api-conventions", "testing").
- **content**: The full Markdown body of the rule. Be specific, actionable, and concise.
  Write imperative statements ("Do X", "Never Y"). Avoid vague advice.
- **paths**: Either null (global rule) or a string array of glob patterns
  (e.g. ["src/api/**", "src/routes/**"]).

## Required rules

Every project MUST include:
1. **security** -- baseline security constraints (no secrets in code, input validation,
   safe file I/O, no dynamic code execution, deny dangerous shell patterns).
2. **continuity** -- project memory rules (update decision logs, learning docs, track
   TODO progress, document gotchas).

If the user's rule list doesn't mention these, generate them anyway.

## Guidelines

- Rules should be 5-20 lines of Markdown each.
- Use bullet points for lists of constraints.
- Path-scoped rules are for conventions that only matter in specific directories
  (e.g. API conventions for src/api/**, test rules for **/*.test.ts).
- Global rules apply to the whole project (security, continuity, git workflow).
- Do NOT include YAML frontmatter in the content -- the paths field handles scoping.
- Return ONLY the JSON array. No explanation, no wrapping text.`;

// ---------------------------------------------------------------------------
// Default rules (injected when LLM omits them)
// ---------------------------------------------------------------------------

const DEFAULT_SECURITY_CONTENT = [
  '# Security Rules',
  '',
  '- NEVER log or echo API keys, tokens, or secrets',
  '- NEVER write secrets to files outside designated config locations',
  '- NEVER execute user-provided strings as shell commands',
  '- NEVER use dynamic code execution with untrusted input',
  '- Validate all external input before processing',
  '- Sanitize all file paths -- prevent path traversal (../)',
  '- Deny dangerous shell patterns: rm -rf /, curl|sh, wget|sh',
].join('\n');

const DEFAULT_CONTINUITY_CONTENT = [
  '# Continuity',
  '',
  'After every significant decision or discovery:',
  '',
  '1. Update decision logs with what was decided and why',
  '2. Document non-obvious behavior, gotchas, and footguns',
  '3. Update task status as work progresses',
  '4. If a mistake is corrected, add it to the known gotchas section',
  '',
  'These files are the project memory. Keep them current.',
].join('\n');

// ---------------------------------------------------------------------------
// JSON parsing with code-fence stripping
// ---------------------------------------------------------------------------

interface RawLLMRule {
  name: string;
  content: string;
  paths: string[] | null;
}

/**
 * Strip markdown code fences from an LLM response and parse as JSON.
 *
 * LLMs frequently wrap JSON in code fence blocks. This function
 * handles that gracefully.
 */
function parseRulesJSON(raw: string): RawLLMRule[] {
  let cleaned = raw.trim();

  // Strip leading ```json or ``` and trailing ```
  const fenceStart = /^```(?:json)?\s*\n?/;
  const fenceEnd = /\n?```\s*$/;
  if (fenceStart.test(cleaned)) {
    cleaned = cleaned.replace(fenceStart, '').replace(fenceEnd, '');
  }

  const parsed: unknown = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    throw new Error('Expected JSON array from rule-writer LLM response');
  }

  return parsed as RawLLMRule[];
}

// ---------------------------------------------------------------------------
// Build user message from parameters
// ---------------------------------------------------------------------------

function buildUserMessage(
  intent: string,
  skeleton: SkeletonSpec,
  task: AgentTask,
): string {
  const lines: string[] = [
    '## Project intent',
    intent,
    '',
    '## Rules to generate',
    ...task.items.map((item) => `- ${item}`),
    '',
    '## Project context',
    JSON.stringify(skeleton.outline, null, 2),
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate Claude Code rule files via the rule-writer specialist agent.
 *
 * Calls the LLM to generate rule content for the given rule names, then
 * ensures `security` and `continuity` rules are always present.
 *
 * @param intent - The user's natural-language project description
 * @param skeleton - The Pass 1 skeleton with tech stack and outline
 * @param task - The agent task containing rule names in `items`
 * @param config - Kairn config for LLM access
 * @returns An `AgentResult` with `agent: 'rule-writer'` and generated rules
 */
export async function generateRules(
  intent: string,
  skeleton: SkeletonSpec,
  task: AgentTask,
  config: KairnConfig,
): Promise<AgentResult> {
  // Short-circuit: no items means no rules to generate
  if (task.items.length === 0) {
    return { agent: 'rule-writer', rules: [] };
  }

  const userMessage = buildUserMessage(intent, skeleton, task);

  const raw = await callLLM(config, userMessage, {
    systemPrompt: SYSTEM_PROMPT,
    cacheControl: true,
    maxTokens: task.max_tokens,
  });

  const parsedRules = parseRulesJSON(raw);

  // Convert raw LLM output to RuleNode[] using the factory
  const rules: RuleNode[] = parsedRules.map((r) =>
    createRuleNode(
      r.name,
      r.content,
      r.paths !== null ? r.paths : undefined,
    ),
  );

  // Ensure required rules exist -- inject defaults if missing
  ensureRequiredRule(rules, 'security', DEFAULT_SECURITY_CONTENT);
  ensureRequiredRule(rules, 'continuity', DEFAULT_CONTINUITY_CONTENT);

  return { agent: 'rule-writer', rules };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Ensure a named rule exists in the array; if not, prepend a default.
 */
function ensureRequiredRule(
  rules: RuleNode[],
  name: string,
  defaultContent: string,
): void {
  const exists = rules.some((r) => r.name === name);
  if (!exists) {
    // Prepend so required rules appear first
    rules.unshift(createRuleNode(name, defaultContent));
  }
}
