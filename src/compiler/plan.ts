/**
 * @orchestrator — Compilation plan generator.
 *
 * Takes user intent + skeleton and produces a CompilationPlan that determines
 * which specialist agents to invoke and in what order. Falls back to a
 * deterministic default plan when the LLM call fails or returns invalid JSON.
 */

import { callLLM } from '../llm.js';
import type { KairnConfig, SkeletonSpec } from '../types.js';
import type { CompilationPlan, CompilationPhase, AgentTask } from './agents/types.js';
import { validatePlan } from './agents/types.js';

// ---------------------------------------------------------------------------
// Orchestrator system prompt
// ---------------------------------------------------------------------------

const ORCHESTRATOR_PROMPT = `You are the Kairn compilation planner. Given a project skeleton and user intent, produce a CompilationPlan JSON that determines what to generate and in what order.

## Agent Types
- sections-writer: generates CLAUDE.md sections (Purpose, Tech Stack, Commands, Architecture, Conventions, Key Commands, Output, Verification, Known Gotchas, Debugging, Git Workflow, Engineering Standards)
- rule-writer: generates .claude/rules/ files (security, continuity, plus project-specific)
- doc-writer: generates .claude/docs/ files (DECISIONS, LEARNINGS, SPRINT)
- command-writer: generates .claude/commands/ files (help, build, test, status, fix, develop, sprint, spec, prove, grill, persist, etc.)
- agent-writer: generates .claude/agents/ files (architect, planner, implementer, fixer, doc-updater, qa-orchestrator, linter, e2e-tester)
- skill-writer: generates .claude/skills/ files (tdd, etc.)

## Phase Rules
- Phase A (no dependencies): sections-writer, rule-writer, doc-writer
- Phase B (depends on Phase A): command-writer, agent-writer, skill-writer (optional)
- Phase C (depends on Phase B): reserved for linker (NOT included in plan — it runs separately)

## Token Budgets
- sections-writer: 4096, command-writer: 4096, agent-writer: 4096
- rule-writer: 2048, doc-writer: 2048, skill-writer: 2048

## Output Format
Return ONLY valid JSON:
{
  "project_context": "2-3 sentence project summary",
  "phases": [
    {
      "id": "phase-a",
      "agents": [
        { "agent": "sections-writer", "items": ["purpose", "tech-stack", "commands", ...], "max_tokens": 4096 },
        { "agent": "rule-writer", "items": ["security", "continuity", ...], "max_tokens": 2048 },
        { "agent": "doc-writer", "items": ["DECISIONS", "LEARNINGS", "SPRINT"], "max_tokens": 2048 }
      ],
      "dependsOn": []
    },
    {
      "id": "phase-b",
      "agents": [...],
      "dependsOn": ["phase-a"]
    }
  ]
}`;

// ---------------------------------------------------------------------------
// Standard section items for CLAUDE.md
// ---------------------------------------------------------------------------

const STANDARD_SECTION_ITEMS = [
  'purpose',
  'tech-stack',
  'commands',
  'architecture',
  'conventions',
  'key-commands',
  'output',
  'verification',
  'gotchas',
  'debugging',
  'git-workflow',
] as const;

// ---------------------------------------------------------------------------
// Standard doc items
// ---------------------------------------------------------------------------

const STANDARD_DOC_ITEMS = ['DECISIONS', 'LEARNINGS', 'SPRINT'] as const;

// ---------------------------------------------------------------------------
// Token budgets per agent
// ---------------------------------------------------------------------------

const TOKEN_BUDGETS: Record<string, number> = {
  'sections-writer': 4096,
  'command-writer': 4096,
  'agent-writer': 4096,
  'rule-writer': 2048,
  'doc-writer': 2048,
  'skill-writer': 2048,
} as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a CompilationPlan via the orchestrator LLM.
 *
 * Falls back to `generateDefaultPlan()` if the LLM call fails,
 * returns invalid JSON, or the JSON fails validation.
 *
 * @param intent - The user's natural language intent
 * @param skeleton - The skeleton spec from Pass 1
 * @param config - Kairn configuration with LLM provider settings
 * @returns A validated CompilationPlan
 */
