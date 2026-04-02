import fs from 'fs/promises';
import path from 'path';
import type { Task } from './types.js';

/**
 * Represents a Beta distribution belief about a task's success rate.
 * Used by Thompson Sampling to select tasks with high uncertainty.
 */
export interface TaskBelief {
  taskId: string;
  alpha: number;  // successes + 1 (Beta distribution parameter)
  beta: number;   // failures + 1 (Beta distribution parameter)
}

/**
 * Initialize uniform prior beliefs for all tasks.
 * Each task starts with alpha=1, beta=1 (uniform distribution).
 */
export function initBeliefs(tasks: Task[]): TaskBelief[] {
  return tasks.map(task => ({
    taskId: task.id,
    alpha: 1,
    beta: 1,
  }));
}

/**
 * Sample from a Beta distribution using the Joehnk algorithm.
 * Returns a value in [0, 1].
 */
function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  // For alpha=1, beta=1 (uniform), just return rng directly
  if (alpha === 1 && beta === 1) return rng();

  // Joehnk's algorithm for general Beta(a, b)
  // Uses rejection sampling via Gamma variates approximation
  // For small alpha/beta, use the inverse CDF method via Gamma ratio
  const gammaA = sampleGamma(alpha, rng);
  const gammaB = sampleGamma(beta, rng);
  return gammaA / (gammaA + gammaB);
}

/**
 * Sample from Gamma(alpha, 1) using Marsaglia and Tsang's method.
 */
function sampleGamma(alpha: number, rng: () => number): number {
  if (alpha < 1) {
    // Boost: Gamma(alpha) = Gamma(alpha+1) * U^(1/alpha)
    return sampleGamma(alpha + 1, rng) * Math.pow(rng(), 1 / alpha);
  }

  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let x: number;
    let v: number;
    do {
      x = sampleNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * Sample from standard normal using Box-Muller transform.
 */
function sampleNormal(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Select tasks using Thompson Sampling.
 *
 * For each task, sample from its Beta(alpha, beta) distribution.
 * Select the top-K tasks by sampled value. Tasks with high uncertainty
 * (wide distributions) are more likely to produce extreme samples and
 * thus more likely to be selected.
 *
 * @param beliefs - Current beliefs about each task
 * @param sampleSize - Number of tasks to select
 * @param rng - Random number generator (0-1)
 * @returns Array of selected task IDs (length = sampleSize)
 */
export function sampleThompson(
  beliefs: TaskBelief[],
  sampleSize: number,
  rng: () => number,
): string[] {
  if (sampleSize >= beliefs.length) {
    return beliefs.map(b => b.taskId);
  }

  // Sample from each task's Beta distribution
  const samples = beliefs.map(belief => ({
    taskId: belief.taskId,
    sample: sampleBeta(belief.alpha, belief.beta, rng),
  }));

  // Sort by sampled value descending, take top-K
  samples.sort((a, b) => b.sample - a.sample);
  return samples.slice(0, sampleSize).map(s => s.taskId);
}

/**
 * Update beliefs after observing task results.
 *
 * If score >= 70%, increment alpha (success).
 * If score < 70%, increment beta (failure).
 *
 * @param beliefs - Current beliefs
 * @param results - Task scores from this iteration (taskId -> score value 0-100)
 * @returns Updated beliefs (new array, does not mutate input)
 */
export function updateBeliefs(
  beliefs: TaskBelief[],
  results: Record<string, number>,
): TaskBelief[] {
  return beliefs.map(belief => {
    const score = results[belief.taskId];
    if (score === undefined) return belief; // task wasn't evaluated this round

    if (score >= 70) {
      return { ...belief, alpha: belief.alpha + 1 };
    } else {
      return { ...belief, beta: belief.beta + 1 };
    }
  });
}

/**
 * Load persisted beliefs from disk.
 * Returns null if no beliefs file exists.
 */
export async function loadBeliefs(workspacePath: string): Promise<TaskBelief[] | null> {
  const beliefsPath = path.join(workspacePath, 'task-beliefs.json');
  try {
    const content = await fs.readFile(beliefsPath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) return null;
    // Validate structure
    for (const entry of parsed) {
      if (
        typeof entry !== 'object' || entry === null ||
        typeof (entry as Record<string, unknown>).taskId !== 'string' ||
        typeof (entry as Record<string, unknown>).alpha !== 'number' ||
        typeof (entry as Record<string, unknown>).beta !== 'number'
      ) {
        return null;
      }
    }
    return parsed as TaskBelief[];
  } catch {
    return null;
  }
}

/**
 * Persist beliefs to disk.
 */
export async function saveBeliefs(workspacePath: string, beliefs: TaskBelief[]): Promise<void> {
  const beliefsPath = path.join(workspacePath, 'task-beliefs.json');
  await fs.mkdir(path.dirname(beliefsPath), { recursive: true });
  await fs.writeFile(beliefsPath, JSON.stringify(beliefs, null, 2), 'utf-8');
}
