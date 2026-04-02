import fs from 'fs/promises';
import path from 'path';
import { callLLM } from '../llm.js';
import { readHarnessFiles } from './proposer.js';
import { parseProposerResponse } from './proposer.js';
import { applyMutations } from './mutator.js';
import { evaluateAll } from './runner.js';
import { copyDir } from './baseline.js';
import type { KairnConfig } from '../types.js';
import type {
  Task,
  Score,
  EvolveConfig,
  Mutation,
  IterationLog,
} from './types.js';
import type { BranchResult } from './population.js';
import type { TaskBelief } from './sampling.js';

/**
 * Context passed to the Meta-Principal for cross-branch synthesis.
 */
export interface SynthesisContext {
  branches: BranchResult[];
  tasks: Task[];
  baselineHarnessPath: string;
}

/**
 * Build the system prompt for the Meta-Principal.
 */
function buildMetaPrincipalSystemPrompt(numBranches: number): string {
  return `You are reviewing the COMPLETE results of ${numBranches} independent evolution runs.
Each branch explored different mutations and saw different task subsets.

Your job is SYNTHESIS, not iteration:
1. Identify mutations that helped across multiple branches (high-confidence wins)
2. Identify mutations that helped in one branch but weren't tested in others (potential wins)
3. Identify mutations that consistently hurt scores (high-confidence losses)
4. Resolve conflicts: if Branch 0 says "add verbose error rules" but Branch 2 says "remove verbose rules", use the per-task evidence to decide

Apply your selected mutations to the BASELINE harness (not any branch's final harness).
This ensures a clean synthesis — no accumulated branch-specific artifacts.

## Output Format
Return a JSON object:
{
  "reasoning": "Your synthesis analysis — which mutations from which branches, why...",
  "mutations": [
    { "file": "CLAUDE.md", "action": "replace", "old_text": "...", "new_text": "...", "rationale": "..." }
  ],
  "expected_impact": { "task-id": "+N% — explanation" }
}

## Rules
- Apply mutations to the BASELINE, not any branch's final harness
- Prefer mutations with cross-branch evidence over single-branch evidence
- If two mutations conflict, choose the one with stronger per-task evidence
- Keep it concise: harness bloat defeats the purpose

Return ONLY valid JSON.`;
}

/**
 * Build the user message for the Meta-Principal with all branch evidence.
 *
 * Includes: iteration logs, per-task score matrices, Thompson beliefs,
 * complexity metrics, and the baseline harness.
 */
export function buildSynthesisPrompt(context: SynthesisContext): string {
  const parts: string[] = [];

  // Section 1: Baseline harness summary
  parts.push('## Baseline Harness\n');
  parts.push(`Path: ${context.baselineHarnessPath}\n`);

  // Section 2: Per-branch results
  for (const branch of context.branches) {
    parts.push(`\n## Branch ${branch.branchId}\n`);
    parts.push(`Best Score: ${branch.result.bestScore.toFixed(1)}% (iteration ${branch.result.bestIteration})\n`);
    parts.push(`Baseline Score: ${branch.result.baselineScore.toFixed(1)}%\n`);

    // Iteration logs with proposals
    for (const log of branch.result.iterations) {
      parts.push(`\n### Branch ${branch.branchId} — Iteration ${log.iteration} (score: ${log.score.toFixed(1)}%)\n`);

      // Raw vs penalized score
      if (log.rawScore !== undefined) {
        parts.push(`Raw score: ${log.rawScore.toFixed(1)}%, Complexity cost: ${log.complexityCost?.toFixed(3) ?? 'N/A'}\n`);
      }

      // Task results
      const taskLines = Object.entries(log.taskResults)
        .map(([id, s]) => `  - ${id}: ${s.score !== undefined ? s.score : (s.pass ? 100 : 0)}%`)
        .join('\n');
      parts.push(`Task results:\n${taskLines}\n`);

      // Proposal
      if (log.proposal) {
        parts.push(`Proposal reasoning: ${log.proposal.reasoning}\n`);
        parts.push(`Mutations (${log.proposal.mutations.length}):\n`);
        for (const m of log.proposal.mutations) {
          parts.push(`  - ${m.action} ${m.file}: ${m.rationale}\n`);
        }
      } else {
        parts.push('(No proposal — baseline or rollback)\n');
      }
    }

    // Thompson beliefs
    if (branch.beliefs.length > 0) {
      parts.push(`\nThompson Beliefs (Branch ${branch.branchId}):\n`);
      for (const belief of branch.beliefs) {
        const mean = belief.alpha / (belief.alpha + belief.beta);
        const uncertainty = 1 / (belief.alpha + belief.beta);
        parts.push(`  - ${belief.taskId}: mean=${mean.toFixed(2)}, uncertainty=${uncertainty.toFixed(3)} (α=${belief.alpha}, β=${belief.beta})\n`);
      }
    }
  }

  // Section 3: Cross-branch score matrix
  parts.push('\n## Cross-Branch Score Matrix\n');
  parts.push('Task | ' + context.branches.map(b => `Branch ${b.branchId}`).join(' | ') + '\n');

  const allTaskIds = new Set<string>();
  for (const branch of context.branches) {
    const lastIter = branch.result.iterations[branch.result.iterations.length - 1];
    if (lastIter) {
      for (const taskId of Object.keys(lastIter.taskResults)) {
        allTaskIds.add(taskId);
      }
    }
  }

  for (const taskId of [...allTaskIds].sort()) {
    const scores = context.branches.map(b => {
      const bestIter = b.result.iterations.find(i => i.iteration === b.result.bestIteration);
      const score = bestIter?.taskResults[taskId];
      return score ? (score.score ?? (score.pass ? 100 : 0)).toFixed(0) + '%' : 'N/A';
    });
    parts.push(`${taskId} | ${scores.join(' | ')}\n`);
  }

  // Section 4: Task definitions (description only — no rubrics)
  parts.push('\n## Task Definitions\n');
  for (const task of context.tasks) {
    parts.push(`- ${task.id} (${task.template}): ${task.description}\n`);
  }

  return parts.join('');
}

