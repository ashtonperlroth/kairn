import fs from 'fs/promises';
import path from 'path';
import { copyDir } from './baseline.js';
import { evolve } from './loop.js';
import { runSynthesis } from './synthesis.js';
import type { KairnConfig } from '../types.js';
import type {
  Task,
  EvolveConfig,
  EvolveResult,
  LoopProgressEvent,
} from './types.js';
import type { TaskBelief } from './sampling.js';

/**
 * Configuration for a single PBT branch.
 */
export interface BranchConfig {
  branchId: number;
  seed: number;              // RNG seed for Thompson Sampling
  workspacePath: string;     // .kairn-evolve/branches/{N}/
}

/**
 * Result from a single PBT branch.
 */
export interface BranchResult {
  branchId: number;
  result: EvolveResult;
  finalHarnessPath: string;
  beliefs: TaskBelief[];     // final Thompson beliefs from this branch
}

/**
 * Aggregate result from a PBT run (all branches + optional synthesis).
 */
export interface PBTResult {
  branches: BranchResult[];
  synthesizedResult?: EvolveResult;  // after Meta-Principal (Step 4)
  bestBranch: number;
  bestScore: number;
}

/**
 * Initialize branch workspaces by copying the baseline harness and config into
 * each branch directory.
 *
 * Creates: .kairn-evolve/branches/{0..N-1}/ with iterations/0/harness/ and tasks.yaml
 *
 * @param workspacePath - Root .kairn-evolve/ directory
 * @param baselinePath - Path to baseline harness (usually .kairn-evolve/baseline/)
 * @param numBranches - Number of parallel branches to create
 * @returns Array of BranchConfig with unique seeds
 */
export async function initBranches(
  workspacePath: string,
  baselinePath: string,
  numBranches: number,
): Promise<BranchConfig[]> {
  const branchesDir = path.join(workspacePath, 'branches');
  await fs.mkdir(branchesDir, { recursive: true });

  const configs: BranchConfig[] = [];

  for (let i = 0; i < numBranches; i++) {
    const branchPath = path.join(branchesDir, i.toString());
    const harnessPath = path.join(branchPath, 'iterations', '0', 'harness');

    // Copy baseline harness into branch's iteration 0
    await copyDir(baselinePath, harnessPath);

    // Copy tasks.yaml if it exists in the workspace
    const tasksYaml = path.join(workspacePath, 'tasks.yaml');
    try {
      await fs.access(tasksYaml);
      await fs.copyFile(tasksYaml, path.join(branchPath, 'tasks.yaml'));
    } catch {
      // tasks.yaml doesn't exist in workspace — skip
    }

    // Copy config.yaml if it exists
    const configYaml = path.join(workspacePath, 'config.yaml');
    try {
      await fs.access(configYaml);
      await fs.copyFile(configYaml, path.join(branchPath, 'config.yaml'));
    } catch {
      // config.yaml doesn't exist — skip
    }

    // Each branch gets a unique seed derived from branch index
    const seed = 42 + i * 1337;

    configs.push({
      branchId: i,
      seed,
      workspacePath: branchPath,
    });
  }

  return configs;
}

/**
 * Run N parallel evolution branches, each with its own workspace, seed, and
 * Thompson Sampling beliefs.
 *
 * All branches run concurrently via Promise.all. Each branch operates on
 * an independent copy of the baseline harness, so mutations in one branch
 * never affect another.
 *
 * @param workspacePath - Root .kairn-evolve/ directory
 * @param tasks - Task definitions from tasks.yaml
 * @param kairnConfig - Kairn config with API key and model
 * @param evolveConfig - Evolution config (iterations, proposer, etc.)
 * @param numBranches - Number of parallel branches (default: evolveConfig.pbtBranches)
 * @param onProgress - Optional callback for real-time progress (includes branchId)
 * @returns PBTResult with all branch results and best branch identification
 */
