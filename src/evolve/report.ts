import fs from 'fs/promises';
import path from 'path';
import { loadIterationLog } from './trace.js';
import { diagnoseCounterfactuals } from './diagnosis.js';
import { aggregateCostByPhase, aggregateTelemetry, formatCost, formatTokens } from './cost.js';
import { loadExecutionLedger } from './execution-meter.js';
import { findBestIterationWithMeasuredEvidence, iterationScoreSummary, numericScore, scoreType } from './score-model.js';
import { loadMinMeasuredTasksForBest } from './workspace-config.js';
import type {
  IterationLog,
  Task,
  TasksFile,
  Score,
  EvolutionReport,
  CategoryBreakdown,
  TemplateCategory,
} from './types.js';
import { parse as yamlParse } from 'yaml';

/**
 * Load all iteration logs from a workspace by scanning iteration directories.
 */
async function loadAllIterations(workspacePath: string): Promise<IterationLog[]> {
  const iterDir = path.join(workspacePath, 'iterations');
  let entries: string[];
  try {
    entries = await fs.readdir(iterDir);
  } catch {
    return [];
  }

  const iterations: IterationLog[] = [];
  const iterNums = entries
    .map(e => parseInt(e, 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);

  for (const n of iterNums) {
    const log = await loadIterationLog(workspacePath, n);
    if (log) iterations.push(log);
  }

  return iterations;
}

/**
 * Load tasks from tasks.yaml in the workspace.
 * Tasks without a `category` field default to `'harness-sensitivity'` for backward compatibility.
 */
async function loadTasks(workspacePath: string): Promise<Task[]> {
  try {
    const content = await fs.readFile(path.join(workspacePath, 'tasks.yaml'), 'utf-8');
    const parsed = yamlParse(content) as TasksFile;
    const tasks = parsed?.tasks ?? [];
    return tasks.map(t => ({
      ...t,
      category: t.category ?? 'harness-sensitivity',
    }));
  } catch {
    return [];
  }
}

/**
 * Compute per-category score breakdown from the best iteration's task results.
 * Returns undefined if all tasks belong to a single category (no meaningful breakdown).
 */
function computeCategoryBreakdown(
  tasks: Task[],
  taskResults: Record<string, Score>,
): CategoryBreakdown | undefined {
  const harnessTasks: number[] = [];
  const substantiveTasks: number[] = [];

  for (const task of tasks) {
    const result = taskResults[task.id];
    if (!result) continue;

    const score = numericScore(result);
    const category: TemplateCategory = task.category ?? 'harness-sensitivity';

    if (category === 'harness-sensitivity') {
      harnessTasks.push(score);
    } else {
      substantiveTasks.push(score);
    }
  }

  // Only show breakdown when there are tasks in both categories
  if (harnessTasks.length === 0 || substantiveTasks.length === 0) {
    return undefined;
  }

  const harnessAvg = harnessTasks.reduce((a, b) => a + b, 0) / harnessTasks.length;
  const substantiveAvg = substantiveTasks.reduce((a, b) => a + b, 0) / substantiveTasks.length;

  return {
    harnessAdherence: { score: harnessAvg, count: harnessTasks.length },
    substantiveTasks: { score: substantiveAvg, count: substantiveTasks.length },
  };
}

/**
 * Build a leaderboard: per-task scores across all iterations.
 */
function buildLeaderboard(
  iterations: IterationLog[],
  tasks: Task[],
): EvolutionReport['leaderboard'] {
  const taskIds = tasks.map(t => t.id);
  return taskIds.map(taskId => {
    const scores: Record<number, number> = {};
    const variance: Record<number, { mean: number; stddev: number; runs: number }> = {};
    let bestScore = -1;
    let bestIteration = 0;

    for (const iter of iterations) {
      const s = iter.taskResults[taskId];
      if (s) {
        const score = numericScore(s);
        scores[iter.iteration] = score;
        if (s.variance) {
          variance[iter.iteration] = {
            mean: s.variance.mean,
            stddev: s.variance.stddev,
            runs: s.variance.runs,
          };
        }
        if (score > bestScore) {
          bestScore = score;
          bestIteration = iter.iteration;
        }
      }
    }

    const hasVariance = Object.keys(variance).length > 0;
    return { taskId, scores, bestIteration, bestScore, ...(hasVariance ? { variance } : {}) };
  });
}

/**
 * Determine iteration status label.
 */
function iterationStatus(iter: IterationLog, bestIteration: number): string {
  if (iter.iteration === 0) return 'baseline';
  if (!iter.proposal && !iter.diffPatch) return 'rollback';
  if (iter.score >= 100) return 'perfect';
  if (iter.iteration === bestIteration) return 'best';
  return 'evaluated';
}

function telemetryCostText(iter: IterationLog): string {
  const cost = iter.telemetry?.cost.estimatedUSD;
  if (cost === null || cost === undefined) {
    return iter.telemetry?.cost.status ?? 'unavailable';
  }
  return `${formatCost(cost)} ${iter.telemetry?.cost.status ?? 'estimated'}`;
}

function telemetryUsageText(iter: IterationLog): string {
  const totalTokens = iter.telemetry?.usage.totalTokens;
  if (totalTokens === null || totalTokens === undefined) {
    return iter.telemetry?.usage.status ?? 'unavailable';
  }
  return `${formatTokens(totalTokens)} ${iter.telemetry?.usage.status ?? 'estimated'}`;
}

/**
 * Generate a human-readable Markdown report of an evolution run.
 */
export async function generateMarkdownReport(workspacePath: string): Promise<string> {
  const iterations = await loadAllIterations(workspacePath);
  const tasks = await loadTasks(workspacePath);

  if (iterations.length === 0) {
    return '# Evolution Report\n\nNo iterations found. Run `kairn evolve run` first.\n';
  }

  const baselineScore = iterations[0].score;
  const minMeasuredTasksForBest = await loadMinMeasuredTasksForBest(workspacePath);
  const bestIter = findBestIterationWithMeasuredEvidence(iterations, minMeasuredTasksForBest);
  const improvement = bestIter ? bestIter.score - baselineScore : 0;

  const counterfactuals = diagnoseCounterfactuals(iterations, tasks);
  const leaderboard = buildLeaderboard(iterations, tasks);
  const runTelemetry = aggregateTelemetry(
    iterations.map(iter => iter.telemetry),
    'report',
  );
  const ledgerEntries = await loadExecutionLedger(workspacePath);
  const costByPhase = aggregateCostByPhase(
    ledgerEntries.length > 0 ? ledgerEntries : iterations.map(iter => iter.telemetry),
  );

  const lines: string[] = [];

  // Title
  lines.push('# Evolution Report');
  lines.push('');

  // Overview
  lines.push('## Overview');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total iterations | ${iterations.length} |`);
  lines.push(`| Baseline score | ${baselineScore.toFixed(1)}% |`);
  lines.push(`| Best score | ${bestIter ? `${bestIter.score.toFixed(1)}%` : 'none with measured evidence'} |`);
  const bestSummary = bestIter ? iterationScoreSummary(bestIter) : undefined;
  lines.push(`| Best measured score | ${!bestSummary || bestSummary.measuredScore === null ? 'none' : `${bestSummary.measuredScore.toFixed(1)}%`} |`);
  if (bestSummary && bestSummary.estimatedTaskCount > 0) {
    lines.push(`| Best estimated score | ${bestSummary.estimatedScore === null ? 'none' : `${bestSummary.estimatedScore.toFixed(1)}%`} (${bestSummary.estimatedTaskCount} estimated tasks) |`);
  }
  lines.push(`| Best iteration | ${bestIter ? bestIter.iteration : 'none'} |`);
  lines.push(`| Improvement | ${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)} points |`);
  lines.push(`| Usage | ${runTelemetry.usage.totalTokens === null ? runTelemetry.usage.status : `${formatTokens(runTelemetry.usage.totalTokens)} ${runTelemetry.usage.status}`} |`);
  lines.push(`| Estimated cost | ${runTelemetry.cost.estimatedUSD === null ? runTelemetry.cost.status : `${formatCost(runTelemetry.cost.estimatedUSD)} ${runTelemetry.cost.status}`} |`);

  // Category breakdown at best iteration
  const categoryBreakdown = bestIter ? computeCategoryBreakdown(tasks, bestIter.taskResults) : undefined;
  if (categoryBreakdown) {
    lines.push(`| Harness adherence | ${categoryBreakdown.harnessAdherence.score.toFixed(1)}% (${categoryBreakdown.harnessAdherence.count} tasks) |`);
    lines.push(`| Substantive tasks | ${categoryBreakdown.substantiveTasks.score.toFixed(1)}% (${categoryBreakdown.substantiveTasks.count} tasks) |`);
  }

  lines.push('');

  const phaseRows = Object.values(costByPhase);
  if (phaseRows.length > 0) {
    lines.push('## Cost by Phase');
    lines.push('');
    lines.push('| Phase | Calls | Usage | Cost | Duration | Models |');
    lines.push('|-------|-------|-------|------|----------|--------|');
    for (const row of phaseRows) {
      if (!row) continue;
      const usage = row.usage.totalTokens === null
        ? row.usage.status
        : `${formatTokens(row.usage.totalTokens)} ${row.usage.status}`;
      const cost = row.cost.estimatedUSD === null
        ? row.cost.status
        : `${formatCost(row.cost.estimatedUSD)} ${row.cost.status}`;
      lines.push(`| ${row.phase} | ${row.calls} | ${usage} | ${cost} | ${row.durationMs}ms | ${row.models.join(', ')} |`);
    }
    lines.push('');
  }

  // Iteration summary table
  lines.push('## Iterations');
  lines.push('');
  // Check if any iteration has variance data
  const hasVariance = iterations.some(iter =>
    Object.values(iter.taskResults).some(s => s.variance),
  );

  lines.push('| Iter | Score | Mutations | Mode | Usage | Cost | Status |');
  lines.push('|------|-------|-----------|------|-------|------|--------|');
  for (const iter of iterations) {
    const mutations = iter.proposal?.mutations.length ?? 0;
    const mutStr = mutations > 0 ? mutations.toString() : '-';
    const status = bestIter ? iterationStatus(iter, bestIter.iteration) : iterationStatus(iter, -1);
    const mode = iter.source ?? 'reactive';
    const summary = iterationScoreSummary(iter);
    let scoreStr = `${iter.score.toFixed(1)}%`;
    if (hasVariance) {
      const stddevs = Object.values(iter.taskResults)
        .map(s => s.variance?.stddev)
        .filter((v): v is number => v !== undefined);
      if (stddevs.length > 0) {
        const avgStddev = stddevs.reduce((a, b) => a + b, 0) / stddevs.length;
        scoreStr = `${iter.score.toFixed(1)}% ±${avgStddev.toFixed(1)}`;
      }
    }
    if (summary.estimatedTaskCount > 0) {
      scoreStr = `${scoreStr} (${summary.measuredTaskCount} measured, ${summary.estimatedTaskCount} estimated)`;
    }
    lines.push(`| ${iter.iteration} | ${scoreStr} | ${mutStr} | ${mode} | ${telemetryUsageText(iter)} | ${telemetryCostText(iter)} | ${status} |`);
  }
  lines.push('');

  // Leaderboard
  if (leaderboard.length > 0) {
    lines.push('## Leaderboard');
    lines.push('');

    // Header: Task | Iter 0 | Iter 1 | ... | Best
    const iterNums = iterations.map(i => i.iteration);
    const headerCols = ['Task', ...iterNums.map(n => `Iter ${n}`), 'Best'];
    lines.push(`| ${headerCols.join(' | ')} |`);
    lines.push(`| ${headerCols.map(() => '---').join(' | ')} |`);

    for (const entry of leaderboard) {
      const scoreCols = iterNums.map(n => {
        const s = entry.scores[n];
        if (s === undefined) return '-';
        const v = entry.variance?.[n];
        const score = iterations.find(iter => iter.iteration === n)?.taskResults[entry.taskId];
        const suffix = score && scoreType(score) === 'estimated' ? ' est.' : '';
        if (v && v.runs > 1) return `${s.toFixed(0)}%${suffix} ±${v.stddev.toFixed(1)}`;
        return `${s.toFixed(0)}%${suffix}`;
      });
      lines.push(`| ${entry.taskId} | ${scoreCols.join(' | ')} | ${entry.bestScore.toFixed(0)}% (iter ${entry.bestIteration}) |`);
    }
    lines.push('');
  }

  // Counterfactual diagnosis
  if (counterfactuals.entries.length > 0) {
    lines.push('## Counterfactual Diagnosis');
    lines.push('');

    for (const entry of counterfactuals.entries) {
      const sign = entry.netScoreDelta >= 0 ? '+' : '';
      lines.push(`### Iteration ${entry.iteration} (net ${sign}${entry.netScoreDelta.toFixed(1)} points)`);
      lines.push('');
      lines.push(`**Mutations:** ${entry.mutationSummary}`);
      lines.push('');

      if (entry.helpedTasks.length > 0) {
        lines.push('**Helped:**');
        for (const t of entry.helpedTasks) {
          lines.push(`- ${t.taskId}: +${t.delta.toFixed(1)}`);
        }
        lines.push('');
      }

      if (entry.hurtTasks.length > 0) {
        lines.push('**Hurt:**');
        for (const t of entry.hurtTasks) {
          lines.push(`- ${t.taskId}: ${t.delta.toFixed(1)}`);
        }
        lines.push('');
      }
    }
  }

  // Architect iterations summary
  const architectIterations = iterations.filter(iter => iter.source === 'architect');
  if (architectIterations.length > 0) {
    lines.push('## Architect Iterations');
    lines.push('');
    for (const iter of architectIterations) {
      lines.push(`- Iteration ${iter.iteration}: architect (score: ${iter.score.toFixed(1)})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate a machine-readable JSON report of an evolution run.
 */
export async function generateJsonReport(workspacePath: string): Promise<EvolutionReport> {
  const iterations = await loadAllIterations(workspacePath);
  const tasks = await loadTasks(workspacePath);

  const baselineScore = iterations.length > 0 ? iterations[0].score : 0;
  const minMeasuredTasksForBest = await loadMinMeasuredTasksForBest(workspacePath);
  const bestIterLog = findBestIterationWithMeasuredEvidence(iterations, minMeasuredTasksForBest);
  const bestIter = bestIterLog ?? { score: 0, iteration: -1 };
  const improvement = bestIterLog ? bestIter.score - baselineScore : 0;
  const bestSummary = bestIterLog ? iterationScoreSummary(bestIterLog) : undefined;

  const counterfactuals = diagnoseCounterfactuals(iterations, tasks);
  const leaderboard = buildLeaderboard(iterations, tasks);
  const telemetry = aggregateTelemetry(
    iterations.map(iter => iter.telemetry),
    'report',
  );
  const ledgerEntries = await loadExecutionLedger(workspacePath);
  const costByPhase = aggregateCostByPhase(
    ledgerEntries.length > 0 ? ledgerEntries : iterations.map(iter => iter.telemetry),
  );

  // Compute category breakdown at best iteration
  const categoryBreakdown = bestIterLog
    ? computeCategoryBreakdown(tasks, bestIterLog.taskResults)
    : undefined;

  return {
    overview: {
      title: 'Evolution Report',
      totalIterations: iterations.length,
      baselineScore,
      bestScore: bestIter.score,
      bestMeasuredScore: bestSummary?.measuredScore ?? null,
      bestIteration: bestIter.iteration,
      improvement,
      telemetry,
      usage: telemetry.usage,
      cost: telemetry.cost,
      costByPhase,
      ...(categoryBreakdown ? { categoryBreakdown } : {}),
    },
    iterations: iterations.map(iter => {
      const stddevs = Object.values(iter.taskResults)
        .map(s => s.variance?.stddev)
        .filter((v): v is number => v !== undefined);
      const avgStddev = stddevs.length > 0
        ? stddevs.reduce((a, b) => a + b, 0) / stddevs.length
        : undefined;
      return {
        iteration: iter.iteration,
        score: iter.score,
        scoreSummary: iterationScoreSummary(iter),
        ...(avgStddev !== undefined ? { stddev: avgStddev } : {}),
        mutationCount: iter.proposal?.mutations.length ?? 0,
        status: iterationStatus(iter, bestIter.iteration),
        mode: iter.source ?? 'reactive',
        telemetry: iter.telemetry,
        usage: iter.telemetry?.usage,
        cost: iter.telemetry?.cost,
        model: iter.telemetry?.model,
        phase: iter.telemetry?.phase,
        durationMs: iter.telemetry?.durationMs,
      };
    }),
    leaderboard,
    counterfactuals,
  };
}
