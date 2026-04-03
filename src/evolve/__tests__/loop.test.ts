import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { evolve } from '../loop.js';
import type { KairnConfig } from '../../types.js';
import type { Task, EvolveConfig, IterationLog, LoopProgressEvent, Score, Proposal } from '../types.js';

vi.mock('../runner.js', () => ({
  evaluateAll: vi.fn(),
}));

vi.mock('../proposer.js', () => ({
  propose: vi.fn(),
}));

vi.mock('../mutator.js', () => ({
  applyMutations: vi.fn(),
}));

vi.mock('../trace.js', () => ({
  writeIterationLog: vi.fn(),
}));

vi.mock('../baseline.js', () => ({
  copyDir: vi.fn(),
}));

vi.mock('../architect.js', () => ({
  proposeArchitecture: vi.fn(),
}));

vi.mock('../schedule.js', () => ({
  shouldUseArchitect: vi.fn().mockReturnValue(false),
  computeArchitectMutationBudget: vi.fn().mockReturnValue(10),
}));

import { evaluateAll } from '../runner.js';
import { propose } from '../proposer.js';
import { applyMutations } from '../mutator.js';
import { writeIterationLog } from '../trace.js';
import { copyDir } from '../baseline.js';
import { proposeArchitecture } from '../architect.js';
import { shouldUseArchitect, computeArchitectMutationBudget } from '../schedule.js';

function makeKairnConfig(overrides: Partial<KairnConfig> = {}): KairnConfig {
  return {
    provider: 'anthropic',
    api_key: 'test-key',
    model: 'claude-sonnet-4-6',
    default_runtime: 'claude-code',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeEvolveConfig(overrides: Partial<EvolveConfig> = {}): EvolveConfig {
  return {
    model: 'claude-sonnet-4-6',
    proposerModel: 'claude-opus-4-6',
    scorer: 'pass-fail',
    maxIterations: 3,
    parallelTasks: 1,
    runsPerTask: 1,
    maxMutationsPerIteration: 3,
    pruneThreshold: 95,
    maxTaskDrop: 20,
    usePrincipal: false,
    evalSampleSize: 0,
    samplingStrategy: 'uniform',
    klLambda: 0,
    pbtBranches: 3,
    architectEvery: 3,
    schedule: 'explore-exploit',
    architectModel: 'claude-sonnet-4-6',
    ...overrides,
  };
}

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

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    reasoning: 'Improve the harness',
    mutations: [
      {
        file: 'CLAUDE.md',
        action: 'add_section',
        newText: '## Better instructions',
        rationale: 'Add more detail',
      },
    ],
    expectedImpact: { 'task-1': '+10%' },
    ...overrides,
  };
}

const mockEvaluateAll = vi.mocked(evaluateAll);
const mockPropose = vi.mocked(propose);
const mockApplyMutations = vi.mocked(applyMutations);
const mockWriteIterationLog = vi.mocked(writeIterationLog);
const mockCopyDir = vi.mocked(copyDir);
const mockProposeArchitecture = vi.mocked(proposeArchitecture);
const mockShouldUseArchitect = vi.mocked(shouldUseArchitect);
const mockComputeArchitectMutationBudget = vi.mocked(computeArchitectMutationBudget);

let tempDir: string;

beforeEach(async () => {
  tempDir = path.join('/tmp', `kairn-loop-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempDir, { recursive: true });

  // Reset all mocks
  vi.clearAllMocks();
  mockWriteIterationLog.mockResolvedValue(undefined);
  mockCopyDir.mockResolvedValue(undefined);
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

/**
 * Create the workspace directory structure with harness dirs for the given iterations.
 */
async function createWorkspace(iterations: number[]): Promise<string> {
  const workspace = path.join(tempDir, '.kairn-evolve');
  await fs.mkdir(workspace, { recursive: true });
  for (const iter of iterations) {
    await fs.mkdir(path.join(workspace, 'iterations', iter.toString(), 'harness'), { recursive: true });
    await fs.writeFile(
      path.join(workspace, 'iterations', iter.toString(), 'harness', 'CLAUDE.md'),
      `# Harness iteration ${iter}`,
    );
  }
  return workspace;
}