export async function runPopulation(
  workspacePath: string,
  tasks: Task[],
  kairnConfig: KairnConfig,
  evolveConfig: EvolveConfig,
  numBranches?: number,
  onProgress?: (event: LoopProgressEvent & { branchId?: number }) => void,
): Promise<PBTResult> {
  const branches = numBranches ?? evolveConfig.pbtBranches;

  // Initialize branch workspaces
  const baselinePath = path.join(workspacePath, 'baseline');
  const branchConfigs = await initBranches(workspacePath, baselinePath, branches);

  // Run all branches concurrently
  const branchPromises = branchConfigs.map(async (branchConfig) => {
    // Each branch gets its own evolve config with unique seed behavior
    // The seed is embedded in the workspace path (Thompson Sampling reads/writes
    // beliefs per-workspace, so each branch naturally gets independent beliefs)
    const branchEvolveConfig: EvolveConfig = {
      ...evolveConfig,
      // Disable principal for individual branches — synthesis replaces it
      usePrincipal: false,
    };

    const branchProgress = onProgress
      ? (event: LoopProgressEvent) => {
          onProgress({ ...event, branchId: branchConfig.branchId });
        }
      : undefined;

    const result = await evolve(
      branchConfig.workspacePath,
      tasks,
      kairnConfig,
      branchEvolveConfig,
      branchProgress,
    );

    // Find the best iteration's harness path
    const finalHarnessPath = path.join(
      branchConfig.workspacePath,
      'iterations',
      result.bestIteration.toString(),
      'harness',
    );

    // Load final beliefs
    let beliefs: TaskBelief[] = [];
    try {
      const beliefsPath = path.join(branchConfig.workspacePath, 'task-beliefs.json');
      const beliefsContent = await fs.readFile(beliefsPath, 'utf-8');
      beliefs = JSON.parse(beliefsContent) as TaskBelief[];
    } catch {
      // No beliefs saved — branch may have used uniform sampling
    }

    return {
      branchId: branchConfig.branchId,
      result,
      finalHarnessPath,
      beliefs,
    } satisfies BranchResult;
  });

  const branchResults = await Promise.all(branchPromises);

  // Identify best branch
  let bestBranch = 0;
  let bestScore = -1;
  for (const br of branchResults) {
    if (br.result.bestScore > bestScore) {
      bestScore = br.result.bestScore;
      bestBranch = br.branchId;
    }
  }

  // Meta-Principal synthesis: combine best mutations from all branches
  let synthesizedResult: EvolveResult | undefined;
  try {
    const baselinePath = path.join(workspacePath, 'baseline');
    const synthesisResult = await runSynthesis(
      { branches: branchResults, tasks, baselineHarnessPath: baselinePath },
      kairnConfig,
      evolveConfig,
      workspacePath,
    );

    if (synthesisResult) {
      const synthScore = synthesisResult.result.aggregate;
      synthesizedResult = {
        iterations: [{
          iteration: 0,
          score: synthScore,
          taskResults: synthesisResult.result.results,
          proposal: {
            reasoning: synthesisResult.reasoning,
            mutations: synthesisResult.mutations,
            expectedImpact: {},
          },
          diffPatch: null,
          timestamp: new Date().toISOString(),
        }],
        bestIteration: 0,
        bestScore: synthScore,
        baselineScore: bestScore,
      };

      onProgress?.({
        type: 'iteration-scored',
        iteration: 0,
        score: synthScore,
        message: `Meta-Principal synthesis: ${synthScore.toFixed(1)}%`,
      });

      // If synthesis beats all branches, it becomes the best
      if (synthScore > bestScore) {
        bestScore = synthScore;
        bestBranch = -1; // -1 indicates synthesis won
      }
    }
  } catch {
    // Synthesis failed — use best branch result
  }

  return {
    branches: branchResults,
    synthesizedResult,
    bestBranch,
    bestScore,
  };
}
