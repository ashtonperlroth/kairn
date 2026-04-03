/**
 * Integration tests for the evolution loop.
 *
 * These tests prove the full loop mechanics work end-to-end:
 * evaluate → propose → mutate → re-evaluate, with deterministic mocks
 * standing in for the LLM calls. No real LLM calls, no flakiness.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { evolve } from '../loop.js';
import type { KairnConfig } from '../../types.js';
import type {
  Task,
  EvolveConfig,
  LoopProgressEvent,
  Score,
  Proposal,
  Mutation,
} from '../types.js';

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

const mockEvaluateAll = vi.mocked(evaluateAll);
const mockPropose = vi.mocked(propose);
const mockApplyMutations = vi.mocked(applyMutations);
const mockWriteIterationLog = vi.mocked(writeIterationLog);
const mockCopyDir = vi.mocked(copyDir);

function makeKairnConfig(): KairnConfig {
  return {
    provider: 'anthropic',
    api_key: 'test-key',
    model: 'claude-sonnet-4-6',
    default_runtime: 'claude-code',
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function makeEvolveConfig(overrides: Partial<EvolveConfig> = {}): EvolveConfig {
  return {
    model: 'claude-sonnet-4-6',
    proposerModel: 'claude-opus-4-6',
    scorer: 'pass-fail',
    maxIterations: 4,
    parallelTasks: 1,
    runsPerTask: 1,
    maxMutationsPerIteration: 3,
    pruneThreshold: 95,
    maxTaskDrop: 20,
    usePrincipal: false,
    evalSampleSize: 0,
    samplingStrategy: 'thompson',
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

function makeProposal(mutations: Mutation[]): Proposal {
  return {
    reasoning: 'Improve the harness based on trace analysis',
    mutations,
    expectedImpact: {},
  };
}

let tempDir: string;

beforeEach(async () => {
  tempDir = path.join(
    '/tmp',
    `kairn-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tempDir, { recursive: true });
  vi.clearAllMocks();
  mockWriteIterationLog.mockResolvedValue(undefined);
  mockCopyDir.mockResolvedValue(undefined);
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function createWorkspace(iterations: number[]): Promise<string> {
  const workspace = path.join(tempDir, '.kairn-evolve');
  await fs.mkdir(workspace, { recursive: true });
  for (const iter of iterations) {
    const harnessDir = path.join(
      workspace,
      'iterations',
      iter.toString(),
      'harness',
    );
    await fs.mkdir(harnessDir, { recursive: true });
    await fs.writeFile(
      path.join(harnessDir, 'CLAUDE.md'),
      `# Harness iteration ${iter}`,
    );
  }
  return workspace;
}

describe('Evolution loop integration', () => {
  it('full loop: baseline → propose → mutate → re-evaluate → score improves', async () => {
    const workspace = await createWorkspace([0, 1, 2, 3]);
    const tasks = [makeTask('task-a'), makeTask('task-b')];
    const events: LoopProgressEvent[] = [];

    // --- Iteration 0 (baseline): score 50 ---
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'task-a': { pass: false, score: 40 },
        'task-b': { pass: true, score: 60 },
      },
      aggregate: 50,
    });

    // Proposer suggests adding a verification section
    mockPropose.mockResolvedValueOnce(
      makeProposal([
        {
          file: 'CLAUDE.md',
          action: 'add_section',
          newText: '## Verification\n\nAlways run tests before committing.',
          rationale: 'task-a failed because agent skipped tests',
        },
      ]),
    );
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: '+## Verification\n+Always run tests before committing.',
    });

    // --- Iteration 1: score 70 (improvement!) ---
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'task-a': { pass: true, score: 70 },
        'task-b': { pass: true, score: 70 },
      },
      aggregate: 70,
    });

    // Proposer suggests adding a git section
    mockPropose.mockResolvedValueOnce(
      makeProposal([
        {
          file: 'CLAUDE.md',
          action: 'add_section',
          newText: '## Git\n\nUse conventional commits.',
          rationale: 'Improve task-b commit quality',
        },
      ]),
    );
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '2', 'harness'),
      diffPatch: '+## Git\n+Use conventional commits.',
    });

    // --- Iteration 2: score 85 (another improvement!) ---
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'task-a': { pass: true, score: 80 },
        'task-b': { pass: true, score: 90 },
      },
      aggregate: 85,
    });

    // Proposer suggests one more tweak
    mockPropose.mockResolvedValueOnce(
      makeProposal([
        {
          file: 'CLAUDE.md',
          action: 'replace',
          oldText: 'Always run tests',
          newText: 'Always run tests AND lint',
          rationale: 'Add lint to verification',
        },
      ]),
    );
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '3', 'harness'),
      diffPatch: '-Always run tests\n+Always run tests AND lint',
    });

    // --- Iteration 3 (final): score 92 ---
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'task-a': { pass: true, score: 90 },
        'task-b': { pass: true, score: 94 },
      },
      aggregate: 92,
    });

    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 4 }),
      (event) => events.push(event),
    );

    // --- Assertions ---

    // Score improved from baseline
    expect(result.bestScore).toBeGreaterThan(result.baselineScore);
    expect(result.baselineScore).toBe(50);
    expect(result.bestScore).toBe(92);
    expect(result.bestIteration).toBe(3);

    // All 4 iterations were evaluated
    expect(mockEvaluateAll).toHaveBeenCalledTimes(4);

    // Proposer called 3 times (not on last iteration)
    expect(mockPropose).toHaveBeenCalledTimes(3);

    // Mutations applied 3 times
    expect(mockApplyMutations).toHaveBeenCalledTimes(3);

    // 4 iteration logs written
    expect(mockWriteIterationLog).toHaveBeenCalledTimes(4);

    // Iteration logs contain non-null proposals with mutations
    const iter0Log = mockWriteIterationLog.mock.calls[0][1];
    expect(iter0Log.proposal).not.toBeNull();
    expect(iter0Log.proposal!.mutations.length).toBeGreaterThan(0);

    // Mutation diffs are non-empty
    expect(iter0Log.diffPatch).toBeTruthy();
    expect(iter0Log.diffPatch!.length).toBeGreaterThan(0);

    // Progress events trace the full lifecycle
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'iteration-start')).toHaveLength(4);
    expect(types.filter((t) => t === 'iteration-scored')).toHaveLength(4);
    expect(types.filter((t) => t === 'proposing')).toHaveLength(3);
    expect(types.filter((t) => t === 'mutations-applied')).toHaveLength(3);
    expect(types).toContain('complete');
  });

  it('rollback: score drops → loop reverts to best iteration', async () => {
    const workspace = await createWorkspace([0, 1, 2]);
    const tasks = [makeTask('task-1')];

    // Iteration 0: score 75
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: true, score: 75 } },
      aggregate: 75,
    });
    mockPropose.mockResolvedValueOnce(
      makeProposal([
        {
          file: 'CLAUDE.md',
          action: 'add_section',
          newText: '## Bad advice\n\nSkip tests for speed.',
          rationale: 'Bad suggestion',
        },
      ]),
    );
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '1', 'harness'),
      diffPatch: '+## Bad advice',
    });

    // Iteration 1: score 40 — REGRESSION! Proposer called again with new approach.
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 40 } },
      aggregate: 40,
    });
    // After rollback, proposer tries new mutations on best (iter 0) harness
    mockPropose.mockResolvedValueOnce(
      makeProposal([
        {
          file: 'CLAUDE.md',
          action: 'add_section',
          newText: '## Better advice\n\nAlways run tests.',
          rationale: 'Previous mutation was bad, try different approach',
        },
      ]),
    );
    mockApplyMutations.mockResolvedValueOnce({
      newHarnessPath: path.join(workspace, 'iterations', '2', 'harness'),
      diffPatch: '+## Better advice',
    });

    // Iteration 2: evaluates NEW mutated harness, score 80
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

    // Proposer called twice: after iter 0 (normal) and after iter 1 (rollback)
    expect(mockPropose).toHaveBeenCalledTimes(2);
    // applyMutations called twice: iter 0→1 and rollback best→2
    expect(mockApplyMutations).toHaveBeenCalledTimes(2);

    // Best score came from iteration 2 (with new mutations after rollback)
    expect(result.bestScore).toBe(80);
    expect(result.bestIteration).toBe(2);
    expect(result.iterations).toHaveLength(3);

    // Iteration 1 was logged as a regression (no proposal, no diff)
    const iter1Log = mockWriteIterationLog.mock.calls[1][1];
    expect(iter1Log.score).toBe(40);
    expect(iter1Log.proposal).toBeNull();
  });

  it('proposer error: loop skips mutation, copies harness forward', async () => {
    const workspace = await createWorkspace([0, 1]);
    const tasks = [makeTask('task-1')];

    // Iteration 0: score 65
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 65 } },
      aggregate: 65,
    });

    // Proposer throws an error (LLM failure, JSON parse error, etc.)
    mockPropose.mockRejectedValueOnce(new Error('LLM returned invalid JSON'));

    // Iteration 1: same harness, score 65
    mockEvaluateAll.mockResolvedValueOnce({
      results: { 'task-1': { pass: false, score: 65 } },
      aggregate: 65,
    });

    const events: LoopProgressEvent[] = [];
    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 2 }),
      (event) => events.push(event),
    );

    // Harness was copied forward unchanged
    expect(mockCopyDir).toHaveBeenCalledWith(
      path.join(workspace, 'iterations', '0', 'harness'),
      path.join(workspace, 'iterations', '1', 'harness'),
    );

    // applyMutations was NOT called (proposer failed before that)
    expect(mockApplyMutations).not.toHaveBeenCalled();

    // Loop still completed both iterations
    expect(result.iterations).toHaveLength(2);
    expect(result.bestScore).toBe(65);

    // A proposer-error event was emitted
    const errorEvents = events.filter((e) => e.type === 'proposer-error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].message).toContain('LLM returned invalid JSON');
  });

  it('perfect score: loop exits early when score reaches 100', async () => {
    const workspace = await createWorkspace([0, 1, 2]);
    const tasks = [makeTask('task-1'), makeTask('task-2')];

    // Iteration 0: perfect score on all tasks
    mockEvaluateAll.mockResolvedValueOnce({
      results: {
        'task-1': { pass: true, score: 100 },
        'task-2': { pass: true, score: 100 },
      },
      aggregate: 100,
    });

    const events: LoopProgressEvent[] = [];
    const result = await evolve(
      workspace,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 3 }),
      (event) => events.push(event),
    );

    // Loop exited after just 1 iteration
    expect(result.iterations).toHaveLength(1);
    expect(result.bestScore).toBe(100);
    expect(result.baselineScore).toBe(100);
    expect(result.bestIteration).toBe(0);

    // No proposer or mutation calls — perfect score means no need to evolve
    expect(mockPropose).not.toHaveBeenCalled();
    expect(mockApplyMutations).not.toHaveBeenCalled();

    // Exactly one iteration log written (iteration 0)
    expect(mockWriteIterationLog).toHaveBeenCalledTimes(1);

    // Perfect score event emitted
    const perfectEvents = events.filter((e) => e.type === 'perfect-score');
    expect(perfectEvents).toHaveLength(1);
    expect(perfectEvents[0].score).toBe(100);
  });
});
