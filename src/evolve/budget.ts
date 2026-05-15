import { estimateCost, formatCost } from './cost.js';
import type { EvolveBudgetConfig, EvolveConfig, Task } from './types.js';

const TASK_INPUT_TOKENS = 12_000;
const TASK_OUTPUT_TOKENS = 4_000;
const SCORER_INPUT_TOKENS = 3_000;
const SCORER_OUTPUT_TOKENS = 800;
const PROPOSER_INPUT_TOKENS = 18_000;
const PROPOSER_OUTPUT_TOKENS = 4_000;
const ARCHITECT_INPUT_TOKENS = 24_000;
const ARCHITECT_OUTPUT_TOKENS = 5_000;

export interface EvolveBudgetForecast {
  taskRuns: number;
  scorerCalls: number;
  proposerCalls: number;
  architectCalls: number;
  estimatedTaskUSD: number;
  estimatedPerTaskUSD: number;
  estimatedScorerUSD: number;
  estimatedProposerUSD: number;
  estimatedArchitectUSD: number;
  estimatedRunUSD: number;
  estimatedPbtUSD?: number;
  notes: string[];
}

export interface BudgetViolation {
  field: keyof EvolveBudgetConfig;
  limitUSD: number;
  forecastUSD: number;
}

export interface BudgetCheckResult {
  ok: boolean;
  violations: BudgetViolation[];
}

function positiveBudget(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function countScorerCalls(tasks: Task[], taskRunsPerIteration: number): number {
  const scorerCallsPerEvaluation = tasks.reduce((sum, task) => {
    if (task.scoring === 'llm-judge') return sum + 1;
    if (task.scoring === 'rubric') return sum + Math.max(1, task.rubric?.length ?? 1);
    return sum;
  }, 0);
  return scorerCallsPerEvaluation * taskRunsPerIteration;
}

function countArchitectCalls(config: EvolveConfig): number {
  if (config.maxIterations <= 2) return 0;
  if (config.schedule === 'off') return 0;
  const candidateIterations = Array.from(
    { length: Math.max(0, config.maxIterations - 2) },
    (_, index) => index + 1,
  );

  if (config.schedule === 'adaptive') {
    return candidateIterations.length;
  }

  return candidateIterations.filter((iteration) => {
    if (config.schedule === 'explore-exploit' && iteration <= 2) return true;
    if (config.architectEvery < 1) return false;
    return iteration % config.architectEvery === 0;
  }).length;
}

function estimateCallCost(
  calls: number,
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  return calls * estimateCost(inputTokens, outputTokens, model);
}

export function forecastEvolveBudget(
  tasks: Task[],
  config: EvolveConfig,
  options: { pbtBranches?: number } = {},
): EvolveBudgetForecast {
  const iterations = Math.max(1, config.maxIterations);
  const runsPerTask = Math.max(1, config.runsPerTask);
  const taskRuns = tasks.length * iterations * runsPerTask;
  const scorerCalls = countScorerCalls(tasks, iterations * runsPerTask);
  const architectCalls = countArchitectCalls(config);
  const reactiveProposalSlots = Math.max(0, iterations - 1 - architectCalls);
  const proposerCalls = reactiveProposalSlots + (config.usePrincipal ? 1 : 0);

  const estimatedTaskUSD = estimateCallCost(
    taskRuns,
    TASK_INPUT_TOKENS,
    TASK_OUTPUT_TOKENS,
    config.model,
  );
  const estimatedPerTaskUSD = estimateCallCost(
    runsPerTask,
    TASK_INPUT_TOKENS,
    TASK_OUTPUT_TOKENS,
    config.model,
  );
  const estimatedScorerUSD = estimateCallCost(
    scorerCalls,
    SCORER_INPUT_TOKENS,
    SCORER_OUTPUT_TOKENS,
    config.model,
  );
  const estimatedProposerUSD = estimateCallCost(
    proposerCalls,
    PROPOSER_INPUT_TOKENS,
    PROPOSER_OUTPUT_TOKENS,
    config.proposerModel,
  );
  const estimatedArchitectUSD = estimateCallCost(
    architectCalls,
    ARCHITECT_INPUT_TOKENS,
    ARCHITECT_OUTPUT_TOKENS,
    config.architectModel,
  );
  const estimatedRunUSD = estimatedTaskUSD + estimatedScorerUSD + estimatedProposerUSD + estimatedArchitectUSD;
  const pbtBranches = options.pbtBranches ?? 0;
  const estimatedPbtUSD = pbtBranches > 0 ? estimatedRunUSD * pbtBranches : undefined;

  return {
    taskRuns,
    scorerCalls,
    proposerCalls,
    architectCalls,
    estimatedTaskUSD,
    estimatedPerTaskUSD,
    estimatedScorerUSD,
    estimatedProposerUSD,
    estimatedArchitectUSD,
    estimatedRunUSD,
    estimatedPbtUSD,
    notes: [
      'Forecast is a conservative estimate from planned task/proposer/scorer calls and model pricing.',
      'Actual telemetry may differ because Claude Code and scorer output sizes vary by task.',
    ],
  };
}

export function checkEvolveBudgets(
  forecast: EvolveBudgetForecast,
  budgets: EvolveBudgetConfig | undefined,
): BudgetCheckResult {
  const violations: BudgetViolation[] = [];
  const checks: Array<[keyof EvolveBudgetConfig, number | undefined, number | undefined]> = [
    ['runUSD', budgets?.runUSD, forecast.estimatedRunUSD],
    ['taskUSD', budgets?.taskUSD, forecast.estimatedPerTaskUSD],
    ['scorerUSD', budgets?.scorerUSD, forecast.estimatedScorerUSD],
    ['proposerUSD', budgets?.proposerUSD, forecast.estimatedProposerUSD],
    ['architectUSD', budgets?.architectUSD, forecast.estimatedArchitectUSD],
    ['pbtUSD', budgets?.pbtUSD, forecast.estimatedPbtUSD],
  ];

  for (const [field, limit, forecastUSD] of checks) {
    const normalizedLimit = positiveBudget(limit);
    if (normalizedLimit === undefined || forecastUSD === undefined) continue;
    if (forecastUSD > normalizedLimit) {
      violations.push({ field, limitUSD: normalizedLimit, forecastUSD });
    }
  }

  return { ok: violations.length === 0, violations };
}

export function formatBudgetForecast(forecast: EvolveBudgetForecast): string[] {
  const lines = [
    'Budget forecast',
    `  Task runs:      ${forecast.taskRuns} (${formatCost(forecast.estimatedTaskUSD)})`,
    `  Scorer calls:   ${forecast.scorerCalls} (${formatCost(forecast.estimatedScorerUSD)})`,
    `  Proposer calls: ${forecast.proposerCalls} (${formatCost(forecast.estimatedProposerUSD)})`,
    `  Architect calls:${forecast.architectCalls.toString().padStart(2)} (${formatCost(forecast.estimatedArchitectUSD)})`,
    `  Run estimate:   ${formatCost(forecast.estimatedRunUSD)}`,
  ];
  if (forecast.estimatedPbtUSD !== undefined) {
    lines.push(`  PBT estimate:   ${formatCost(forecast.estimatedPbtUSD)}`);
  }
  return lines;
}

export function formatBudgetViolations(violations: BudgetViolation[]): string[] {
  return violations.map(
    (violation) =>
      `${violation.field}: forecast ${formatCost(violation.forecastUSD)} exceeds budget ${formatCost(violation.limitUSD)}`,
  );
}