describe('evolve', () => {
  it('returns an EvolveResult with correct shape', async () => {
    const workspace = await createWorkspace([0]);
    const tasks = [makeTask('task-1')];

    // Iteration 0: score 80, no propose needed (only iteration, maxIterations=1)
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 80 } },
      aggregate: 80,
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 1 }),
    );

    expect(result).toHaveProperty('iterations');
    expect(result).toHaveProperty('bestIteration');
    expect(result).toHaveProperty('bestScore');
    expect(result).toHaveProperty('baselineScore');
    expect(Array.isArray(result.iterations)).toBe(true);
  });

  it('evaluates baseline (iteration 0) and records baselineScore', async () => {
    const workspace = await createWorkspace([0]);
    const tasks = [makeTask('task-1')];

    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 75 } },
      aggregate: 75,
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 1 }),
    );

    expect(result.baselineScore).toBe(75);
    expect(result.bestScore).toBe(75);
    expect(result.bestIteration).toBe(0);
    expect(result.iterations).toHaveLength(1);
  });

  it('calls evaluateAll with correct arguments', async () => {
    const workspace = await createWorkspace([0]);
    const tasks = [makeTask('task-1')];
    const kairnConfig = makeKairnConfig();

    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 100 } },
      aggregate: 100,
    });

    await evolve(workspace, tasks, kairnConfig, makeEvolveConfig({ maxIterations: 1 }));

    expect(mockEvaluateAll).toHaveBeenCalledWith(
      tasks,
      path.join(workspace, 'iterations', '0', 'harness'),
      workspace,
      0,
      kairnConfig,
      undefined,
      1,
      1,
    );
  });

  it('stops early on perfect score (100)', async () => {
    const workspace = await createWorkspace([0, 1, 2]);
    const tasks = [makeTask('task-1')];

    // Iteration 0 scores 100 — loop should exit immediately
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 100 } },
      aggregate: 100,
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 3 }),
    );

    expect(result.bestScore).toBe(100);
    expect(result.iterations).toHaveLength(1);
    // Should NOT have called propose since score is perfect
    expect(mockPropose).not.toHaveBeenCalled();
  });

  it('runs the full loop: evaluate -> propose -> mutate -> advance', async () => {
    const workspace = await createWorkspace([0, 1]);
    const tasks = [makeTask('task-1')];
    const proposal = makeProposal();

    // Iteration 0: score 60
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 60 } },
      aggregate: 60,
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: '--- a/CLAUDE.md\n+++ b/CLAUDE.md\n+## Better',
    });

    // Iteration 1: score 80 (last iteration)
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 80 } },
      aggregate: 80,
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 2 }),
    );

    // Both iterations should have been evaluated
    expect(mockEvaluateAll).toHaveBeenCalledTimes(2);
    // Proposer called once (after iteration 0, not after last iteration)
    expect(mockPropose).toHaveBeenCalledTimes(1);
    // Mutator called once
    expect(mockApplyMutations).toHaveBeenCalledTimes(1);
    // Two log entries
    expect(result.iterations).toHaveLength(2);
    expect(result.bestScore).toBe(80);
    expect(result.bestIteration).toBe(1);
    expect(result.baselineScore).toBe(60);
  });

  it('rolls back on regression and proposes new mutations on best harness', async () => {
    const workspace = await createWorkspace([0, 1, 2]);
    const tasks = [makeTask('task-1')];
    const proposal = makeProposal();

    // Iteration 0: score 70
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 70 } },
      aggregate: 70,
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'some diff',
    });

    // Iteration 1: score 50 — REGRESSION! Proposer called again on best harness.
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 50 } },
      aggregate: 50,
    });
    // After rollback, proposer is called to try new mutations on best (iter 0) harness
    mockPropose.mockResolvedValueOnce(makeProposal({ reasoning: 'Different approach' }));
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '2', 'harness'),
      diffPatch: 'new diff',
    });

    // Iteration 2: evaluates the NEW mutated harness, score 80
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 80 } },
      aggregate: 80,
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 3 }),
    );

    // Proposer called twice: once after iter 0 (normal), once after iter 1 (rollback)
    expect(mockPropose).toHaveBeenCalledTimes(2);
    // applyMutations called twice: once for iter 0→1, once for rollback best→2
    expect(mockApplyMutations).toHaveBeenCalledTimes(2);
    // Best score came from iter 2 with the new mutations
    expect(result.bestScore).toBe(80);
    expect(result.bestIteration).toBe(2);
    expect(result.iterations).toHaveLength(3);
  });

  it('handles proposer failure gracefully by copying harness forward', async () => {
    const workspace = await createWorkspace([0, 1]);
    const tasks = [makeTask('task-1')];

    // Iteration 0: score 60
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 60 } },
      aggregate: 60,
    });
    // Proposer throws
    mockPropose.mockRejectedValueOnce(new Error('LLM API failure'));

    // Iteration 1: should use harness copied from iteration 0 unchanged
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 60 } },
      aggregate: 60,
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 2 }),
    );

    // copyDir should have been called to copy harness forward
    expect(mockCopyDir).toHaveBeenCalledWith(
      path.join(workspace, 'iterations', '0', 'harness'),
      path.join(workspace, 'iterations', '1', 'harness'),
    );
    // Loop should still complete
    expect(result.iterations).toHaveLength(2);
  });

  it('handles mutator failure gracefully by copying harness forward', async () => {
    const workspace = await createWorkspace([0, 1]);
    const tasks = [makeTask('task-1')];
    const proposal = makeProposal();

    // Iteration 0: score 60
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 60 } },
      aggregate: 60,
    });
    mockPropose.mockResolvedValueOnce(proposal);
    // Mutator throws
    mockApplyMutations.mockRejectedValueOnce(new Error('Disk full'));

    // Iteration 1: score 65
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 65 } },
      aggregate: 65,
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 2 }),
    );

    // copyDir should have been called as fallback after mutator failure
    expect(mockCopyDir).toHaveBeenCalledWith(
      path.join(workspace, 'iterations', '0', 'harness'),
      path.join(workspace, 'iterations', '1', 'harness'),
    );
    expect(result.iterations).toHaveLength(2);
  });

  it('throws error when no baseline harness exists at iteration 0', async () => {
    // Create workspace without any harness directories
    const workspace = path.join(tempDir, '.kairn-evolve');
    await fs.mkdir(workspace, { recursive: true });

    await expect(
      evolve(workspace, [makeTask('task-1')], makeKairnConfig(), makeEvolveConfig()),
    ).rejects.toThrow('No baseline harness found');
  });

  it('does not propose on the last iteration', async () => {
    const workspace = await createWorkspace([0]);
    const tasks = [makeTask('task-1')];

    // Only 1 iteration — should evaluate but not propose
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 50 } },
      aggregate: 50,
    });

    await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 1 }),
    );

    expect(mockPropose).not.toHaveBeenCalled();
    expect(mockApplyMutations).not.toHaveBeenCalled();
  });

  it('writes iteration log for every iteration', async () => {
    const workspace = await createWorkspace([0, 1]);
    const tasks = [makeTask('task-1')];
    const proposal = makeProposal();

    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 60 } },
      aggregate: 60,
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff output',
    });

    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 80 } },
      aggregate: 80,
    });

    await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 2 }),
    );

    // writeIterationLog called twice (once per iteration)
    expect(mockWriteIterationLog).toHaveBeenCalledTimes(2);

    // First call: iteration 0 with proposal and diff
    const firstCall = mockWriteIterationLog.mock.calls[0];
    expect(firstCall[0]).toBe(workspace);
    const firstLog = firstCall[1] as IterationLog;
    expect(firstLog.iteration).toBe(0);
    expect(firstLog.score).toBe(60);
    expect(firstLog.proposal).toEqual(proposal);
    expect(firstLog.diffPatch).toBe('diff output');

    // Second call: iteration 1 with no proposal (last iteration)
    const secondCall = mockWriteIterationLog.mock.calls[1];
    const secondLog = secondCall[1] as IterationLog;
    expect(secondLog.iteration).toBe(1);
    expect(secondLog.score).toBe(80);
    expect(secondLog.proposal).toBeNull();
  });

  it('emits progress events via onProgress callback', async () => {
    const workspace = await createWorkspace([0, 1]);
    const tasks = [makeTask('task-1')];
    const proposal = makeProposal();
    const events: LoopProgressEvent[] = [];

    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 60 } },
      aggregate: 60,
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff',
    });
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 80 } },
      aggregate: 80,
    });

    await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 2 }),
      (event) => events.push(event),
    );

    // Check we got the expected event types in order
    const types = events.map(e => e.type);
    expect(types).toContain('iteration-start');
    expect(types).toContain('iteration-scored');
    expect(types).toContain('proposing');
    expect(types).toContain('mutations-applied');
    expect(types).toContain('complete');
  });

  it('emits rollback event when regression occurs', async () => {
    const workspace = await createWorkspace([0, 1, 2]);
    const tasks = [makeTask('task-1')];
    const proposal = makeProposal();
    const events: LoopProgressEvent[] = [];

    // Iteration 0: score 70
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 70 } },
      aggregate: 70,
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff',
    });

    // Iteration 1: score 40 — regression
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 40 } },
      aggregate: 40,
    });

    // Iteration 2: score 75
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 75 } },
      aggregate: 75,
    });

    await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 3 }),
      (event) => events.push(event),
    );

    const rollbackEvents = events.filter(e => e.type === 'rollback');
    expect(rollbackEvents).toHaveLength(1);
    expect(rollbackEvents[0].iteration).toBe(1);
    expect(rollbackEvents[0].score).toBe(40);
    expect(rollbackEvents[0].message).toBeDefined();
  });

  it('emits perfect-score event when score reaches 100', async () => {
    const workspace = await createWorkspace([0]);
    const tasks = [makeTask('task-1')];
    const events: LoopProgressEvent[] = [];

    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 100 } },
      aggregate: 100,
    });

    await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 3 }),
      (event) => events.push(event),
    );

    const perfectEvents = events.filter(e => e.type === 'perfect-score');
    expect(perfectEvents).toHaveLength(1);
  });

  it('includes timestamp in every iteration log', async () => {
    const workspace = await createWorkspace([0]);
    const tasks = [makeTask('task-1')];

    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 100 } },
      aggregate: 100,
    });

    await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 1 }),
    );

    const logArg = mockWriteIterationLog.mock.calls[0][1] as IterationLog;
    expect(logArg.timestamp).toBeDefined();
    // ISO timestamp format
    expect(logArg.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('handles multiple tasks with aggregate scoring', async () => {
    const workspace = await createWorkspace([0]);
    const tasks = [makeTask('task-1'), makeTask('task-2')];

    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'task-1': { pass: true, score: 80 },
        'task-2': { pass: false, score: 40 },
      },
      aggregate: 60,
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 1 }),
    );

    expect(result.bestScore).toBe(60);
    expect(result.iterations[0].taskResults).toHaveProperty('task-1');
    expect(result.iterations[0].taskResults).toHaveProperty('task-2');
  });

  it('passes history to proposer on subsequent iterations', async () => {
    const workspace = await createWorkspace([0, 1, 2]);
    const tasks = [makeTask('task-1')];
    const proposal1 = makeProposal({ reasoning: 'First proposal' });
    const proposal2 = makeProposal({ reasoning: 'Second proposal' });

    // Capture history length at each propose call since the array is
    // passed by reference and mutated after the call returns.
    const historyLengthsAtCall: number[] = [];
    const mockProposeImpl = vi.mocked(propose);
    mockProposeImpl.mockImplementation(
      async (_iter, _ws, _hp, history, _tasks, _cfg, _model) => {
        historyLengthsAtCall.push(history.length);
        if (historyLengthsAtCall.length === 1) return proposal1;
        return proposal2;
      },
    );

    // Iteration 0: score 50
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 50 } },
      aggregate: 50,
    });
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff1',
    });

    // Iteration 1: score 70
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 70 } },
      aggregate: 70,
    });
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '2', 'harness'),
      diffPatch: 'diff2',
    });

    // Iteration 2: score 90 (last)
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 90 } },
      aggregate: 90,
    });

    await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 3 }),
    );

    // Propose called twice: once for iter 0, once for iter 1
    expect(mockProposeImpl).toHaveBeenCalledTimes(2);
    // First call: no history yet (iteration 0 log not pushed until after propose)
    expect(historyLengthsAtCall[0]).toBe(0);
    // Second call: history has 1 entry (iteration 0's log)
    expect(historyLengthsAtCall[1]).toBe(1);
  });

  it('works without onProgress callback', async () => {
    const workspace = await createWorkspace([0]);
    const tasks = [makeTask('task-1')];

    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 80 } },
      aggregate: 80,
    });

    // Should not throw when onProgress is undefined
    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 1 }),
    );

    expect(result.bestScore).toBe(80);
  });

  it('stops when harness directory does not exist for a non-zero iteration', async () => {
    // Only create iteration 0 harness — iteration 1 harness is missing
    const workspace = await createWorkspace([0]);
    const tasks = [makeTask('task-1')];

    // Iteration 0: score 60
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 60 } },
      aggregate: 60,
    });
    mockPropose.mockResolvedValueOnce(makeProposal());
    // applyMutations will be called for iter 0 -> iter 1 but the harness for iter 1
    // won't exist on disk for fs.access check. The applyMutations mock creates it logically.
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff',
    });

    // Iteration 1: harness won't be found by fs.access — loop should break
    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 3 }),
    );

    // Only 1 iteration should be logged (iteration 0)
    expect(result.iterations).toHaveLength(1);
  });

  it('skips 100% tasks on middle iterations (adaptive pruning)', async () => {
    const workspace = await createWorkspace([0, 1, 2]);
    const tasks = [makeTask('always-pass'), makeTask('needs-work')];
    const proposal = makeProposal();

    // Iteration 0: always-pass=100, needs-work=60
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'always-pass': { pass: true, score: 100 },
        'needs-work': { pass: false, score: 60 },
      },
      aggregate: 80,
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff',
    });

    // Iteration 1 (MIDDLE): should only receive needs-work task
    mockEvaluateAll.mockImplementationOnce(async (tasksArg) => {
      // Verify only non-100% tasks are passed
      expect(tasksArg).toHaveLength(1);
      expect(tasksArg[0].id).toBe('needs-work');
      return {
        results: { 'needs-work': { pass: true, score: 80 } },
        aggregate: 80,
      };
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '2', 'harness'),
      diffPatch: 'diff',
    });

    // Iteration 2 (LAST): should receive ALL tasks
    mockEvaluateAll.mockImplementationOnce(async (tasksArg) => {
      expect(tasksArg).toHaveLength(2);
      return {
        results: {
          'always-pass': { pass: true, score: 100 },
          'needs-work': { pass: true, score: 85 },
        },
        aggregate: 92.5,
      };
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 3 }),
    );

    expect(result.iterations).toHaveLength(3);
    // Middle iteration aggregate includes carried-forward 100 for always-pass
    expect(result.iterations[1].score).toBe(90); // (100 + 80) / 2
  });

  it('runs all tasks on first iteration even if history has 100% scores', async () => {
    const workspace = await createWorkspace([0]);
    const tasks = [makeTask('task-1'), makeTask('task-2')];

    // Iteration 0 (FIRST): all tasks should run regardless
    mockEvaluateAll.mockImplementationOnce(async (tasksArg) => {
      expect(tasksArg).toHaveLength(2);
      return {
        results: {
          'task-1': { pass: true, score: 100 },
          'task-2': { pass: true, score: 100 },
        },
        aggregate: 100,
      };
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 1 }),
    );

    expect(result.bestScore).toBe(100);
  });

  it('emits task-skipped events for pruned tasks', async () => {
    const workspace = await createWorkspace([0, 1, 2]);
    const tasks = [makeTask('perfect'), makeTask('imperfect')];
    const events: LoopProgressEvent[] = [];
    const proposal = makeProposal();

    // Iteration 0: perfect=100, imperfect=70
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'perfect': { pass: true, score: 100 },
        'imperfect': { pass: true, score: 70 },
      },
      aggregate: 85,
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff',
    });

    // Iteration 1 (middle): only imperfect runs
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'imperfect': { pass: true, score: 80 } },
      aggregate: 80,
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '2', 'harness'),
      diffPatch: 'diff',
    });

    // Iteration 2 (last): all tasks
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'perfect': { pass: true, score: 100 },
        'imperfect': { pass: true, score: 85 },
      },
      aggregate: 92.5,
    });

    await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 3 }),
      (event) => events.push(event),
    );

    const skippedEvents = events.filter(e => e.type === 'task-skipped');
    expect(skippedEvents).toHaveLength(1);
    expect(skippedEvents[0].taskId).toBe('perfect');
    expect(skippedEvents[0].iteration).toBe(1);
  });

  it('truncates proposal mutations to maxMutationsPerIteration', async () => {
    const workspace = await createWorkspace([0, 1]);
    const tasks = [makeTask('task-1')];

    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 60 } },
      aggregate: 60,
    });

    // Proposer returns 6 mutations
    mockPropose.mockResolvedValueOnce({
      reasoning: 'Many changes',
      mutations: [
        { file: 'CLAUDE.md', action: 'add_section', newText: 'a', rationale: '1' },
        { file: 'CLAUDE.md', action: 'add_section', newText: 'b', rationale: '2' },
        { file: 'CLAUDE.md', action: 'add_section', newText: 'c', rationale: '3' },
        { file: 'CLAUDE.md', action: 'add_section', newText: 'd', rationale: '4' },
        { file: 'CLAUDE.md', action: 'add_section', newText: 'e', rationale: '5' },
        { file: 'CLAUDE.md', action: 'add_section', newText: 'f', rationale: '6' },
      ],
      expectedImpact: {},
    });
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff',
    });

    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 80 } },
      aggregate: 80,
    });

    await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 2, maxMutationsPerIteration: 2 }),
    );

    // applyMutations should receive only 2 mutations (capped from 6)
    const mutationsArg = mockApplyMutations.mock.calls[0][2];
    expect(mutationsArg).toHaveLength(2);
  });

  it('proposal with fewer mutations than cap passes through unchanged', async () => {
    const workspace = await createWorkspace([0, 1]);
    const tasks = [makeTask('task-1')];

    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 60 } },
      aggregate: 60,
    });

    mockPropose.mockResolvedValueOnce(makeProposal());
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff',
    });

    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 80 } },
      aggregate: 80,
    });

    await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 2, maxMutationsPerIteration: 5 }),
    );

    // 1 mutation from makeProposal, cap is 5 — no truncation
    const mutationsArg = mockApplyMutations.mock.calls[0][2];
    expect(mutationsArg).toHaveLength(1);
  });

  it('skips tasks at configurable pruneThreshold (not just 100)', async () => {
    const workspace = await createWorkspace([0, 1, 2]);
    const tasks = [makeTask('high-scorer'), makeTask('low-scorer')];
    const proposal = makeProposal();

    // Iteration 0: high-scorer=96, low-scorer=50
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'high-scorer': { pass: true, score: 96 },
        'low-scorer': { pass: false, score: 50 },
      },
      aggregate: 73,
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff',
    });

    // Iteration 1 (middle): high-scorer should be skipped at threshold 95
    mockEvaluateAll.mockImplementationOnce(async (tasksArg) => {
      expect(tasksArg).toHaveLength(1);
      expect(tasksArg[0].id).toBe('low-scorer');
      return {
        results: { 'low-scorer': { pass: true, score: 70 } },
        aggregate: 70,
      };
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '2', 'harness'),
      diffPatch: 'diff',
    });

    // Iteration 2 (last): all tasks run
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'high-scorer': { pass: true, score: 96 },
        'low-scorer': { pass: true, score: 75 },
      },
      aggregate: 85.5,
    });

    await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 3, pruneThreshold: 95 }),
    );

    // Middle iteration aggregate includes carried-forward 96 for high-scorer
    expect(mockWriteIterationLog.mock.calls[1][1].score).toBe(83); // (96 + 70) / 2
  });

  it('does NOT skip task scoring 94% when pruneThreshold is 95', async () => {
    const workspace = await createWorkspace([0, 1, 2]);
    const tasks = [makeTask('almost-there'), makeTask('low')];
    const proposal = makeProposal();

    // Iteration 0: almost-there=94, low=50
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'almost-there': { pass: true, score: 94 },
        'low': { pass: false, score: 50 },
      },
      aggregate: 72,
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff',
    });

    // Iteration 1 (middle): both should run since 94 < 95 threshold
    mockEvaluateAll.mockImplementationOnce(async (tasksArg) => {
      expect(tasksArg).toHaveLength(2);
      return {
        results: {
          'almost-there': { pass: true, score: 95 },
          'low': { pass: true, score: 60 },
        },
        aggregate: 77.5,
      };
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '2', 'harness'),
      diffPatch: 'diff',
    });

    // Iteration 2 (last)
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'almost-there': { pass: true, score: 96 },
        'low': { pass: true, score: 70 },
      },
      aggregate: 83,
    });

    await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 3, pruneThreshold: 95 }),
    );

    expect(mockEvaluateAll).toHaveBeenCalledTimes(3);
  });

  it('rolls back when a single task drops more than maxTaskDrop even if aggregate improves', async () => {
    const workspace = await createWorkspace([0, 1, 2]);
    const tasks = [makeTask('task-a'), makeTask('task-b')];
    const proposal = makeProposal();

    // Iteration 0: task-a=50, task-b=80 → aggregate 65
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'task-a': { pass: false, score: 50 },
        'task-b': { pass: true, score: 80 },
      },
      aggregate: 65,
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff',
    });

    // Iteration 1: task-a=90 (+40!), task-b=55 (-25!) → aggregate 72.5 (improved!)
    // But task-b dropped 25 points which exceeds maxTaskDrop=20
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'task-a': { pass: true, score: 90 },
        'task-b': { pass: false, score: 55 },
      },
      aggregate: 72.5,
    });

    // Iteration 2: after rollback
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'task-a': { pass: false, score: 55 },
        'task-b': { pass: true, score: 80 },
      },
      aggregate: 67.5,
    });

    const events: LoopProgressEvent[] = [];
    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 3, maxTaskDrop: 20 }),
      (event) => events.push(event),
    );

    // Rollback was triggered despite aggregate improving (65 → 72.5)
    const regressionEvents = events.filter(e => e.type === 'task-regression');
    expect(regressionEvents).toHaveLength(1);
    expect(regressionEvents[0].taskId).toBe('task-b');

    const rollbackEvents = events.filter(e => e.type === 'rollback');
    expect(rollbackEvents).toHaveLength(1);
    expect(rollbackEvents[0].iteration).toBe(1);
  });

  it('does NOT roll back when task drops within maxTaskDrop limit', async () => {
    const workspace = await createWorkspace([0, 1]);
    const tasks = [makeTask('task-a'), makeTask('task-b')];
    const proposal = makeProposal();

    // Iteration 0: task-a=50, task-b=80
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'task-a': { pass: false, score: 50 },
        'task-b': { pass: true, score: 80 },
      },
      aggregate: 65,
    });
    mockPropose.mockResolvedValueOnce(proposal);
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff',
    });

    // Iteration 1: task-a=85 (+35), task-b=65 (-15) → within maxTaskDrop=20
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'task-a': { pass: true, score: 85 },
        'task-b': { pass: true, score: 65 },
      },
      aggregate: 75,
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 2, maxTaskDrop: 20 }),
    );

    // No rollback — aggregate improved and no task dropped >20
    expect(result.bestScore).toBe(75);
    expect(result.bestIteration).toBe(1);
  });

  it('runs Principal Proposer after normal loop when usePrincipal is true', async () => {
    const workspace = await createWorkspace([0, 1]);
    const tasks = [makeTask('task-1')];

    // Iteration 0: score 60
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 60 } },
      aggregate: 60,
    });
    mockPropose.mockResolvedValueOnce(makeProposal());
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff',
    });

    // Iteration 1: score 75
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 75 } },
      aggregate: 75,
    });

    // Principal proposer: synthesizes from baseline, score 85
    mockPropose.mockResolvedValueOnce(makeProposal({ reasoning: 'Principal synthesis' }));
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '2', 'harness'),
      diffPatch: 'principal diff',
    });
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 85 } },
      aggregate: 85,
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 2, usePrincipal: true }),
    );

    // Principal beat the best iteration
    expect(result.bestScore).toBe(85);
    expect(result.iterations).toHaveLength(3); // 2 normal + 1 principal
  });

  it('does not run Principal when usePrincipal is false (default)', async () => {
    const workspace = await createWorkspace([0]);
    const tasks = [makeTask('task-1')];

    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 80 } },
      aggregate: 80,
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 1, usePrincipal: false }),
    );

    expect(result.iterations).toHaveLength(1);
    // Proposer not called at all (single iteration, no principal)
    expect(mockPropose).not.toHaveBeenCalled();
  });

  it('Principal does not replace best if it scores lower', async () => {
    const workspace = await createWorkspace([0, 1]);
    const tasks = [makeTask('task-1')];

    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 60 } },
      aggregate: 60,
    });
    mockPropose.mockResolvedValueOnce(makeProposal());
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: 'diff',
    });

    // Iteration 1: score 90
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 90 } },
      aggregate: 90,
    });

    // Principal: only scores 70 — worse than best
    mockPropose.mockResolvedValueOnce(makeProposal({ reasoning: 'Bad synthesis' }));
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '2', 'harness'),
      diffPatch: 'principal diff',
    });
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 70 } },
      aggregate: 70,
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 2, usePrincipal: true }),
    );

    // Best remains iteration 1, not the principal
    expect(result.bestScore).toBe(90);
    expect(result.bestIteration).toBe(1);
    expect(result.iterations).toHaveLength(3);
  });

  describe('architect staging gate', () => {
    it('uses architect proposer when shouldUseArchitect returns true', async () => {
      const workspace = await createWorkspace([0, 1, 2, 3]);
      const tasks = [makeTask('task-1')];
      const events: LoopProgressEvent[] = [];

      // shouldUseArchitect: true on iteration 1
      mockShouldUseArchitect.mockImplementation((iter) => iter === 1);
      mockComputeArchitectMutationBudget.mockReturnValue(10);

      // Iteration 0: score 60 — normal reactive path
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: false, score: 60 } },
        aggregate: 60,
      });
      mockPropose.mockResolvedValueOnce(makeProposal());
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
        diffPatch: 'diff0',
      });

      // Iteration 1: architect iteration
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: false, score: 65 } },
        aggregate: 65,
      });
      mockProposeArchitecture.mockResolvedValueOnce({
        reasoning: 'Structural improvement',
        mutations: [
          { file: 'CLAUDE.md', action: 'create_file' as const, newText: '# New structure', rationale: 'Restructure' },
        ],
        expectedImpact: { 'task-1': '+20%' },
        structural: true,
        source: 'architect' as const,
      });
      // Staging application
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'staging', '1', 'harness'),
        diffPatch: 'staging-diff',
      });
      // Staging evaluation — scores higher, should be accepted
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 80 } },
        aggregate: 80,
      });

      // Iteration 2: back to reactive (last iteration)
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 85 } },
        aggregate: 85,
      });

      const result = await evolve(
        workspace,
        tasks,
        makeKairnConfig(),
        makeEvolveConfig({ maxIterations: 3 }),
        (event) => events.push(event),
      );

      // proposeArchitecture should have been called once (iteration 1)
      expect(mockProposeArchitecture).toHaveBeenCalledTimes(1);
      // Architect-specific events should have been emitted
      const architectEvents = events.filter(e =>
        e.type === 'architect-start' ||
        e.type === 'architect-staging' ||
        e.type === 'architect-accepted' ||
        e.type === 'architect-rejected'
      );
      expect(architectEvents.length).toBeGreaterThanOrEqual(2);
      expect(architectEvents.some(e => e.type === 'architect-start')).toBe(true);
      expect(architectEvents.some(e => e.type === 'architect-accepted')).toBe(true);
    });

    it('rejects architect proposal when staging score is lower than best', async () => {
      const workspace = await createWorkspace([0, 1, 2, 3]);
      const tasks = [makeTask('task-1')];
      const events: LoopProgressEvent[] = [];

      mockShouldUseArchitect.mockImplementation((iter) => iter === 1);
      mockComputeArchitectMutationBudget.mockReturnValue(10);

      // Iteration 0: score 70
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 70 } },
        aggregate: 70,
      });
      mockPropose.mockResolvedValueOnce(makeProposal());
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
        diffPatch: 'diff0',
      });

      // Iteration 1: architect iteration
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 75 } },
        aggregate: 75,
      });
      mockProposeArchitecture.mockResolvedValueOnce({
        reasoning: 'Bold restructure',
        mutations: [
          { file: 'CLAUDE.md', action: 'replace' as const, oldText: 'old', newText: 'new', rationale: 'Change' },
        ],
        expectedImpact: { 'task-1': '+30%' },
        structural: true,
        source: 'architect' as const,
      });
      // Staging application
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'staging', '1', 'harness'),
        diffPatch: 'staging-diff',
      });
      // Staging evaluation — scores LOWER than best (75), should be rejected
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: false, score: 50 } },
        aggregate: 50,
      });

      // Iteration 2: back to reactive (last iteration) — harness should be from iter 1 (best)
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 78 } },
        aggregate: 78,
      });

      const result = await evolve(
        workspace,
        tasks,
        makeKairnConfig(),
        makeEvolveConfig({ maxIterations: 3 }),
        (event) => events.push(event),
      );

      const rejectedEvents = events.filter(e => e.type === 'architect-rejected');
      expect(rejectedEvents).toHaveLength(1);
      expect(rejectedEvents[0].iteration).toBe(1);
      // copyDir called to copy current best harness forward (not the staging one)
      expect(mockCopyDir).toHaveBeenCalled();
    });

    it('falls back to copying harness when architect proposer throws', async () => {
      const workspace = await createWorkspace([0, 1, 2, 3]);
      const tasks = [makeTask('task-1')];
      const events: LoopProgressEvent[] = [];

      mockShouldUseArchitect.mockImplementation((iter) => iter === 1);
      mockComputeArchitectMutationBudget.mockReturnValue(10);

      // Iteration 0: score 60
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: false, score: 60 } },
        aggregate: 60,
      });
      mockPropose.mockResolvedValueOnce(makeProposal());
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
        diffPatch: 'diff0',
      });

      // Iteration 1: architect iteration — but architect throws
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: false, score: 65 } },
        aggregate: 65,
      });
      mockProposeArchitecture.mockRejectedValueOnce(new Error('LLM timeout'));

      // Iteration 2 (last): reactive
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 70 } },
        aggregate: 70,
      });

      const result = await evolve(
        workspace,
        tasks,
        makeKairnConfig(),
        makeEvolveConfig({ maxIterations: 3 }),
        (event) => events.push(event),
      );

      // Should have emitted proposer-error with architect context
      const errorEvents = events.filter(e => e.type === 'proposer-error');
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].message).toContain('Architect failed');
      // copyDir should have been called to copy harness forward
      expect(mockCopyDir).toHaveBeenCalled();
      // Loop should continue running
      expect(result.iterations.length).toBeGreaterThanOrEqual(2);
    });

    it('enforces architect mutation budget from computeArchitectMutationBudget', async () => {
      const workspace = await createWorkspace([0, 1, 2, 3]);
      const tasks = [makeTask('task-1')];

      mockShouldUseArchitect.mockImplementation((iter) => iter === 1);
      mockComputeArchitectMutationBudget.mockReturnValue(2); // Only allow 2

      // Iteration 0: score 60
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: false, score: 60 } },
        aggregate: 60,
      });
      mockPropose.mockResolvedValueOnce(makeProposal());
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
        diffPatch: 'diff0',
      });

      // Iteration 1: architect proposes 5 mutations but budget is 2
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: false, score: 65 } },
        aggregate: 65,
      });
      mockProposeArchitecture.mockResolvedValueOnce({
        reasoning: 'Many structural changes',
        mutations: [
          { file: 'a.md', action: 'create_file' as const, newText: 'a', rationale: '1' },
          { file: 'b.md', action: 'create_file' as const, newText: 'b', rationale: '2' },
          { file: 'c.md', action: 'create_file' as const, newText: 'c', rationale: '3' },
          { file: 'd.md', action: 'create_file' as const, newText: 'd', rationale: '4' },
          { file: 'e.md', action: 'create_file' as const, newText: 'e', rationale: '5' },
        ],
        expectedImpact: {},
        structural: true,
        source: 'architect' as const,
      });
      // Staging: only 2 mutations should be applied
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'staging', '1', 'harness'),
        diffPatch: 'staging-diff',
      });
      // Staging eval — accept
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 80 } },
        aggregate: 80,
      });

      // Iteration 2 (last)
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 80 } },
        aggregate: 80,
      });

      await evolve(
        workspace,
        tasks,
        makeKairnConfig(),
        makeEvolveConfig({ maxIterations: 3 }),
      );

      // applyMutations for staging should have received only 2 mutations (capped from 5)
      // First call is iter 0 reactive, second is architect staging
      const stagingCallMutations = mockApplyMutations.mock.calls[1][2];
      expect(stagingCallMutations).toHaveLength(2);
    });

    it('logs architect iteration with source: architect', async () => {
      const workspace = await createWorkspace([0, 1, 2, 3]);
      const tasks = [makeTask('task-1')];

      mockShouldUseArchitect.mockImplementation((iter) => iter === 1);
      mockComputeArchitectMutationBudget.mockReturnValue(10);

      // Iteration 0: score 60
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: false, score: 60 } },
        aggregate: 60,
      });
      mockPropose.mockResolvedValueOnce(makeProposal());
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
        diffPatch: 'diff0',
      });

      // Iteration 1: architect — accepted
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: false, score: 65 } },
        aggregate: 65,
      });
      mockProposeArchitecture.mockResolvedValueOnce({
        reasoning: 'Restructure',
        mutations: [
          { file: 'CLAUDE.md', action: 'create_file' as const, newText: 'new', rationale: 'test' },
        ],
        expectedImpact: {},
        structural: true,
        source: 'architect' as const,
      });
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'staging', '1', 'harness'),
        diffPatch: 'staging-diff',
      });
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 80 } },
        aggregate: 80,
      });

      // Iteration 2 (last)
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 82 } },
        aggregate: 82,
      });

      await evolve(
        workspace,
        tasks,
        makeKairnConfig(),
        makeEvolveConfig({ maxIterations: 3 }),
      );

      // Find the architect iteration log (iteration 1)
      const architectLogCall = mockWriteIterationLog.mock.calls.find(
        (call) => (call[1] as IterationLog).iteration === 1
      );
      expect(architectLogCall).toBeDefined();
      const architectLog = architectLogCall![1] as IterationLog;
      expect(architectLog.source).toBe('architect');
    });

    it('does not call reactive propose when architect path is taken', async () => {
      const workspace = await createWorkspace([0, 1, 2, 3]);
      const tasks = [makeTask('task-1')];

      mockShouldUseArchitect.mockImplementation((iter) => iter === 1);
      mockComputeArchitectMutationBudget.mockReturnValue(10);

      // Iteration 0: score 60 — reactive
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: false, score: 60 } },
        aggregate: 60,
      });
      mockPropose.mockResolvedValueOnce(makeProposal());
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
        diffPatch: 'diff0',
      });

      // Iteration 1: architect — accepted
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: false, score: 65 } },
        aggregate: 65,
      });
      mockProposeArchitecture.mockResolvedValueOnce({
        reasoning: 'Restructure',
        mutations: [
          { file: 'CLAUDE.md', action: 'create_file' as const, newText: 'new', rationale: 'test' },
        ],
        expectedImpact: {},
        structural: true,
        source: 'architect' as const,
      });
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'staging', '1', 'harness'),
        diffPatch: 'staging-diff',
      });
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 80 } },
        aggregate: 80,
      });

      // Iteration 2 (last): reactive
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 82 } },
        aggregate: 82,
      });

      await evolve(
        workspace,
        tasks,
        makeKairnConfig(),
        makeEvolveConfig({ maxIterations: 3 }),
      );

      // reactive propose should only be called once (iteration 0), NOT for iteration 1
      expect(mockPropose).toHaveBeenCalledTimes(1);
      expect(mockProposeArchitecture).toHaveBeenCalledTimes(1);
    });

    it('falls back when staging application fails', async () => {
      const workspace = await createWorkspace([0, 1, 2, 3]);
      const tasks = [makeTask('task-1')];
      const events: LoopProgressEvent[] = [];

      mockShouldUseArchitect.mockImplementation((iter) => iter === 1);
      mockComputeArchitectMutationBudget.mockReturnValue(10);

      // Iteration 0: score 60
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: false, score: 60 } },
        aggregate: 60,
      });
      mockPropose.mockResolvedValueOnce(makeProposal());
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
        diffPatch: 'diff0',
      });

      // Iteration 1: architect — but staging application fails
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: false, score: 65 } },
        aggregate: 65,
      });
      mockProposeArchitecture.mockResolvedValueOnce({
        reasoning: 'Restructure',
        mutations: [
          { file: 'CLAUDE.md', action: 'create_file' as const, newText: 'new', rationale: 'test' },
        ],
        expectedImpact: {},
        structural: true,
        source: 'architect' as const,
      });
      // Staging application FAILS
      mockApplyMutations.mockRejectedValueOnce(new Error('Staging copy failed'));

      // Iteration 2 (last): reactive
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 70 } },
        aggregate: 70,
      });

      const result = await evolve(
        workspace,
        tasks,
        makeKairnConfig(),
        makeEvolveConfig({ maxIterations: 3 }),
        (event) => events.push(event),
      );

      // Should have emitted architect-rejected event
      const rejectedEvents = events.filter(e => e.type === 'architect-rejected');
      expect(rejectedEvents).toHaveLength(1);
      expect(rejectedEvents[0].message).toContain('Failed to apply mutations');
      // copyDir should copy harness forward
      expect(mockCopyDir).toHaveBeenCalled();
      // Loop should continue
      expect(result.iterations.length).toBeGreaterThanOrEqual(2);
    });

    it('accepts architect proposal when staging score equals best score', async () => {
      const workspace = await createWorkspace([0, 1, 2, 3]);
      const tasks = [makeTask('task-1')];
      const events: LoopProgressEvent[] = [];

      mockShouldUseArchitect.mockImplementation((iter) => iter === 1);
      mockComputeArchitectMutationBudget.mockReturnValue(10);

      // Iteration 0: score 70
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 70 } },
        aggregate: 70,
      });
      mockPropose.mockResolvedValueOnce(makeProposal());
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
        diffPatch: 'diff0',
      });

      // Iteration 1: architect — staging scores EQUAL to best (70)
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 75 } },
        aggregate: 75,
      });
      mockProposeArchitecture.mockResolvedValueOnce({
        reasoning: 'Restructure',
        mutations: [
          { file: 'CLAUDE.md', action: 'create_file' as const, newText: 'new', rationale: 'test' },
        ],
        expectedImpact: {},
        structural: true,
        source: 'architect' as const,
      });
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'staging', '1', 'harness'),
        diffPatch: 'staging-diff',
      });
      // Staging scores >= bestScore (75 >= 75) — should ACCEPT
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 75 } },
        aggregate: 75,
      });

      // Iteration 2 (last)
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 78 } },
        aggregate: 78,
      });

      await evolve(
        workspace,
        tasks,
        makeKairnConfig(),
        makeEvolveConfig({ maxIterations: 3 }),
        (event) => events.push(event),
      );

      // Should accept since staging score >= best
      const acceptedEvents = events.filter(e => e.type === 'architect-accepted');
      expect(acceptedEvents).toHaveLength(1);
    });

    it('adds source: reactive to reactive proposer logs', async () => {
      const workspace = await createWorkspace([0, 1]);
      const tasks = [makeTask('task-1')];

      // Keep architect disabled for this test
      mockShouldUseArchitect.mockReturnValue(false);

      // Iteration 0: score 60 — reactive
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: false, score: 60 } },
        aggregate: 60,
      });
      mockPropose.mockResolvedValueOnce(makeProposal());
      mockApplyMutations.mockResolvedValueOnce({
        newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
        diffPatch: 'diff0',
      });

      // Iteration 1 (last): score 80
      mockEvaluateAll.mockResolvedValueOnce({
        results: { 'task-1': { pass: true, score: 80 } },
        aggregate: 80,
      });

      await evolve(
        workspace,
        tasks,
        makeKairnConfig(),
        makeEvolveConfig({ maxIterations: 2 }),
      );

      // The reactive iteration log should have source: 'reactive'
      const iterLog0 = mockWriteIterationLog.mock.calls[0][1] as IterationLog;
      expect(iterLog0.source).toBe('reactive');
    });
  });
});
