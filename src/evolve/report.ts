import fs from 'fs/promises';
import path from 'path';
import { loadIterationLog } from './trace.js';
import { diagnoseCounterfactuals } from './diagnosis.js';
import type {
  IterationLog,
  Task,
  TasksFile,
  Score,
  EvolutionReport,
} from './types.js';
import { parse as yamlParse } from 'yaml';

/**
 * Compute the numeric score from a Score object.
 */
function numericScore(s: Score): number {
  return s.score ?? (s.pass ? 100 : 0);
}

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
 */
async function loadTasks(workspacePath: string): Promise<Task[]> {
  try {
    const content = await fs.readFile(path.join(workspacePath, 'tasks.yaml'), 'utf-8');
    const parsed = yamlParse(content) as TasksFile;
    return parsed?.tasks ?? [];
  } catch {
    return [];
  }
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
  const bestIter = iterations.reduce((best, curr) =>
    curr.score > best.score ? curr : best, iterations[0]);
  const improvement = bestIter.score - baselineScore;

  const counterfactuals = diagnoseCounterfactuals(iterations, tasks);
  const leaderboard = buildLeaderboard(iterations, tasks);

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
  lines.push(`| Best score | ${bestIter.score.toFixed(1)}% |`);
  lines.push(`| Best iteration | ${bestIter.iteration} |`);
  lines.push(`| Improvement | ${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)} points |`);
  lines.push('');

  // Iteration summary table
  lines.push('## Iterations');
  lines.push('');
  // Check if any iteration has variance data
  const hasVariance = iterations.some(iter =>
    Object.values(iter.taskResults).some(s => s.variance),
  );

  lines.push('| Iter | Score | Mutations | Mode | Status |');
  lines.push('|------|-------|-----------|------|--------|');
  for (const iter of iterations) {
    const mutations = iter.proposal?.mutations.length ?? 0;
    const mutStr = mutations > 0 ? mutations.toString() : '-';
    const status = iterationStatus(iter, bestIter.iteration);
    const mode = iter.source ?? 'reactive';
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
    lines.push(`| ${iter.iteration} | ${scoreStr} | ${mutStr} | ${mode} | ${status} |`);
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
        if (v && v.runs > 1) return `${s.toFixed(0)}% ±${v.stddev.toFixed(1)}`;
        return `${s.toFixed(0)}%`;
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
  const bestIter = iterations.length > 0
    ? iterations.reduce((best, curr) => curr.score > best.score ? curr : best, iterations[0])
    : { score: 0, iteration: 0 };
  const improvement = bestIter.score - baselineScore;

  const counterfactuals = diagnoseCounterfactuals(iterations, tasks);
  const leaderboard = buildLeaderboard(iterations, tasks);

  return {
    overview: {
      title: 'Evolution Report',
      totalIterations: iterations.length,
      baselineScore,
      bestScore: bestIter.score,
      bestIteration: bestIter.iteration,
      improvement,
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
        ...(avgStddev !== undefined ? { stddev: avgStddev } : {}),
        mutationCount: iter.proposal?.mutations.length ?? 0,
        status: iterationStatus(iter, bestIter.iteration),
        mode: iter.source ?? 'reactive',
      };
    }),
    leaderboard,
    counterfactuals,
  };
}
