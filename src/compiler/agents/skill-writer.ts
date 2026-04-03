/**
 * @skill-writer specialist agent.
 *
 * Generates `SkillNode[]` from a list of skill names during compilation.
 * Each skill follows the SKILL.md format with structured, multi-phase content
 * (e.g., TDD's RED/GREEN/REFACTOR pattern).
 *
 * Empty item lists short-circuit immediately without making an LLM call.
 */

import { callLLM } from "../../llm.js";
import type { KairnConfig, SkeletonSpec } from "../../types.js";
import type { SkillNode } from "../../ir/types.js";
import type { AgentTask, AgentResult } from "./types.js";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a specialist agent that writes SKILL.md files for Claude Code environments.

Each skill is a structured markdown document that teaches Claude Code a repeatable workflow pattern.

Output format: a JSON array of objects with "name" (string) and "content" (string) fields.

Rules:
- Each skill must have a clear title heading (# Skill Name)
- Use numbered phases (## Phase 1: NAME, ## Phase 2: NAME, etc.) for multi-step workflows
- Content should be actionable instructions, not theory
- Keep each skill concise: 200-400 words
- For TDD skills, always use the 3-phase pattern: RED (write failing test), GREEN (minimal implementation), REFACTOR (clean up)
- Output ONLY the JSON array, no surrounding text

Example:
[
  {
    "name": "tdd",
    "content": "# TDD Skill\\n\\n## Phase 1: RED\\nWrite a failing test first...\\n## Phase 2: GREEN\\nWrite minimal code to make the test pass...\\n## Phase 3: REFACTOR\\nClean up duplication and improve naming..."
  }
]`;

// ---------------------------------------------------------------------------
// JSON parsing helpers
// ---------------------------------------------------------------------------

/**
 * Strip markdown code fences from an LLM response.
 * Handles ```json, ```JSON, and bare ``` fences.
 */
function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fencePattern = /^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```$/;
  const match = trimmed.match(fencePattern);
  if (match) {
    return match[1].trim();
  }
  return trimmed;
}

/**
 * Parse an LLM response into SkillNode[].
 * Strips code fences before parsing JSON.
 *
 * @throws {Error} If the response is not valid JSON or not an array of skill objects.
 */
function parseSkillNodes(raw: string): SkillNode[] {
  const cleaned = stripCodeFences(raw);
  const parsed: unknown = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    throw new Error("Expected JSON array of skills from LLM response");
  }

  const skills: SkillNode[] = [];
  for (const item of parsed) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).name !== "string" ||
      typeof (item as Record<string, unknown>).content !== "string"
    ) {
      throw new Error(
        "Each skill must have a string 'name' and string 'content' field",
      );
    }
    skills.push({
      name: (item as Record<string, unknown>).name as string,
      content: (item as Record<string, unknown>).content as string,
    });
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Agent entry point
// ---------------------------------------------------------------------------

/**
 * Generate SkillNode[] via the skill-writer specialist agent.
 *
 * Produces skill definitions for the given skill names by calling the LLM.
 * Returns immediately with an empty skills array if `task.items` is empty.
 *
 * @param intent - The user's natural-language project description
 * @param skeleton - The Pass 1 skeleton (available for future context enrichment)
 * @param task - The agent task containing skill names to generate
 * @param config - Kairn configuration with provider, API key, and model
 * @returns An `AgentResult` with `agent: 'skill-writer'` and generated skills
 */
export async function generateSkills(
  _intent: string,
  _skeleton: SkeletonSpec,
  task: AgentTask,
  config: KairnConfig,
): Promise<AgentResult> {
  if (task.items.length === 0) {
    return { agent: "skill-writer", skills: [] };
  }

  const userMessage = `Generate SKILL.md content for the following skills:\n\n${task.items.map((name: string) => `- ${name}`).join("\n")}`;

  const raw = await callLLM(config, userMessage, {
    systemPrompt: SYSTEM_PROMPT,
    cacheControl: true,
    maxTokens: task.max_tokens,
  });

  const skills = parseSkillNodes(raw);

  return { agent: "skill-writer", skills };
}