/**
 * Call the Meta-Principal LLM to synthesize the best harness from all branches.
 *
 * @param context - All branch results, tasks, and baseline path
 * @param kairnConfig - Kairn config (API key, model)
 * @param evolveConfig - Evolution config (proposer model)
 * @returns Synthesized mutations and reasoning
 */
export async function synthesizeBranches(
  context: SynthesisContext,
  kairnConfig: KairnConfig,
  evolveConfig: EvolveConfig,
): Promise<{ mutations: Mutation[]; reasoning: string }> {
  const userMessage = buildSynthesisPrompt(context);
  const systemPrompt = buildMetaPrincipalSystemPrompt(context.branches.length);

  // Read baseline harness to include in context
  const harnessFiles = await readHarnessFiles(context.baselineHarnessPath);
  const harnessSection = Object.entries(harnessFiles)
    .map(([file, content]) => `### ${file}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n');

  const fullMessage = `## Current Baseline Harness Files\n\n${harnessSection}\n\n${userMessage}`;

  const proposerConfig: KairnConfig = { ...kairnConfig, model: evolveConfig.proposerModel };
  const response = await callLLM(proposerConfig, fullMessage, {
    systemPrompt,
    maxTokens: 8192,
    jsonMode: true,
    cacheControl: true,
  });

  const proposal = parseProposerResponse(response);
  return {
    mutations: proposal.mutations,
    reasoning: proposal.reasoning,
  };
}

/**
 * Evaluate the synthesized harness against ALL tasks (full suite, no sampling).
 *
 * @param synthesisHarnessPath - Path to the synthesized harness
 * @param tasks - All task definitions
 * @param workspacePath - Workspace directory for traces
 * @param kairnConfig - Kairn config
 * @returns Evaluation results and aggregate score
 */
export async function evaluateSynthesis(
  synthesisHarnessPath: string,
  tasks: Task[],
  workspacePath: string,
  kairnConfig: KairnConfig,
): Promise<{ results: Record<string, Score>; aggregate: number }> {
  const synthesisIterNum = 999; // Distinguishes synthesis eval from branch evals
  return evaluateAll(
    tasks,
    synthesisHarnessPath,
    workspacePath,
    synthesisIterNum,
    kairnConfig,
    undefined,
    1,  // single run per task for synthesis
    2,  // moderate parallelism
  );
}

/**
 * Run the full synthesis pipeline: build prompt, call LLM, apply mutations,
 * evaluate, and compare against the best branch.
 *
 * @param context - All branch results
 * @param kairnConfig - Kairn config
 * @param evolveConfig - Evolution config
 * @param workspacePath - Root workspace for synthesis output
 * @returns Synthesis evaluation result, or null if synthesis failed
 */
export async function runSynthesis(
  context: SynthesisContext,
  kairnConfig: KairnConfig,
  evolveConfig: EvolveConfig,
  workspacePath: string,
): Promise<{ result: { results: Record<string, Score>; aggregate: number }; mutations: Mutation[]; reasoning: string } | null> {
  try {
    // 1. Call Meta-Principal
    const { mutations, reasoning } = await synthesizeBranches(context, kairnConfig, evolveConfig);

    if (mutations.length === 0) {
      return null;
    }

    // 2. Apply mutations to baseline
    const synthesisDir = path.join(workspacePath, 'synthesis');
    const { newHarnessPath } = await applyMutations(
      context.baselineHarnessPath,
      synthesisDir,
      mutations,
    );

    // 3. Evaluate against all tasks
    const evalResult = await evaluateSynthesis(
      newHarnessPath,
      context.tasks,
      workspacePath,
      kairnConfig,
    );

    return { result: evalResult, mutations, reasoning };
  } catch {
    return null;
  }
}
