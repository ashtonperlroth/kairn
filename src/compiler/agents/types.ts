/**
 * Multi-agent compilation pipeline types.
 *
 * Defines the plan structure, agent task definitions, result discriminated union,
 * and the TruncationError class used when an agent exceeds its token budget.
 */

import type {
  Section,
  CommandNode,
  RuleNode,
  AgentNode,
  SkillNode,
  DocNode,
} from "../../ir/types.js";

// ---------------------------------------------------------------------------
// Agent names
// ---------------------------------------------------------------------------

/** The six specialist agent roles in the compilation pipeline. */
export type AgentName =
  | "sections-writer"
  | "command-writer"
  | "agent-writer"
  | "rule-writer"
  | "doc-writer"
  | "skill-writer";

/** Runtime-accessible list of all valid agent names. */
export const VALID_AGENT_NAMES: readonly AgentName[] = [
  "sections-writer",
  "command-writer",
  "agent-writer",
  "rule-writer",
  "doc-writer",
  "skill-writer",
] as const;

// ---------------------------------------------------------------------------
// Compilation plan types
// ---------------------------------------------------------------------------

/** Top-level plan produced by the planner agent and consumed by the orchestrator. */
export interface CompilationPlan {
  project_context: string;
  phases: CompilationPhase[];
}

/** A single phase of compilation — agents within a phase run in parallel. */
export interface CompilationPhase {
  id: string;
  agents: AgentTask[];
  dependsOn: string[];
}

/** A task assigned to a single specialist agent. */
export interface AgentTask {
  agent: AgentName;
  items: string[];
  context_hint?: string;
  max_tokens: number;
}

// ---------------------------------------------------------------------------
// Agent results (discriminated union)
// ---------------------------------------------------------------------------

/** Discriminated union of results returned by each specialist agent. */
export type AgentResult =
  | { agent: "sections-writer"; sections: Section[] }
  | { agent: "command-writer"; commands: CommandNode[] }
  | { agent: "agent-writer"; agents: AgentNode[] }
  | { agent: "rule-writer"; rules: RuleNode[] }
  | { agent: "doc-writer"; docs: DocNode[] }
  | { agent: "skill-writer"; skills: SkillNode[] };

// ---------------------------------------------------------------------------
// TruncationError
// ---------------------------------------------------------------------------

/** Thrown when an agent's output exceeds its allocated token budget. */
export class TruncationError extends Error {
  public readonly agentName: string;
  public readonly tokensUsed: number;

  constructor(
    message: string,
    options: { agentName: string; tokensUsed: number },
  ) {
    super(message);
    this.name = "TruncationError";
    this.agentName = options.agentName;
    this.tokensUsed = options.tokensUsed;
  }
}

// ---------------------------------------------------------------------------
// Runtime validator
// ---------------------------------------------------------------------------

/**
 * Validate that an unknown value conforms to the CompilationPlan shape.
 *
 * Throws a descriptive Error if validation fails.
 * Returns the validated plan (typed) on success.
 */
export function validatePlan(plan: unknown): CompilationPlan {
  if (plan == null || typeof plan !== "object") {
    throw new Error("CompilationPlan must be a non-null object");
  }

  const obj = plan as Record<string, unknown>;

  // -- project_context --
  if (typeof obj["project_context"] !== "string") {
    throw new Error(
      "CompilationPlan.project_context must be a string",
    );
  }
  if (obj["project_context"].length === 0) {
    throw new Error(
      "CompilationPlan.project_context must not be empty",
    );
  }

  // -- phases --
  if (!Array.isArray(obj["phases"])) {
    throw new Error("CompilationPlan.phases must be an array");
  }
  if (obj["phases"].length === 0) {
    throw new Error(
      "CompilationPlan.phases must contain at least one phase",
    );
  }

  for (let pi = 0; pi < obj["phases"].length; pi++) {
    validatePhase(obj["phases"][pi], pi);
  }

  return plan as CompilationPlan;
}

/** Validate a single CompilationPhase within a plan. */
function validatePhase(phase: unknown, index: number): void {
  if (phase == null || typeof phase !== "object") {
    throw new Error(`phases[${index}] must be a non-null object`);
  }

  const obj = phase as Record<string, unknown>;

  // -- id --
  if (typeof obj["id"] !== "string") {
    throw new Error(`phases[${index}].id must be a string`);
  }

  // -- agents --
  if (!Array.isArray(obj["agents"])) {
    throw new Error(`phases[${index}].agents must be an array`);
  }

  for (let ai = 0; ai < obj["agents"].length; ai++) {
    validateAgentTask(obj["agents"][ai], index, ai);
  }

  // -- dependsOn --
  if (!Array.isArray(obj["dependsOn"])) {
    throw new Error(`phases[${index}].dependsOn must be an array`);
  }
}

/** Validate a single AgentTask within a phase. */
function validateAgentTask(
  task: unknown,
  phaseIndex: number,
  taskIndex: number,
): void {
  if (task == null || typeof task !== "object") {
    throw new Error(
      `phases[${phaseIndex}].agents[${taskIndex}] must be a non-null object`,
    );
  }

  const obj = task as Record<string, unknown>;
  const prefix = `phases[${phaseIndex}].agents[${taskIndex}]`;

  // -- agent name --
  if (typeof obj["agent"] !== "string") {
    throw new Error(`${prefix}.agent must be a string`);
  }
  if (
    !(VALID_AGENT_NAMES as readonly string[]).includes(obj["agent"])
  ) {
    throw new Error(
      `${prefix}.agent "${obj["agent"]}" is not a valid agent name. ` +
        `Valid names: ${VALID_AGENT_NAMES.join(", ")}`,
    );
  }

  // -- items --
  if (!Array.isArray(obj["items"])) {
    throw new Error(`${prefix}.items must be an array`);
  }

  // -- max_tokens --
  if (typeof obj["max_tokens"] !== "number") {
    throw new Error(`${prefix}.max_tokens must be a number`);
  }
}
