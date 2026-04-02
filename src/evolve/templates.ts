import { callLLM } from '../llm.js';
import type { KairnConfig } from '../types.js';
import type { EvalTemplate, ProjectProfileSummary, Task } from './types.js';

interface TemplateMetadata {
  id: EvalTemplate;
  name: string;
  description: string;
  bestFor: string[];
}

export const EVAL_TEMPLATES: Record<EvalTemplate, TemplateMetadata> = {
  'add-feature': {
    id: 'add-feature',
    name: 'Add Feature',
    description: 'Can the agent add a new capability?',
    bestFor: ['feature-development', 'api-building', 'full-stack'],
  },
  'fix-bug': {
    id: 'fix-bug',
    name: 'Fix Bug',
    description: 'Can the agent diagnose and fix a problem?',
    bestFor: ['maintenance', 'debugging', 'qa'],
  },
  'refactor': {
    id: 'refactor',
    name: 'Refactor',
    description: 'Can the agent restructure code?',
    bestFor: ['maintenance', 'architecture', 'backend'],
  },
  'test-writing': {
    id: 'test-writing',
    name: 'Test Writing',
    description: 'Can the agent write tests?',
    bestFor: ['tdd', 'qa', 'backend'],
  },
  'config-change': {
    id: 'config-change',
    name: 'Config Change',
    description: 'Can the agent update configuration?',
    bestFor: ['devops', 'infrastructure', 'backend'],
  },
  'documentation': {
    id: 'documentation',
    name: 'Documentation',
    description: 'Can the agent write and update docs?',
    bestFor: ['content', 'api-building', 'full-stack'],
  },
  'convention-adherence': {
    id: 'convention-adherence',
    name: 'Convention Adherence',
    description: 'Does the agent follow all project conventions defined in CLAUDE.md?',
    bestFor: ['feature-development', 'full-stack', 'backend', 'maintenance'],
  },
  'workflow-compliance': {
    id: 'workflow-compliance',
    name: 'Workflow Compliance',
    description: 'Does the agent use the project workflow commands and skills?',
    bestFor: ['feature-development', 'full-stack', 'tdd', 'qa'],
  },
  'rule-compliance': {
    id: 'rule-compliance',
    name: 'Rule Compliance',
    description: 'Does the agent follow all project rules without violations?',
    bestFor: ['feature-development', 'backend', 'maintenance', 'architecture'],
  },
  'intent-routing': {
    id: 'intent-routing',
    name: 'Intent Routing',
    description: 'Test that natural language prompts route to the correct workflow command via intent hooks',
    bestFor: ['feature-development', 'full-stack', 'api-building'],
  },
  'persistence-completion': {
    id: 'persistence-completion',
    name: 'Persistence Completion',
    description: 'Can the agent complete a multi-criterion task using the persistence loop?',
    bestFor: ['feature-development', 'full-stack', 'api-building', 'maintenance'],
  },
};

/**
 * Select eval templates appropriate for a given workflow type.
 *
 * Returns a curated subset of eval templates that best match the
 * project's workflow. Falls back to a general-purpose set if the
 * workflow type is not recognized.
 */
export function selectTemplatesForWorkflow(workflowType: string): EvalTemplate[] {
  const mapping: Record<string, EvalTemplate[]> = {
    'feature-development': ['add-feature', 'test-writing', 'convention-adherence', 'workflow-compliance', 'intent-routing', 'persistence-completion'],
    'api-building': ['add-feature', 'fix-bug', 'test-writing', 'convention-adherence', 'persistence-completion'],
    'full-stack': ['add-feature', 'fix-bug', 'test-writing', 'convention-adherence', 'persistence-completion'],
    'maintenance': ['fix-bug', 'refactor', 'test-writing', 'rule-compliance', 'persistence-completion'],
    'debugging': ['fix-bug', 'test-writing', 'rule-compliance'],
    'qa': ['fix-bug', 'test-writing', 'add-feature', 'workflow-compliance'],
    'architecture': ['refactor', 'test-writing', 'config-change', 'convention-adherence'],
    'backend': ['fix-bug', 'refactor', 'config-change', 'rule-compliance'],
    'devops': ['config-change', 'fix-bug', 'rule-compliance'],
    'infrastructure': ['config-change', 'refactor', 'convention-adherence'],
    'tdd': ['test-writing', 'add-feature', 'fix-bug', 'workflow-compliance'],
    'content': ['documentation', 'add-feature', 'convention-adherence'],
    'research': ['documentation', 'add-feature', 'convention-adherence'],
  };
  return mapping[workflowType] || ['add-feature', 'fix-bug', 'test-writing', 'convention-adherence'];
}

/**
 * System prompt instructing the LLM to generate project-specific eval tasks
 * from eval templates and project context.
 */
