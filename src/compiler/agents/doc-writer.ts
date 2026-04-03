/**
 * @doc-writer specialist agent — generates `DocNode[]` during compilation.
 *
 * Produces structured documentation files (DECISIONS, LEARNINGS, SPRINT, etc.)
 * for the `.claude/docs/` directory. Always ensures the three required docs
 * (DECISIONS, LEARNINGS, SPRINT) are present, injecting sensible defaults
 * when the LLM omits them.
 */

import { callLLM } from '../../llm.js';
import type { KairnConfig, SkeletonSpec } from '../../types.js';
import type { DocNode } from '../../ir/types.js';
import type { AgentTask, AgentResult } from './types.js';

// ---------------------------------------------------------------------------
// Default templates for required docs
// ---------------------------------------------------------------------------

const DEFAULT_DECISIONS = `# Decisions

| Date | Decision | Rationale |
|------|----------|-----------|`;

const DEFAULT_LEARNINGS = `# Learnings

| Date | Learning | Impact |
|------|----------|--------|`;

const DEFAULT_SPRINT = `# Sprint

## Acceptance Criteria

- [ ] Criterion 1

## Status

Not started`;

const REQUIRED_DOCS: ReadonlyArray<{ name: string; defaultContent: string }> = [
  { name: 'DECISIONS', defaultContent: DEFAULT_DECISIONS },
  { name: 'LEARNINGS', defaultContent: DEFAULT_LEARNINGS },
  { name: 'SPRINT', defaultContent: DEFAULT_SPRINT },
];

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/** System prompt for the doc-writer specialist agent. */
export const DOC_WRITER_SYSTEM_PROMPT = `You are the doc-writer specialist agent in a multi-agent compilation pipeline.

Your role: generate documentation files for a Claude Code agent environment's \`.claude/docs/\` directory.

## Output Format

Return a JSON array of objects, each with "name" (string) and "content" (string):

\`\`\`json
[
  { "name": "DECISIONS", "content": "# Decisions\\n\\n| Date | Decision | Rationale |\\n|------|----------|-----------|" },
  { "name": "LEARNINGS", "content": "# Learnings\\n\\n| Date | Learning | Impact |\\n|------|----------|--------|" }
]
\`\`\`

## Document Templates

Each doc should follow these structural patterns:

- **DECISIONS**: Markdown table with Date, Decision, Rationale columns. Track architectural and design choices.
- **LEARNINGS**: Markdown table with Date, Learning, Impact columns. Track non-obvious discoveries and gotchas.
- **SPRINT**: Must include an "## Acceptance Criteria" section with checkbox items (\`- [ ] ...\`) and a "## Status" section. Track current sprint goals.

## Guidelines

- Content should be tailored to the project intent provided
- Use Markdown formatting with clear headers
- Acceptance Criteria in SPRINT docs must use checkbox format: \`- [ ] Criterion\`
- Keep templates practical — they'll be filled in during development
- Return ONLY the JSON array, no surrounding text`;

// ---------------------------------------------------------------------------
// Code-fence stripping
// ---------------------------------------------------------------------------

/**
 * Strip markdown code fences and trim whitespace from an LLM response.
 *
 * Handles both ````json ... ```` and bare ```` ... ```` fences.
 */
export function stripCodeFences(raw: string): string {
  let text = raw.trim();
  // Strip ```json or ``` opening fence
  const openFence = /^```(?:json)?\s*\n/;
  if (openFence.test(text)) {
    text = text.replace(openFence, '');
  }
  // Strip closing ``` fence
  const closeFence = /\n```\s*$/;
  if (closeFence.test(text)) {
    text = text.replace(closeFence, '');
  }
  return text.trim();
}

// ---------------------------------------------------------------------------
// Core agent function
// ---------------------------------------------------------------------------

/**
 * Generate documentation files via the doc-writer specialist agent.
 *
 * Given an `AgentTask` with a list of doc names to produce, calls the LLM
 * to generate documentation content, then ensures the three required docs
 * (DECISIONS, LEARNINGS, SPRINT) are always present.
 *
 * @param intent - The user's natural-language project description
 * @param skeleton - The Pass 1 skeleton with tech stack and outline
 * @param task - The agent task with item names
 * @param config - Kairn configuration for the LLM call
 * @returns An `AgentResult` with `agent: 'doc-writer'` and generated docs
 */
export async function generateDocs(
  intent: string,
  skeleton: SkeletonSpec,
  task: AgentTask,
  config: KairnConfig,
): Promise<AgentResult> {
  // Early return for empty items — no docs to generate
  if (task.items.length === 0) {
    return { agent: 'doc-writer', docs: [] };
  }

  const userMessage = buildUserMessage(intent, skeleton, task);

  const rawResponse = await callLLM(config, userMessage, {
    systemPrompt: DOC_WRITER_SYSTEM_PROMPT,
    cacheControl: true,
    maxTokens: task.max_tokens,
  });

  const parsedDocs = parseDocResponse(rawResponse);
  const docs = ensureRequiredDocs(parsedDocs);

  return { agent: 'doc-writer', docs };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the user message for the LLM call.
 */
function buildUserMessage(
  intent: string,
  _skeleton: SkeletonSpec,
  task: AgentTask,
): string {
  const itemList = task.items.map((item) => `- ${item}`).join('\n');
  return `Project intent: ${intent}

Generate the following documentation files:
${itemList}

Return a JSON array of { "name": string, "content": string } objects.`;
}

/**
 * Type guard: checks whether `value` has the shape `{ name: string; content: string }`.
 */
function isDocShape(value: unknown): value is { name: string; content: string } {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.name === 'string' && typeof obj.content === 'string';
}

/**
 * Parse the LLM response into an array of DocNode objects.
 *
 * Strips code fences and validates the parsed structure.
 */
function parseDocResponse(raw: string): DocNode[] {
  const cleaned = stripCodeFences(raw);
  const parsed: unknown = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isDocShape).map(({ name, content }) => ({ name, content }));
}

/**
 * Ensure the three required docs (DECISIONS, LEARNINGS, SPRINT) are present.
 *
 * If any required doc is missing from the LLM output, injects a sensible default.
 * Does not overwrite LLM-provided versions of these docs.
 */
function ensureRequiredDocs(docs: DocNode[]): DocNode[] {
  const result = [...docs];
  const existingNames = new Set(result.map((d) => d.name));

  for (const required of REQUIRED_DOCS) {
    if (!existingNames.has(required.name)) {
      result.push({
        name: required.name,
        content: required.defaultContent,
      });
    }
  }

  return result;
}
