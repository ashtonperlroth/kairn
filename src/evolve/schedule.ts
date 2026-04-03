/**
 * Schedule module for architect/reactive iteration interleaving.
 *
 * Determines whether a given iteration should use the architect proposer
 * or the reactive proposer, based on the configured schedule strategy.
 */

/**
 * Determine whether the given iteration should use the architect proposer.
 *
 * @param iteration - Current iteration number (0-based)
 * @param maxIterations - Total iterations in the run
 * @param schedule - Schedule strategy
 * @param architectEvery - For constant/explore-exploit: run architect every N iterations
 * @param recentScores - For adaptive mode: recent iteration scores (newest last)
 * @returns true if this iteration should use the architect proposer
 */
export function shouldUseArchitect(
  iteration: number,
  maxIterations: number,
  schedule: 'explore-exploit' | 'constant' | 'adaptive',
  architectEvery: number,
  recentScores?: number[],
): boolean {
  // Never use architect on iteration 0 (baseline evaluation only)
  if (iteration === 0) return false;

  // Never use architect on the last iteration (no point mutating if we won't eval)
  if (iteration >= maxIterations - 1) return false;

  switch (schedule) {
    case 'constant':
      return iteration % architectEvery === 0;

    case 'explore-exploit': {
      // Early exploration: iterations 1-2 use architect
      if (iteration <= 2) return true;
      // Mid-run: architect every Nth iteration
      if (iteration % architectEvery === 0) return true;
      return false;
    }

    case 'adaptive': {
      // Switch to architect when scores have plateaued
      if (!recentScores || recentScores.length < 2) return false;
      // Check if the last 2+ scores show no improvement
      const recent = recentScores.slice(-3);
      if (recent.length < 2) return false;
      const maxScore = Math.max(...recent);
      const minScore = Math.min(...recent);
      // Plateau: range of recent scores is < 1 point
      return (maxScore - minScore) < 1;
    }

    default:
      return false;
  }
}

/**
 * Compute the architect's mutation budget for a given iteration.
 *
 * Early iterations get a higher budget (10) for bold structural changes.
 * Later iterations get a lower budget (5) for more targeted adjustments.
 *
 * @param iteration - Current iteration number
 * @param maxIterations - Total iterations in the run
 * @returns Maximum number of mutations the architect may propose
 */
export function computeArchitectMutationBudget(
  iteration: number,
  maxIterations: number,
): number {
  const progress = iteration / maxIterations;
  if (progress < 0.5) return 10;
  if (progress < 0.75) return 7;
  return 5;
}
