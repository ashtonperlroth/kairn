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

import { evaluateAll } from '../runner.js';
import { propose } from '../proposer.js';
import { applyMutations } from '../mutator.js';
import { writeIterationLog } from '../trace.js';
import { copyDir } from '../baseline.js';

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

  it('rolls back on regression (score drops below best)', async () => {
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

    // Iteration 1: score 50 — REGRESSION!
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 50 } },
      aggregate: 50,
    });

    // Iteration 2: should use harness from iteration 0 (best), score 80
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

    // copyDir should have been called to rollback (copy best harness to iter 2)
    expect(mockCopyDir).toHaveBeenCalledWith(
      path.join(workspace, 'iterations', '0', 'harness'),
      path.join(workspace, 'iterations', '2', 'harness'),
    );

    // Regression logged but best score updated when iter 2 succeeds
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
});
