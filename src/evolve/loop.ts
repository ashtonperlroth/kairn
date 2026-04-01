import fs from 'fs/promises';
import path from 'path';
import { evaluateAll } from './runner.js';
import { propose } from './proposer.js';
import { applyMutations } from './mutator.js';
import { writeIterationLog } from './trace.js';
import { copyDir } from './baseline.js';
import type { KairnConfig } from '../types.js';
import type {
  Task,
  EvolveConfig,
  IterationLog,
  EvolveResult,
  LoopProgressEvent,
} from './types.js';

/**
 * Run the evolution loop: evaluate -> diagnose -> mutate -> re-evaluate.
 *
 * Each iteration follows these steps:
 * 1. Evaluate all tasks against the current harness
 * 2. Check for regression — if score dropped below best, rollback
 * 3. Check for perfect score — exit early if 100%
 * 4. Propose mutations via the proposer LLM agent
 * 5. Apply mutations to create the next iteration's harness
 * 6. Log iteration results
 * 7. Advance to the next iteration
 *
 * @param workspacePath - Path to .kairn-evolve/ directory
 * @param tasks - Task definitions from tasks.yaml
 * @param kairnConfig - Kairn config with API key and model
 * @param evolveConfig - Evolution config with iterations, proposer model, etc.
 * @param onProgress - Optional callback for real-time progress updates
 * @returns Final evolution result with iteration history and best score
 */
export async function evolve(
  workspacePath: string,
  tasks: Task[],
  kairnConfig: KairnConfig,
  evolveConfig: EvolveConfig,
  onProgress?: (event: LoopProgressEvent) => void,
): Promise<EvolveResult> {
  const history: IterationLog[] = [];
  let bestScore = -1;
  let bestIteration = 0;
  let baselineScore = 0;

  for (let iter = 0; iter < evolveConfig.maxIterations; iter++) {
    const harnessPath = path.join(
      workspacePath,
      'iterations',
      iter.toString(),
      'harness',
    );

    // Verify harness exists for this iteration
    try {
      await fs.access(harnessPath);
    } catch {
      if (iter === 0) {
        throw new Error(
          'No baseline harness found. Run `kairn evolve baseline` first.',
        );
      }
      break; // No more iterations to run
    }

    // 1. EVALUATE
    onProgress?.({ type: 'iteration-start', iteration: iter });
    const { results, aggregate } = await evaluateAll(
      tasks,
      harnessPath,
      workspacePath,
      iter,
      kairnConfig,
      onProgress,
      evolveConfig.runsPerTask,
    );
    onProgress?.({ type: 'iteration-scored', iteration: iter, score: aggregate });

    if (iter === 0) baselineScore = aggregate;

    // 2. ROLLBACK CHECK
    if (iter > 0 && aggregate < bestScore) {
      onProgress?.({
        type: 'rollback',
        iteration: iter,
        score: aggregate,
        message: `Regression: ${aggregate.toFixed(1)}% < ${bestScore.toFixed(1)}%. Rolling back.`,
      });

      // Log the regression
      const rollbackLog: IterationLog = {
        iteration: iter,
        score: aggregate,
        taskResults: results,
        proposal: null,
        diffPatch: null,
        timestamp: new Date().toISOString(),
      };
      await writeIterationLog(workspacePath, rollbackLog);
      history.push(rollbackLog);

      // Copy best harness to next iteration (if not last)
      if (iter + 1 < evolveConfig.maxIterations) {
        const nextIterDir = path.join(
          workspacePath,
          'iterations',
          (iter + 1).toString(),
        );
        const bestHarnessPath = path.join(
          workspacePath,
          'iterations',
          bestIteration.toString(),
          'harness',
        );
        await copyDir(bestHarnessPath, path.join(nextIterDir, 'harness'));
      }
      continue;
    }

    // 3. UPDATE BEST
    bestScore = aggregate;
    bestIteration = iter;

    // 4. PERFECT SCORE CHECK
    if (aggregate >= 100) {
      onProgress?.({ type: 'perfect-score', iteration: iter, score: aggregate });
      const perfectLog: IterationLog = {
        iteration: iter,
        score: aggregate,
        taskResults: results,
        proposal: null,
        diffPatch: null,
        timestamp: new Date().toISOString(),
      };
      await writeIterationLog(workspacePath, perfectLog);
      history.push(perfectLog);
      break;
    }

    // 5. PROPOSE (skip on last iteration — no point mutating if we won't eval)
    if (iter === evolveConfig.maxIterations - 1) {
      const finalLog: IterationLog = {
        iteration: iter,
        score: aggregate,
        taskResults: results,
        proposal: null,
        diffPatch: null,
        timestamp: new Date().toISOString(),
      };
      await writeIterationLog(workspacePath, finalLog);
      history.push(finalLog);
      break;
    }

    onProgress?.({ type: 'proposing', iteration: iter });
    let proposal;
    try {
      proposal = await propose(
        iter,
        workspacePath,
        harnessPath,
        history,
        tasks,
        kairnConfig,
        evolveConfig.proposerModel,
      );
    } catch (err) {
      // Proposer failed — log the error and copy current harness forward unchanged
      const errMsg = err instanceof Error ? err.message : String(err);
      onProgress?.({
        type: 'proposer-error',
        iteration: iter,
        message: `Proposer failed: ${errMsg}`,
      });
      const nextIterDir = path.join(
        workspacePath,
        'iterations',
        (iter + 1).toString(),
      );
      await copyDir(harnessPath, path.join(nextIterDir, 'harness'));
      const skipLog: IterationLog = {
        iteration: iter,
        score: aggregate,
        taskResults: results,
        proposal: null,
        diffPatch: null,
        timestamp: new Date().toISOString(),
      };
      await writeIterationLog(workspacePath, skipLog);
      history.push(skipLog);
      continue;
    }

    // 6. APPLY MUTATIONS
    const nextIterDir = path.join(
      workspacePath,
      'iterations',
      (iter + 1).toString(),
    );
    let diffPatch = '';
    try {
      const mutationResult = await applyMutations(
        harnessPath,
        nextIterDir,
        proposal.mutations,
      );
      diffPatch = mutationResult.diffPatch;
    } catch {
      // Mutation failed — copy current harness forward unchanged
      await copyDir(harnessPath, path.join(nextIterDir, 'harness'));
    }

    onProgress?.({
      type: 'mutations-applied',
      iteration: iter,
      mutationCount: proposal.mutations.length,
    });

    // 7. LOG
    const iterLog: IterationLog = {
      iteration: iter,
      score: aggregate,
      taskResults: results,
      proposal,
      diffPatch,
      timestamp: new Date().toISOString(),
    };
    await writeIterationLog(workspacePath, iterLog);
    history.push(iterLog);
  }

  onProgress?.({
    type: 'complete',
    iteration: history.length > 0 ? history.length - 1 : 0,
    score: bestScore,
  });

  return {
    iterations: history,
    bestIteration,
    bestScore,
    baselineScore,
  };
}
