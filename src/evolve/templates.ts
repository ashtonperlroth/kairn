import { callLLM } from '../llm.js';
import type { KairnConfig } from '../types.js';
import type { ProjectAnalysis } from '../analyzer/types.js';
import type { EvalTemplate, ProjectProfileSummary, Task, TemplateCategory } from './types.js';

interface TemplateMetadata {
  id: EvalTemplate;
  name: string;
  description: string;
  bestFor: string[];
  /** Whether this template tests harness sensitivity or substantive SWE-bench-style work. */
  category: TemplateCategory;
}

export const EVAL_TEMPLATES: Record<EvalTemplate, TemplateMetadata> = {
  // --- Harness-sensitivity templates (probe whether agent follows .claude/ harness) ---
  'add-feature': {
    id: 'add-feature',
    name: 'Add Feature',
    description: 'Can the agent add a new capability?',
    bestFor: ['feature-development', 'api-building', 'full-stack'],
    category: 'harness-sensitivity',
  },
  'fix-bug': {
    id: 'fix-bug',
    name: 'Fix Bug',
    description: 'Can the agent diagnose and fix a problem?',
    bestFor: ['maintenance', 'debugging', 'qa'],
    category: 'harness-sensitivity',
  },
  'refactor': {
    id: 'refactor',
    name: 'Refactor',
    description: 'Can the agent restructure code?',
    bestFor: ['maintenance', 'architecture', 'backend'],
    category: 'harness-sensitivity',
  },
  'test-writing': {
    id: 'test-writing',
    name: 'Test Writing',
    description: 'Can the agent write tests?',
    bestFor: ['tdd', 'qa', 'backend'],
    category: 'harness-sensitivity',
  },
  'config-change': {
    id: 'config-change',
    name: 'Config Change',
    description: 'Can the agent update configuration?',
    bestFor: ['devops', 'infrastructure', 'backend'],
    category: 'harness-sensitivity',
  },
  'documentation': {
    id: 'documentation',
    name: 'Documentation',
    description: 'Can the agent write and update docs?',
    bestFor: ['content', 'api-building', 'full-stack'],
    category: 'harness-sensitivity',
  },
  'convention-adherence': {
    id: 'convention-adherence',
    name: 'Convention Adherence',
    description: 'Does the agent follow all project conventions defined in CLAUDE.md?',
    bestFor: ['feature-development', 'full-stack', 'backend', 'maintenance'],
    category: 'harness-sensitivity',
  },
  'workflow-compliance': {
    id: 'workflow-compliance',
    name: 'Workflow Compliance',
    description: 'Does the agent use the project workflow commands and skills?',
    bestFor: ['feature-development', 'full-stack', 'tdd', 'qa'],
    category: 'harness-sensitivity',
  },
  'rule-compliance': {
    id: 'rule-compliance',
    name: 'Rule Compliance',
    description: 'Does the agent follow all project rules without violations?',
    bestFor: ['feature-development', 'backend', 'maintenance', 'architecture'],
    category: 'harness-sensitivity',
  },
  'intent-routing': {
    id: 'intent-routing',
    name: 'Intent Routing',
    description: 'Test that natural language prompts route to the correct workflow command via intent hooks',
    bestFor: ['feature-development', 'full-stack', 'api-building'],
    category: 'harness-sensitivity',
  },
  'persistence-completion': {
    id: 'persistence-completion',
    name: 'Persistence Completion',
    description: 'Can the agent complete a multi-criterion task using the persistence loop?',
    bestFor: ['feature-development', 'full-stack', 'api-building', 'maintenance'],
    category: 'harness-sensitivity',
  },

  // --- Substantive SWE-bench-style templates (test real coding ability) ---
  'real-bug-fix': {
    id: 'real-bug-fix',
    name: 'Real Bug Fix',
    description: 'Injects a known bug into a source file and asks the agent to diagnose and fix it, mimicking a real GitHub issue',
    bestFor: ['debugging', 'maintenance', 'qa', 'backend'],
    category: 'substantive',
  },
  'real-feature-add': {
    id: 'real-feature-add',
    name: 'Real Feature Add',
    description: 'Describes a concrete feature with clear acceptance criteria and verifies the agent implements it correctly',
    bestFor: ['feature-development', 'full-stack', 'api-building', 'backend'],
    category: 'substantive',
  },
  'codebase-question': {
    id: 'codebase-question',
    name: 'Codebase Question',
    description: 'Asks a factual question about codebase knowledge and checks the answer via LLM-as-judge against a known-correct answer',
    bestFor: ['research', 'architecture', 'maintenance', 'debugging'],
    category: 'substantive',
  },
};