export async function generatePlan(
  intent: string,
  skeleton: SkeletonSpec,
  config: KairnConfig,
): Promise<CompilationPlan> {
  try {
    const userMessage = buildPlanMessage(intent, skeleton);
    const response = await callLLM(config, userMessage, {
      systemPrompt: ORCHESTRATOR_PROMPT,
      maxTokens: 2048,
      cacheControl: true,
    });
    const parsed = parsePlanResponse(response);
    return validatePlan(parsed);
  } catch {
    return generateDefaultPlan(skeleton);
  }
}

/**
 * Generate a deterministic default CompilationPlan without LLM.
 *
 * Used as the fallback when the orchestrator LLM call fails.
 * Produces a standard 2-phase plan based on the skeleton's outline.
 *
 * @param skeleton - The skeleton spec from Pass 1
 * @returns A CompilationPlan with Phase A and Phase B
 */
export function generateDefaultPlan(skeleton: SkeletonSpec): CompilationPlan {
  const projectContext = `${skeleton.name}: ${skeleton.description}`;

  // Phase A: sections + rules + docs (no dependencies)
  const sectionItems = [...STANDARD_SECTION_ITEMS];

  const ruleItems = ['security', 'continuity', ...skeleton.outline.custom_rules];

  const docItems = [...STANDARD_DOC_ITEMS];

  const phaseA: CompilationPhase = {
    id: 'phase-a',
    agents: [
      { agent: 'sections-writer', items: sectionItems, max_tokens: TOKEN_BUDGETS['sections-writer'] },
      { agent: 'rule-writer', items: ruleItems, max_tokens: TOKEN_BUDGETS['rule-writer'] },
      { agent: 'doc-writer', items: docItems, max_tokens: TOKEN_BUDGETS['doc-writer'] },
    ],
    dependsOn: [],
  };

  // Phase B: commands + agents (optional) + skills (optional), depends on Phase A
  const commandItems = ['help', ...skeleton.outline.key_commands];

  const phaseBAgents: AgentTask[] = [
    { agent: 'command-writer', items: commandItems, max_tokens: TOKEN_BUDGETS['command-writer'] },
  ];

  if (skeleton.outline.custom_agents.length > 0) {
    phaseBAgents.push({
      agent: 'agent-writer',
      items: skeleton.outline.custom_agents,
      max_tokens: TOKEN_BUDGETS['agent-writer'],
    });
  }

  if (skeleton.outline.custom_skills.length > 0) {
    phaseBAgents.push({
      agent: 'skill-writer',
      items: skeleton.outline.custom_skills,
      max_tokens: TOKEN_BUDGETS['skill-writer'],
    });
  }

  const phaseB: CompilationPhase = {
    id: 'phase-b',
    agents: phaseBAgents,
    dependsOn: ['phase-a'],
  };

  return {
    project_context: projectContext,
    phases: [phaseA, phaseB],
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the user message for the orchestrator LLM call.
 */
function buildPlanMessage(intent: string, skeleton: SkeletonSpec): string {
  return [
    '## Intent',
    intent,
    '',
    '## Skeleton',
    JSON.stringify(skeleton, null, 2),
    '',
    'Generate the CompilationPlan JSON now.',
  ].join('\n');
}

/**
 * Parse the raw LLM response text into a JSON object.
 *
 * Handles markdown code fences and extracts the first JSON object found.
 *
 * @throws {Error} if no valid JSON object is found
 */
function parsePlanResponse(text: string): unknown {
  let cleaned = text.trim();

  // Strip markdown code fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  // Extract the first JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Orchestrator did not return valid JSON');
  }

  return JSON.parse(jsonMatch[0]) as unknown;
}