export const TASK_GENERATION_PROMPT = `You are an eval task generator for Claude Code agent environments. Given a project's CLAUDE.md, project structure, and selected eval templates, generate concrete, project-specific tasks.

Each task must be realistic and testable against the actual project. Avoid generic placeholders.

IMPORTANT: For harness-aware templates (convention-adherence, workflow-compliance, rule-compliance), generate tasks where success DEPENDS on the agent reading and following the .claude/ harness content:
- convention-adherence: Task must require following specific conventions from CLAUDE.md (naming, file structure, patterns). Judge by whether output matches the conventions.
- workflow-compliance: Task must require using project slash commands or workflow steps defined in .claude/commands/. Judge by whether the agent followed the defined workflow.
- rule-compliance: Task must create a scenario where .claude/rules/ content is relevant. Judge by whether the agent respected all rules.
- persistence-completion: Task MUST have 3+ acceptance criteria that require sequential implementation. The task description should be a realistic feature request — the agent must parse it into criteria. Judge by: (a) all criteria met (progress.json status: complete), (b) structured tracking used (progress.json exists with 3+ criteria), (c) tests pass, (d) review gate executed (progress.json review field present).

These harness-aware tasks are critical — they test whether the .claude/ environment actually improves agent behavior.

Return a JSON object with a "tasks" array. Each task has:
- id: kebab-case identifier (e.g., "add-health-endpoint")
- template: which eval template this instantiates
- description: concrete task description the agent will receive
- setup: shell commands to prepare the workspace (e.g., "npm install")
- expected_outcome: multi-line string describing what success looks like
- scoring: "pass-fail", "llm-judge", or "rubric"
- timeout: seconds (300 for features/bugs, 600 for refactors, 180 for config/docs/tests)

Return ONLY valid JSON, no markdown fences.`;

/**
 * Parse a raw LLM response string into a JSON object.
 *
 * Strips markdown code fences if present, then extracts the first
 * top-level JSON object (`{...}`) or array (`[...]`) from the text.
 */
function parseJsonResponse(raw: string): unknown {
  let cleaned = raw.trim();

  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  // Extract first JSON object or array
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/) ?? cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(
      "LLM response did not contain valid JSON. Try again or use a different model.",
    );
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error(
      `Failed to parse LLM response as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const REQUIRED_TASK_FIELDS: ReadonlyArray<keyof Task> = [
  "id",
  "template",
  "description",
  "setup",
  "expected_outcome",
  "scoring",
  "timeout",
];

/**
 * Validate that a parsed object has all required Task fields.
 */
function validateTask(obj: unknown, index: number): Task {
  if (typeof obj !== "object" || obj === null) {
    throw new Error(`Task at index ${index} is not an object`);
  }
  const record = obj as Record<string, unknown>;

  for (const field of REQUIRED_TASK_FIELDS) {
    if (!(field in record) || record[field] === undefined || record[field] === null) {
      throw new Error(`Task at index ${index} is missing required field: ${field}`);
    }
  }

  return record as unknown as Task;
}

/**
 * Build the user message for LLM task generation.
 */
function buildTaskGenerationMessage(
  claudeMd: string,
  projectProfile: ProjectProfileSummary,
  templates: EvalTemplate[],
): string {
  const profileLines = [
    `Language: ${projectProfile.language ?? "unknown"}`,
    `Framework: ${projectProfile.framework ?? "none"}`,
    `Scripts: ${Object.entries(projectProfile.scripts).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
    `Key files: ${projectProfile.keyFiles.join(", ") || "none"}`,
  ];

  const templateDescriptions = templates
    .map((t) => {
      const meta = EVAL_TEMPLATES[t];
      return `- ${t}: ${meta.description}`;
    })
    .join("\n");

  return [
    "## CLAUDE.md",
    "",
    claudeMd,
    "",
    "## Project Profile",
    "",
    ...profileLines,
    "",
    "## Selected Eval Templates",
    "",
    templateDescriptions,
    "",
    "Generate concrete, project-specific tasks for each template above.",
  ].join("\n");
}

/**
 * Use the LLM to generate project-specific eval tasks from eval templates.
 *
 * Sends the project's CLAUDE.md, profile summary, and selected templates
 * to the LLM, then parses and validates the returned task definitions.
 *
 * @param claudeMd - Contents of the project's CLAUDE.md
 * @param projectProfile - Lightweight project info (language, framework, etc.)
 * @param templates - Which eval templates to instantiate
 * @param config - Kairn configuration with provider, API key, and model
 * @returns Validated array of Task objects
 */
export async function generateTasksFromTemplates(
  claudeMd: string,
  projectProfile: ProjectProfileSummary,
  templates: EvalTemplate[],
  config: KairnConfig,
): Promise<Task[]> {
  const userMessage = buildTaskGenerationMessage(claudeMd, projectProfile, templates);

  const rawResponse = await callLLM(config, userMessage, {
    systemPrompt: TASK_GENERATION_PROMPT,
    maxTokens: 4096,
  });

  const parsed = parseJsonResponse(rawResponse);

  // Extract tasks array from response
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("LLM response is not a JSON object");
  }

  const tasksObj = parsed as Record<string, unknown>;
  if (!Array.isArray(tasksObj.tasks)) {
    throw new Error("LLM response does not contain a 'tasks' array");
  }

  // Validate each task
  const tasks: Task[] = [];
  for (let i = 0; i < tasksObj.tasks.length; i++) {
    tasks.push(validateTask(tasksObj.tasks[i], i));
  }

  return tasks;
}
