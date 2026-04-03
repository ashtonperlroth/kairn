/**
 * Batch execution engine for the multi-agent compilation pipeline.
 *
 * Executes a `CompilationPlan` phase-by-phase with concurrency control,
 * merging each agent's results into a unified `HarnessIR`.
 */

import type {
  CompilationPlan,
  AgentTask,
  AgentResult,
} from './agents/types.js';
import { TruncationError } from './agents/types.js';
import type { HarnessIR } from '../ir/types.js';
import { createEmptyIR } from '../ir/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Progress event emitted for each phase during plan execution. */
export interface BatchProgress {
  phaseId: string;
  status: 'start' | 'complete' | 'error';
  agentCount: number;
  completedCount?: number;
}

/** A function that executes a single agent task and returns its result. */
export type ExecuteAgentFn = (task: AgentTask) => Promise<AgentResult>;

// ---------------------------------------------------------------------------
// mergeIntoIR
// ---------------------------------------------------------------------------

/**
 * Merge an agent result into the appropriate collection on a HarnessIR.
 *
 * Appends items to the existing arrays — does not overwrite.
 */
export function mergeIntoIR(ir: HarnessIR, result: AgentResult): void {
  switch (result.agent) {
    case 'sections-writer':
      ir.sections.push(...result.sections);
      break;
    case 'command-writer':
      ir.commands.push(...result.commands);
      break;
    case 'agent-writer':
      ir.agents.push(...result.agents);
      break;
    case 'rule-writer':
      ir.rules.push(...result.rules);
      break;
    case 'doc-writer':
      ir.docs.push(...result.docs);
      break;
    case 'skill-writer':
      ir.skills.push(...result.skills);
      break;
  }
}

// ---------------------------------------------------------------------------
// runWithConcurrency
// ---------------------------------------------------------------------------

/**
 * Run an array of async task factories with a bounded concurrency limit.
 *
 * Returns results in the same order as the input tasks, regardless of
 * completion order. If any task throws, the error propagates after all
 * in-flight tasks settle.
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  if (tasks.length === 0) return [];

  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  let firstError: unknown = undefined;
  let hasError = false;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        results[index] = await tasks[index]();
      } catch (err) {
        if (!hasError) {
          hasError = true;
          firstError = err;
        }
        return;
      }
    }
  }

  // Start up to `limit` workers in parallel
  const workers: Promise<void>[] = [];
  const workerCount = Math.min(limit, tasks.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(runNext());
  }

  await Promise.all(workers);

  if (hasError) {
    throw firstError;
  }

  return results;
}

// ---------------------------------------------------------------------------
// executePlan
// ---------------------------------------------------------------------------

/**
 * Execute a compilation plan phase-by-phase.
 *
 * Each phase's agents run concurrently (up to `concurrency` at a time).
 * Phases execute sequentially, respecting dependency ordering.
 *
 * On `TruncationError`, the failed agent is retried once with doubled
 * `max_tokens`. If the retry also fails, the error propagates.
 *
 * @param plan - The compilation plan to execute
 * @param executeAgent - Dependency-injected function to run a single agent
 * @param concurrency - Max concurrent agents within a phase
 * @param onProgress - Optional callback for phase start/complete events
 * @returns The merged HarnessIR containing all agent outputs
 */
export async function executePlan(
  plan: CompilationPlan,
  executeAgent: ExecuteAgentFn,
  concurrency: number,
  onProgress?: (progress: BatchProgress) => void,
): Promise<HarnessIR> {
  if (plan.phases.length === 0) {
    return createEmptyIR();
  }

  // ---- Validate dependencies exist ----
  const phaseIds = new Set(plan.phases.map((p) => p.id));
  for (const phase of plan.phases) {
    for (const dep of phase.dependsOn) {
      if (!phaseIds.has(dep)) {
        throw new Error(
          `Phase "${phase.id}" depends on unknown phase "${dep}"`,
        );
      }
    }
  }

  // ---- Detect cycles via topological ordering ----
  // Build the index map for O(1) lookup
  const phaseIndex = new Map<string, number>();
  for (let i = 0; i < plan.phases.length; i++) {
    phaseIndex.set(plan.phases[i].id, i);
  }

  // A phase must not depend on a phase at the same or later position
  // (phases are expected to be topologically sorted in the array)
  for (const phase of plan.phases) {
    const myIdx = phaseIndex.get(phase.id)!;
    for (const dep of phase.dependsOn) {
      const depIdx = phaseIndex.get(dep);
      if (depIdx !== undefined && depIdx >= myIdx) {
        throw new Error(
          `Phase "${phase.id}" has a dependency ordering violation: depends on "${dep}" which is not in an earlier position`,
        );
      }
    }
  }

  // ---- Execute phases sequentially ----
  const ir = createEmptyIR();
  const completed = new Set<string>();

  for (const phase of plan.phases) {
    // Verify all dependencies completed
    for (const dep of phase.dependsOn) {
      if (!completed.has(dep)) {
        throw new Error(
          `Phase "${phase.id}" depends on incomplete phase "${dep}"`,
        );
      }
    }

    onProgress?.({
      phaseId: phase.id,
      status: 'start',
      agentCount: phase.agents.length,
    });

    // Build task factories with TruncationError retry (max 1 retry)
    const agentTasks = phase.agents.map((task) => async (): Promise<AgentResult> => {
      try {
        return await executeAgent(task);
      } catch (err) {
        if (err instanceof TruncationError) {
          // Retry once with doubled max_tokens
          const retryTask: AgentTask = {
            ...task,
            max_tokens: task.max_tokens * 2,
          };
          return await executeAgent(retryTask);
        }
        throw err;
      }
    });

    const results = await runWithConcurrency(agentTasks, concurrency);

    for (const result of results) {
      mergeIntoIR(ir, result);
    }

    completed.add(phase.id);

    onProgress?.({
      phaseId: phase.id,
      status: 'complete',
      agentCount: phase.agents.length,
      completedCount: phase.agents.length,
    });
  }

  return ir;
}
