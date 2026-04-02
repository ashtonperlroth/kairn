import fs from 'fs/promises';
import path from 'path';
import { evaluateAll } from './runner.js';
import { propose } from './proposer.js';
import { applyMutations } from './mutator.js';
import { writeIterationLog } from './trace.js';
import { copyDir } from './baseline.js';
import { initBeliefs, sampleThompson, updateBeliefs, loadBeliefs, saveBeliefs } from './sampling.js';
import { measureComplexity, measureComplexityFromIR, computeComplexityCost, applyKLPenalty, computeDiffRatio } from './regularization.js';
import { parseHarness } from '../ir/parser.js';
import type { HarnessIR } from '../ir/types.js';
import type { TaskBelief } from './sampling.js';
import type { ComplexityMetrics } from './regularization.js';
import type { KairnConfig } from '../types.js';
import type {
  Task,
  Score,
  EvolveConfig,
  IterationLog,
  EvolveResult,
  LoopProgressEvent,
} from './types.js';

/**
 * Compute dynamic mutation cap based on iteration progress.
 * First 40% of iterations: full cap (exploration).
 * Last 60%: linearly decays to 1 (exploitation).
 */
export function computeMutationCap(iter: number, maxIterations: number, maxMutations: number): number {
  if (maxIterations <= 1) return maxMutations;
  const progress = iter / (maxIterations - 1); // 0.0 to 1.0
  if (progress <= 0.4) return maxMutations;
  // Linear decay from maxMutations at 40% to 1 at 100%
  const decayProgress = (progress - 0.4) / 0.6; // 0.0 to 1.0 within decay phase
  return Math.max(1, Math.round(maxMutations * (1 - decayProgress * (1 - 1 / maxMutations))));
}

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

  // Thompson Sampling: initialize or load beliefs
  const useThompson = evolveConfig.samplingStrategy === 'thompson' && evolveConfig.evalSampleSize > 0;
  let beliefs: TaskBelief[] = useThompson
    ? (await loadBeliefs(workspacePath) ?? initBeliefs(tasks))
    : [];

  // KL Regularization: measure baseline complexity
  const useKL = evolveConfig.klLambda > 0;
  let baselineComplexity: ComplexityMetrics | null = null;
  let baselineIR: HarnessIR | null = null;
  if (useKL) {
    const baselineHarness = path.join(workspacePath, 'iterations', '0', 'harness');
    try {
      baselineIR = await parseHarness(baselineHarness);
      baselineComplexity = measureComplexityFromIR(baselineIR);
    } catch {
      // IR parsing failed — fall back to file-based measurement
      try {
        baselineComplexity = await measureComplexity(baselineHarness);
      } catch {
        // Baseline not available yet — will be measured after iteration 0
      }
    }
  }

  // Seeded RNG for Thompson Sampling (deterministic per-run)
  let rngState = 42;
  const rng = (): number => {
    rngState = (rngState * 1664525 + 1013904223) & 0xffffffff;
    return (rngState >>> 0) / 0x100000000;
  };

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

    // 1. EVALUATE (with adaptive pruning on middle iterations)
    onProgress?.({ type: 'iteration-start', iteration: iter });

    const isFirstIter = iter === 0;
    const isLastIter = iter === evolveConfig.maxIterations - 1;
    const prevLog = history.length > 0 ? history[history.length - 1] : null;

    let tasksToRun = tasks;
    const carriedScores: Record<string, Score> = {};
    const threshold = evolveConfig.pruneThreshold;

    if (!isFirstIter && !isLastIter && prevLog) {
      tasksToRun = [];
      for (const task of tasks) {
        const prevScore = prevLog.taskResults[task.id];
        const prevValue = prevScore ? (prevScore.score ?? (prevScore.pass ? 100 : 0)) : 0;
        if (prevValue >= threshold) {
          carriedScores[task.id] = { pass: true, score: prevValue };
          onProgress?.({
            type: 'task-skipped',
            iteration: iter,
            taskId: task.id,
            message: `Skipped ${task.id} (scored ${prevValue.toFixed(0)}% >= ${threshold}% threshold)`,
          });
        } else {
          tasksToRun.push(task);
        }
      }

      // Mini-batch sampling: Thompson or uniform
      const sampleSize = evolveConfig.evalSampleSize;
      if (sampleSize > 0 && sampleSize < tasksToRun.length) {
        let sampled: Set<string>;

        if (useThompson) {
          // Thompson Sampling: select tasks proportional to uncertainty
          const relevantBeliefs = beliefs.filter(b => tasksToRun.some(t => t.id === b.taskId));
          const selectedIds = sampleThompson(relevantBeliefs, sampleSize, rng);
          sampled = new Set(selectedIds);
        } else {
          // Uniform: seeded shuffle (v2.5.2 behavior)
          const shuffled = [...tasksToRun].sort((a, b) => {
            const hashA = (iter * 31 + a.id.charCodeAt(0)) % 1000;
            const hashB = (iter * 31 + b.id.charCodeAt(0)) % 1000;
            return hashA - hashB;
          });
          sampled = new Set(shuffled.slice(0, sampleSize).map(t => t.id));
        }

        // Carry forward unsampled tasks
        for (const task of tasksToRun) {
          if (!sampled.has(task.id)) {
            const prev = prevLog.taskResults[task.id];
            const prevVal = prev ? (prev.score ?? (prev.pass ? 100 : 0)) : 0;
            carriedScores[task.id] = { pass: prevVal >= 50, score: prevVal };
            onProgress?.({
              type: 'task-skipped',
              iteration: iter,
              taskId: task.id,
              message: `Sampled out ${task.id} (${useThompson ? 'thompson' : 'uniform'} ${sampleSize}/${tasksToRun.length})`,
            });
          }
        }
        tasksToRun = tasksToRun.filter(t => sampled.has(t.id));
      }
    }

    const { results: evalResults, aggregate: evalAggregate } = await evaluateAll(
      tasksToRun,
      harnessPath,
      workspacePath,
      iter,
      kairnConfig,
      onProgress,
      evolveConfig.runsPerTask,
      evolveConfig.parallelTasks,
    );

    // Merge carried-forward scores with evaluated results
    const results = { ...carriedScores, ...evalResults };
    const allScores = Object.values(results);
    const total = allScores.reduce(
      (sum, s) => sum + (s.score ?? (s.pass ? 100 : 0)),
      0,
    );
    const rawAggregate = allScores.length > 0 ? total / allScores.length : 0;

    // KL Regularization: penalize complexity drift
    let aggregate = rawAggregate;
    let iterComplexityCost: number | undefined;
    if (useKL && baselineComplexity) {
      let currentComplexity: ComplexityMetrics;
      try {
        const iterIR = await parseHarness(harnessPath);
        currentComplexity = measureComplexityFromIR(iterIR);
      } catch {
        currentComplexity = await measureComplexity(harnessPath);
      }
      const diffRatio = await computeDiffRatio(
        harnessPath,
        path.join(workspacePath, 'iterations', '0', 'harness'),
      );
      currentComplexity.diffFromBaseline = diffRatio;
      iterComplexityCost = computeComplexityCost(currentComplexity, baselineComplexity);
      aggregate = applyKLPenalty(rawAggregate, iterComplexityCost, evolveConfig.klLambda);
    }

    // Thompson Sampling: update beliefs with results
    if (useThompson) {
      const scoreMap: Record<string, number> = {};
      for (const [taskId, score] of Object.entries(results)) {
        scoreMap[taskId] = score.score ?? (score.pass ? 100 : 0);
      }
      beliefs = updateBeliefs(beliefs, scoreMap);
      await saveBeliefs(workspacePath, beliefs);
    }

    onProgress?.({ type: 'iteration-scored', iteration: iter, score: aggregate });

    if (iter === 0) {
      baselineScore = aggregate;
      // Measure baseline complexity if not yet available
      if (useKL && !baselineComplexity) {
        try {
          baselineIR = await parseHarness(harnessPath);
          baselineComplexity = measureComplexityFromIR(baselineIR);
        } catch {
          baselineComplexity = await measureComplexity(harnessPath);
        }
      }
    }

    // 2. ROLLBACK CHECK (aggregate regression OR per-task drop exceeding maxTaskDrop)
    let shouldRollback = iter > 0 && aggregate < bestScore;
    let rollbackMessage = shouldRollback
      ? `Regression: ${aggregate.toFixed(1)}% < ${bestScore.toFixed(1)}%. Rolling back.`
      : '';

    // Compare per-task scores against the best iteration (not previous — previous may be a rejected rollback)
    const bestLog = history.find(h => h.iteration === bestIteration);
    if (iter > 0 && !shouldRollback && bestLog) {
      for (const [taskId, score] of Object.entries(results)) {
        const currValue = score.score ?? (score.pass ? 100 : 0);
        const bestTaskScore = bestLog.taskResults[taskId];
        const bestValue = bestTaskScore ? (bestTaskScore.score ?? (bestTaskScore.pass ? 100 : 0)) : currValue;
        const drop = bestValue - currValue;
        if (drop > evolveConfig.maxTaskDrop) {
          shouldRollback = true;
          rollbackMessage = `Task ${taskId} dropped ${drop.toFixed(0)} points (${bestValue.toFixed(0)}% → ${currValue.toFixed(0)}%). Rolling back.`;
          onProgress?.({
            type: 'task-regression',
            iteration: iter,
            taskId,
            score: currValue,
            message: `dropped ${drop.toFixed(0)} points (limit: ${evolveConfig.maxTaskDrop})`,
          });
          break;
        }
      }
    }

    if (shouldRollback) {
      onProgress?.({
        type: 'rollback',
        iteration: iter,
        score: aggregate,
        message: rollbackMessage,
      });

      // Log the regression
      const rollbackLog: IterationLog = {
        iteration: iter,
        score: aggregate,
        taskResults: results,
        proposal: null,
        diffPatch: null,
        timestamp: new Date().toISOString(),
        rawScore: useKL ? rawAggregate : undefined,
        complexityCost: iterComplexityCost,
      };
      await writeIterationLog(workspacePath, rollbackLog);
      history.push(rollbackLog);

      // Instead of just copying the best harness unchanged, propose NEW mutations
      // on the best harness so the next iteration has something different to evaluate.
      const bestHarnessPath = path.join(
        workspacePath,
        'iterations',
        bestIteration.toString(),
        'harness',
      );

      if (iter + 1 < evolveConfig.maxIterations) {
        onProgress?.({ type: 'proposing', iteration: iter, message: 'Proposing new mutations after rollback' });
        try {
          let rollbackProposal = await propose(
            iter,
            workspacePath,
            bestHarnessPath,
            history,
            tasks,
            kairnConfig,
            evolveConfig.proposerModel,
          );
          const rollbackCap = computeMutationCap(iter, evolveConfig.maxIterations, evolveConfig.maxMutationsPerIteration);
          if (rollbackProposal.mutations.length > rollbackCap) {
            rollbackProposal = {
              ...rollbackProposal,
              mutations: rollbackProposal.mutations.slice(0, rollbackCap),
            };
          }
          const nextIterDir = path.join(workspacePath, 'iterations', (iter + 1).toString());
          await applyMutations(bestHarnessPath, nextIterDir, rollbackProposal.mutations);
          onProgress?.({
            type: 'mutations-applied',
            iteration: iter,
            mutationCount: rollbackProposal.mutations.length,
          });
        } catch {
          // Proposer or mutation failed — fall back to copying best harness unchanged
          const nextIterDir = path.join(workspacePath, 'iterations', (iter + 1).toString());
          await copyDir(bestHarnessPath, path.join(nextIterDir, 'harness'));
        }
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
        rawScore: useKL ? rawAggregate : undefined,
        complexityCost: iterComplexityCost,
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
        rawScore: useKL ? rawAggregate : undefined,
        complexityCost: iterComplexityCost,
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
      // Enforce mutation cap
      const iterCap = computeMutationCap(iter, evolveConfig.maxIterations, evolveConfig.maxMutationsPerIteration);
      if (proposal.mutations.length > iterCap) {
        proposal = {
          ...proposal,
          mutations: proposal.mutations.slice(0, iterCap),
        };
      }
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
        rawScore: useKL ? rawAggregate : undefined,
        complexityCost: iterComplexityCost,
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
      rawScore: useKL ? rawAggregate : undefined,
      complexityCost: iterComplexityCost,
    };
    await writeIterationLog(workspacePath, iterLog);
    history.push(iterLog);
  }

  // PRINCIPAL PROPOSER: after normal loop, synthesize the best harness from all learnings
  if (evolveConfig.usePrincipal && history.length >= 2) {
    onProgress?.({ type: 'proposing', iteration: history.length, message: 'Principal Proposer synthesizing final harness' });

    const baselineHarnessPath = path.join(workspacePath, 'iterations', '0', 'harness');
    try {
      const principalProposal = await propose(
        history.length,
        workspacePath,
        baselineHarnessPath,
        history,
        tasks,
        kairnConfig,
        evolveConfig.proposerModel,
      );

      if (principalProposal.mutations.length > evolveConfig.maxMutationsPerIteration) {
        principalProposal.mutations = principalProposal.mutations.slice(0, evolveConfig.maxMutationsPerIteration);
      }

      const principalIterNum = history.length;
      const principalIterDir = path.join(workspacePath, 'iterations', principalIterNum.toString());
      const mutResult = await applyMutations(baselineHarnessPath, principalIterDir, principalProposal.mutations);

      onProgress?.({ type: 'iteration-start', iteration: principalIterNum });
      const { results: principalResults, aggregate: principalAggregate } = await evaluateAll(
        tasks,
        mutResult.newHarnessPath,
        workspacePath,
        principalIterNum,
        kairnConfig,
        onProgress,
        evolveConfig.runsPerTask,
        evolveConfig.parallelTasks,
      );
      onProgress?.({ type: 'iteration-scored', iteration: principalIterNum, score: principalAggregate });

      const principalLog: IterationLog = {
        iteration: principalIterNum,
        score: principalAggregate,
        taskResults: principalResults,
        proposal: principalProposal,
        diffPatch: mutResult.diffPatch,
        timestamp: new Date().toISOString(),
      };
      await writeIterationLog(workspacePath, principalLog);
      history.push(principalLog);

      if (principalAggregate > bestScore) {
        bestScore = principalAggregate;
        bestIteration = principalIterNum;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      onProgress?.({ type: 'proposer-error', iteration: history.length, message: `Principal failed: ${errMsg}` });
    }
  }

  // Save run summary to proposer memory for cross-run learning
  try {
    const { buildRunSummary, saveRunSummary } = await import('./memory.js');
    const summary = buildRunSummary(history, baselineScore, bestScore);
    await saveRunSummary(workspacePath, summary);
  } catch {
    // Memory save is non-critical — don't fail the run
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