/**
 * Substantive templates are always included in every eval suite.
 * These test real coding ability and are the highest-signal evaluations.
 */
const SUBSTANTIVE_FLOOR: EvalTemplate[] = [
  'real-bug-fix',
  'real-feature-add',
  'codebase-question',
];

/** Maximum harness-sensitivity templates to pair with the substantive floor. */
const MAX_HARNESS_TEMPLATES = 4;

/**
 * Select eval templates appropriate for a given workflow type.
 *
 * All three substantive templates (real-bug-fix, real-feature-add,
 * codebase-question) are always included. Up to 4 workflow-specific
 * harness-sensitivity templates are added on top, giving a ~3:4
 * substantive-to-harness ratio and a stable eval signal.
 */
export function selectTemplatesForWorkflow(workflowType: string): EvalTemplate[] {
  const harnessMapping: Record<string, EvalTemplate[]> = {
    'feature-development': ['add-feature', 'test-writing', 'intent-routing', 'convention-adherence', 'workflow-compliance', 'persistence-completion'],
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
  const harness = (harnessMapping[workflowType] ?? ['add-feature', 'fix-bug', 'test-writing', 'convention-adherence'])
    .slice(0, MAX_HARNESS_TEMPLATES);
  return [...SUBSTANTIVE_FLOOR, ...harness];
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

SUBSTANTIVE SWE-bench-style templates test real coding ability beyond harness adherence:
- real-bug-fix: Inject a known bug into a source file (e.g., swap variable names, remove an import, introduce an off-by-one error). Write the task description like a real GitHub issue: "When X happens, Y is broken." The setup command should apply the bug. Scorer: run the test suite or check the specific file was fixed correctly. Use scoring "pass-fail".
- real-feature-add: Describe a concrete feature with clear acceptance criteria (e.g., "Add a --verbose flag that prints debug output"). The feature should be small, self-contained, and testable. Scorer: verify the feature exists, tests pass, and no regressions. Use scoring "pass-fail" or "rubric".
- codebase-question: Ask a factual question about the codebase that requires reading and understanding source code (e.g., "What function handles authentication?" or "What environment variables does this project need?"). Include the known-correct answer in expected_outcome. Scorer: LLM-as-judge checks answer accuracy against the known-correct answer. Use scoring "llm-judge".

Each task MUST include a "category" field:
- "harness-sensitivity" for templates that test .claude/ harness adherence
- "substantive" for SWE-bench-style templates that test real coding ability

Return a JSON object with a "tasks" array. Each task has:
- id: kebab-case identifier (e.g., "add-health-endpoint")
- template: which eval template this instantiates
- description: concrete task description the agent will receive
- setup: shell commands to prepare the workspace (e.g., "npm install")
- expected_outcome: multi-line string describing what success looks like
- scoring: "pass-fail", "llm-judge", or "rubric"
- category: "harness-sensitivity" or "substantive"
- timeout: seconds (300 for features/bugs, 600 for refactors, 180 for config/docs/tests)

BALANCE REQUIREMENT: Generate an equal number of harness-sensitivity tasks and substantive tasks. If you are given N templates total, aim for ceil(N/2) harness-sensitivity tasks and floor(N/2) substantive tasks. Do not skew toward one category.

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
 * Build a structured project analysis section for the LLM task generation prompt.
 *
 * Extracts key modules, workflows, architecture, config keys, and other
 * domain-specific context from a ProjectAnalysis to help the LLM generate
 * tasks that reference actual project components.
 */
function buildAnalysisContext(analysis: ProjectAnalysis): string {
  const lines: string[] = ["## Project Analysis", ""];

  // Purpose and domain
  lines.push(`Purpose: ${analysis.purpose}`);
  lines.push(`Domain: ${analysis.domain}`);
  lines.push(`Architecture: ${analysis.architecture_style}`);
  lines.push(`Deployment: ${analysis.deployment_model}`);
  lines.push("");

  // Key modules with paths and responsibilities
  if (analysis.key_modules.length > 0) {
    lines.push("### Key Modules");
    lines.push("");
    for (const mod of analysis.key_modules) {
      lines.push(`- **${mod.name}** (${mod.path}): ${mod.description}`);
      if (mod.responsibilities.length > 0) {
        lines.push(`  Responsibilities: ${mod.responsibilities.join(", ")}`);
      }
    }
    lines.push("");
  }

  // Workflows
  if (analysis.workflows.length > 0) {
    lines.push("### Workflows");
    lines.push("");
    for (const wf of analysis.workflows) {
      lines.push(`- **${wf.name}**: ${wf.description} (trigger: ${wf.trigger})`);
      lines.push(`  Steps: ${wf.steps.join(" -> ")}`);
    }
    lines.push("");
  }

  // Config keys
  if (analysis.config_keys.length > 0) {
    lines.push("### Config Keys");
    lines.push("");
    for (const key of analysis.config_keys) {
      lines.push(`- ${key.name}: ${key.purpose}`);
    }
    lines.push("");
  }

  // Dataflow edges
  if (analysis.dataflow.length > 0) {
    lines.push("### Data Flow");
    lines.push("");
    for (const edge of analysis.dataflow) {
      lines.push(`- ${edge.from} -> ${edge.to}: ${edge.data}`);
    }
    lines.push("");
  }

  lines.push("IMPORTANT: Use this analysis to generate domain-specific tasks:");
  lines.push("- real-bug-fix tasks should reference actual module names and paths listed above");
  lines.push("- codebase-question tasks should ask about actual workflows, modules, and config keys");
  lines.push("- real-feature-add tasks should extend actual functionality in the modules listed above");

  return lines.join("\n");
}

/**
 * Build the user message for LLM task generation.
 *
 * When a ProjectAnalysis is provided, enriches the prompt with domain-specific
 * context including module names, paths, workflows, and config keys so the LLM
 * can generate tasks that reference actual project components.
 */
function buildTaskGenerationMessage(
  claudeMd: string,
  projectProfile: ProjectProfileSummary,
  templates: EvalTemplate[],
  analysis?: ProjectAnalysis,
): string {
  const profileLines = [
    `Languages: ${projectProfile.languages.length > 0 ? projectProfile.languages.join(', ') : "unknown"}`,
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

  const sections = [
    "## CLAUDE.md",
    "",
    claudeMd,
    "",
    "## Project Profile",
    "",
    ...profileLines,
    "",
  ];

  // Insert analysis context when available
  if (analysis) {
    sections.push(buildAnalysisContext(analysis));
    sections.push("");
  }

  sections.push(
    "## Selected Eval Templates",
    "",
    templateDescriptions,
    "",
    "Generate concrete, project-specific tasks for each template above.",
  );

  return sections.join("\n");
}

/**
 * Use the LLM to generate project-specific eval tasks from eval templates.
 *
 * Sends the project's CLAUDE.md, profile summary, and selected templates
 * to the LLM, then parses and validates the returned task definitions.
 * When a ProjectAnalysis is provided, enriches the prompt with domain-specific
 * context so generated tasks reference actual project modules and workflows.
 *
 * @param claudeMd - Contents of the project's CLAUDE.md
 * @param projectProfile - Lightweight project info (language, framework, etc.)
 * @param templates - Which eval templates to instantiate
 * @param config - Kairn configuration with provider, API key, and model
 * @param analysis - Optional ProjectAnalysis for domain-specific task generation
 * @returns Validated array of Task objects
 */
export async function generateTasksFromTemplates(
  claudeMd: string,
  projectProfile: ProjectProfileSummary,
  templates: EvalTemplate[],
  config: KairnConfig,
  analysis?: ProjectAnalysis,
): Promise<Task[]> {
  const userMessage = buildTaskGenerationMessage(claudeMd, projectProfile, templates, analysis);

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
