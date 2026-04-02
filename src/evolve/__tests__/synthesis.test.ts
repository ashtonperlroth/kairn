import { describe, it, expect, vi } from 'vitest';
import { buildSynthesisPrompt } from '../synthesis.js';
import type { Task, EvolveResult, IterationLog, Score } from '../types.js';
import type { BranchResult } from '../population.js';
import type { SynthesisContext } from '../synthesis.js';

function makeTask(id: string): Task {
  return {
    id,
    template: 'add-feature',
    description: `Task ${id}`,
    setup: '',
    expected_outcome: 'Some outcome',
    scoring: 'pass-fail',
    timeout: 60,
  };
}

function makeIterationLog(iter: number, score: number, taskResults: Record<string, Score>): IterationLog {
  return {
    iteration: iter,
    score,
    taskResults,
    proposal: iter > 0 ? {
      reasoning: `Iteration ${iter} reasoning`,
      mutations: [{ file: 'CLAUDE.md', action: 'add_section', newText: `## Iter ${iter}`, rationale: `Iter ${iter} change` }],
      expectedImpact: {},
    } : null,
    diffPatch: iter > 0 ? 'some diff' : null,
    timestamp: new Date().toISOString(),
    rawScore: score + 2,
    complexityCost: 0.05,
  };
}

function makeBranchResult(branchId: number, bestScore: number, iterations: IterationLog[]): BranchResult {
  const bestIter = iterations.reduce((best, iter) =>
    iter.score > best.score ? iter : best, iterations[0]);

  return {
    branchId,
    result: {
      iterations,
      bestIteration: bestIter.iteration,
      bestScore,
      baselineScore: iterations[0]?.score ?? 0,
    },
    finalHarnessPath: `/tmp/branch-${branchId}/iterations/${bestIter.iteration}/harness`,
    beliefs: [
      { taskId: 'task-1', alpha: 5, beta: 2 },
      { taskId: 'task-2', alpha: 3, beta: 4 },
    ],
  };
}

describe('buildSynthesisPrompt', () => {
  it('includes all branch iteration logs', () => {
    const tasks = [makeTask('task-1'), makeTask('task-2')];
    const score1: Score = { pass: true, score: 80 };
    const score2: Score = { pass: false, score: 40 };

    const branches: BranchResult[] = [
      makeBranchResult(0, 75, [
        makeIterationLog(0, 60, { 'task-1': score1, 'task-2': score2 }),
        makeIterationLog(1, 75, { 'task-1': { pass: true, score: 90 }, 'task-2': { pass: false, score: 60 } }),
      ]),
      makeBranchResult(1, 70, [
        makeIterationLog(0, 55, { 'task-1': { pass: true, score: 70 }, 'task-2': { pass: false, score: 40 } }),
        makeIterationLog(1, 70, { 'task-1': { pass: true, score: 85 }, 'task-2': { pass: false, score: 55 } }),
      ]),
    ];

    const context: SynthesisContext = {
      branches,
      tasks,
      baselineHarnessPath: '/tmp/baseline',
    };

    const prompt = buildSynthesisPrompt(context);

    // Should include branch headers
    expect(prompt).toContain('Branch 0');
    expect(prompt).toContain('Branch 1');

    // Should include iteration logs
    expect(prompt).toContain('Iteration 0');
    expect(prompt).toContain('Iteration 1');

    // Should include scores
    expect(prompt).toContain('75.0%');
    expect(prompt).toContain('70.0%');
  });

  it('includes per-task score matrices', () => {
    const tasks = [makeTask('task-1'), makeTask('task-2')];
    const branches: BranchResult[] = [
      makeBranchResult(0, 80, [
        makeIterationLog(0, 80, { 'task-1': { pass: true, score: 90 }, 'task-2': { pass: true, score: 70 } }),
      ]),
    ];

    const context: SynthesisContext = {
      branches,
      tasks,
      baselineHarnessPath: '/tmp/baseline',
    };

    const prompt = buildSynthesisPrompt(context);

    expect(prompt).toContain('Cross-Branch Score Matrix');
    expect(prompt).toContain('task-1');
    expect(prompt).toContain('task-2');
  });

  it('includes Thompson beliefs from each branch', () => {
    const tasks = [makeTask('task-1')];
    const branches: BranchResult[] = [
      makeBranchResult(0, 80, [
        makeIterationLog(0, 80, { 'task-1': { pass: true, score: 80 } }),
      ]),
    ];

    const context: SynthesisContext = {
      branches,
      tasks,
      baselineHarnessPath: '/tmp/baseline',
    };

    const prompt = buildSynthesisPrompt(context);

    expect(prompt).toContain('Thompson Beliefs');
    expect(prompt).toContain('α=5');
    expect(prompt).toContain('β=2');
  });

  it('includes task definitions', () => {
    const tasks = [makeTask('task-1'), makeTask('task-2')];
    const branches: BranchResult[] = [
      makeBranchResult(0, 80, [
        makeIterationLog(0, 80, { 'task-1': { pass: true, score: 80 } }),
      ]),
    ];

    const context: SynthesisContext = {
      branches,
      tasks,
      baselineHarnessPath: '/tmp/baseline',
    };

    const prompt = buildSynthesisPrompt(context);

    expect(prompt).toContain('Task Definitions');
    expect(prompt).toContain('Task task-1');
    expect(prompt).toContain('Task task-2');
  });

  it('includes raw score and complexity cost when present', () => {
    const tasks = [makeTask('task-1')];
    const branches: BranchResult[] = [
      makeBranchResult(0, 80, [
        makeIterationLog(0, 80, { 'task-1': { pass: true, score: 80 } }),
      ]),
    ];

    const context: SynthesisContext = {
      branches,
      tasks,
      baselineHarnessPath: '/tmp/baseline',
    };

    const prompt = buildSynthesisPrompt(context);

    // rawScore = score + 2 = 82
    expect(prompt).toContain('Raw score: 82.0%');
    expect(prompt).toContain('Complexity cost: 0.050');
  });
});
