/**
 * @sections-writer specialist agent.
 *
 * Generates CLAUDE.md `Section[]` nodes from a project description and skeleton.
 * Each section is a heading-delimited block of markdown content (purpose, tech-stack,
 * commands, architecture, conventions, etc.).
 */

import { callLLM } from '../../llm.js';
import type { KairnConfig, SkeletonSpec } from '../../types.js';
import type { AgentTask, AgentResult } from './types.js';
import type { Section } from '../../ir/types.js';
import { createSection } from '../../ir/types.js';

const SECTIONS_SYSTEM_PROMPT = `You are the Kairn sections writer. Generate CLAUDE.md sections for a development environment.

You will receive a project description and a list of section IDs to generate. Each section should be well-structured markdown.

## Standard Sections (generate those requested)
- purpose: Project purpose and goals (## Purpose heading, but use project-specific title like "# ProjectName Development")
- tech-stack: Languages, frameworks, tools (## Tech Stack)
- commands: Build/dev/test commands (## Commands, use code blocks)
- architecture: Project structure (## Architecture, use code blocks for tree)
- conventions: Coding conventions (## Conventions, bullet points)
- key-commands: Slash commands reference (## Key Commands, bullet list)
- output: Build output paths (## Output)
- verification: Post-edit verification steps (## Verification)
- gotchas: Known issues and footguns (## Known Gotchas)
- debugging: Debugging tips (## Debugging)
- git-workflow: Git conventions (## Git Workflow)
- engineering-standards: Code quality standards (## Engineering Standards)

## Rules
- Each section: 5-20 lines of content
- Use project-specific details, not generic advice
- Markdown formatting: headers, bullets, code blocks
- Be concise but informative

## Output Format
Return a JSON array:
[
  { "id": "purpose", "heading": "# ProjectName Development", "content": "..." },
  { "id": "tech-stack", "heading": "## Tech Stack", "content": "..." }
]`;

/**
 * Generate CLAUDE.md sections via the sections-writer specialist agent.
 *
 * Produces `Section[]` nodes by calling the LLM with a structured prompt
 * derived from the intent, skeleton, and task items. Returns an empty
 * sections array immediately when `task.items` is empty (no LLM call).
 *
 * @param intent - The user's natural-language project description
 * @param skeleton - The Pass 1 skeleton with tech stack and outline
 * @param task - The agent task specifying which section IDs to generate
 * @param config - Kairn configuration (provider, API key, model)
 * @returns An `AgentResult` with `agent: 'sections-writer'` and `sections: Section[]`
 */
export async function generateSections(
  intent: string,
  skeleton: SkeletonSpec,
  task: AgentTask,
  config: KairnConfig,
): Promise<AgentResult> {
  if (task.items.length === 0) {
    return { agent: 'sections-writer', sections: [] };
  }

  const userMessage = buildUserMessage(intent, skeleton, task);

  const response = await callLLM(config, userMessage, {
    systemPrompt: SECTIONS_SYSTEM_PROMPT,
    maxTokens: task.max_tokens,
    agentName: 'sections-writer',
    cacheControl: true,
  });

  const sections = parseSectionsResponse(response);
  return { agent: 'sections-writer', sections };
}

/**
 * Build the user message sent to the LLM, combining intent, skeleton details,
 * and the specific section IDs requested by the task.
 */
function buildUserMessage(
  intent: string,
  skeleton: SkeletonSpec,
  task: AgentTask,
): string {
  const parts: string[] = [
    `## Project\n${intent}`,
    `## Tech Stack\n${skeleton.outline.tech_stack.join(', ')}`,
    `## Workflow\n${skeleton.outline.workflow_type}`,
    `## Sections to Generate\n${task.items.join(', ')}`,
  ];

  if (task.context_hint) {
    parts.push(`## Additional Context\n${task.context_hint}`);
  }

  parts.push('Generate the sections JSON array now.');

  return parts.join('\n\n');
}

/**
 * Parse the LLM response text into `Section[]`.
 *
 * Handles several common LLM output formats:
 * - Plain JSON array
 * - JSON wrapped in ```json code fences
 * - JSON array preceded by explanatory text
 *
 * Falls back to extracting the first `[...]` match from the text.
 *
 * @throws {Error} If no JSON array can be extracted from the response
 */
function parseSectionsResponse(text: string): Section[] {
  let cleaned = text.trim();

  // Strip code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  // Extract the JSON array from potentially noisy text
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(
      'sections-writer: response did not contain a JSON array',
    );
  }

  const parsed: unknown = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) {
    throw new Error('sections-writer: expected JSON array');
  }

  return parsed.map((item: unknown, index: number) => {
    const obj = item as Record<string, unknown>;
    return createSection(
      String(obj.id ?? `section-${index}`),
      String(obj.heading ?? ''),
      String(obj.content ?? ''),
      index,
    );
  });
}
