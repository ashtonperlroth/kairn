import type { IterationLog, IterationScoreSummary, Score, ScoreEstimateReason } from './types.js';

export function numericScore(score: Score): number {
  return score.score ?? (score.pass ? 100 : 0);
}

export function markMeasured(score: Score): Score {
  return {
    ...score,
    scoreType: 'measured',
  };
}

export function makeEstimatedScore(
  previous: Score | undefined,
  reason: ScoreEstimateReason,
  sourceIteration: number,
): Score {
  const value = previous ? numericScore(previous) : 0;
  return {
    pass: value >= 50,
    score: value,
    scoreType: 'estimated',
    estimateReason: reason,
    estimatedFromIteration: sourceIteration,
  };
}

export function scoreType(score: Score): 'measured' | 'estimated' {
  return score.scoreType ?? 'measured';
}

export function summarizeScores(scores: Record<string, Score>): IterationScoreSummary {
  const values = Object.values(scores);
  let measuredTotal = 0;
  let estimatedTotal = 0;
  let measuredTaskCount = 0;
  let estimatedTaskCount = 0;

  for (const score of values) {
    const value = numericScore(score);
    if (scoreType(score) === 'estimated') {
      estimatedTotal += value;
      estimatedTaskCount++;
    } else {
      measuredTotal += value;
      measuredTaskCount++;
    }
  }

  const totalTaskCount = measuredTaskCount + estimatedTaskCount;
  const combinedTotal = measuredTotal + estimatedTotal;

  return {
    combinedScore: totalTaskCount > 0 ? combinedTotal / totalTaskCount : 0,
    measuredScore: measuredTaskCount > 0 ? measuredTotal / measuredTaskCount : null,
    estimatedScore: estimatedTaskCount > 0 ? estimatedTotal / estimatedTaskCount : null,
    measuredTaskCount,
    estimatedTaskCount,
    totalTaskCount,
  };
}

export function iterationScoreSummary(iteration: IterationLog): IterationScoreSummary {
  if (iteration.scoreSummary) return iteration.scoreSummary;

  if (Object.keys(iteration.taskResults).length === 0) {
    return {
      combinedScore: iteration.score,
      measuredScore: iteration.score,
      estimatedScore: null,
      measuredTaskCount: 1,
      estimatedTaskCount: 0,
      totalTaskCount: 1,
    };
  }

  return summarizeScores(iteration.taskResults);
}

export function hasMeasuredEvidence(
  iteration: IterationLog,
  minimumMeasuredTasks: number,
): boolean {
  return iterationScoreSummary(iteration).measuredTaskCount >= minimumMeasuredTasks;
}

export function findBestIterationWithMeasuredEvidence(
  iterations: IterationLog[],
  minimumMeasuredTasks: number,
): IterationLog | undefined {
  let best: IterationLog | undefined;

  for (const iteration of iterations) {
    if (!hasMeasuredEvidence(iteration, minimumMeasuredTasks)) continue;
    if (!best || iteration.score > best.score) {
      best = iteration;
    }
  }

  return best;
}

export function scoreDisplay(score: Score): string {
  const suffix = scoreType(score) === 'estimated' ? ' est.' : '';
  return `${numericScore(score).toFixed(0)}%${suffix}`;
}
