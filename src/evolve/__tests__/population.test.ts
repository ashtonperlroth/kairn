import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { initBranches, runPopulation } from '../population.js';
import type { KairnConfig } from '../../types.js';
import type { Task, EvolveConfig, EvolveResult, Score } from '../types.js';

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
  copyDir: vi.fn().mockImplementation(async (src: string, dest: string) => {
    await fs.mkdir(dest, { recursive: true });
    // Create a minimal CLAUDE.md so the harness directory is non-empty
    await fs.writeFile(path.join(dest, 'CLAUDE.md'), '# Test Harness\n', 'utf-8');
  }),
}));

import { evaluateAll } from '../runner.js';
import { propose } from '../proposer.js';
import { applyMutations } from '../mutator.js';

const mockEvaluateAll = vi.mocked(evaluateAll);
const mockPropose = vi.mocked(propose);
const mockApplyMutations = vi.mocked(applyMutations);

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
    maxIterations: 2,
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

let tempDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  tempDir = path.join('/tmp', `kairn-pbt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempDir, { recursive: true });

  // Create baseline directory
  const baselineDir = path.join(tempDir, 'baseline');
  await fs.mkdir(baselineDir, { recursive: true });
  await fs.writeFile(path.join(baselineDir, 'CLAUDE.md'), '# Baseline\n', 'utf-8');

  // Create tasks.yaml
  await fs.writeFile(path.join(tempDir, 'tasks.yaml'), 'tasks: []\n', 'utf-8');
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('initBranches', () => {
  it('creates N directories with baseline copies', async () => {
    const branches = await initBranches(tempDir, path.join(tempDir, 'baseline'), 3);

    expect(branches).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const branchDir = path.join(tempDir, 'branches', i.toString());
      const stat = await fs.stat(branchDir);
      expect(stat.isDirectory()).toBe(true);

      // Verify harness directory was created
      const harnessDir = path.join(branchDir, 'iterations', '0', 'harness');
      const harnessStat = await fs.stat(harnessDir);
      expect(harnessStat.isDirectory()).toBe(true);
    }
  });

  it('assigns unique seeds to each branch', async () => {
    const branches = await initBranches(tempDir, path.join(tempDir, 'baseline'), 3);

    const seeds = branches.map(b => b.seed);
    expect(new Set(seeds).size).toBe(3);
  });

  it('copies tasks.yaml to each branch', async () => {
    await initBranches(tempDir, path.join(tempDir, 'baseline'), 2);

    for (let i = 0; i < 2; i++) {
      const tasksPath = path.join(tempDir, 'branches', i.toString(), 'tasks.yaml');
      const content = await fs.readFile(tasksPath, 'utf-8');
      expect(content).toBe('tasks: []\n');
    }
  });
});

describe('runPopulation', () => {
  it('returns results from all branches with mocked evolve', async () => {
    const tasks = [makeTask('task-1'), makeTask('task-2')];
    const score: Score = { pass: true, score: 75 };

    // Mock evaluateAll to return passing scores (iteration 0 = baseline eval)
    mockEvaluateAll.mockResolvedValue({
      results: { 'task-1': score, 'task-2': score },
      aggregate: 75,
    });

    // Mock propose to return mutations
    mockPropose.mockResolvedValue({
      reasoning: 'Improve',
      mutations: [{ file: 'CLAUDE.md', action: 'add_section', newText: '## New', rationale: 'test' }],
      expectedImpact: {},
    });

    // Mock applyMutations
    mockApplyMutations.mockImplementation(async (_src, nextIterDir) => {
      const harnessPath = path.join(nextIterDir, 'harness');
      await fs.mkdir(harnessPath, { recursive: true });
      await fs.writeFile(path.join(harnessPath, 'CLAUDE.md'), '# Mutated\n', 'utf-8');
      return { newHarnessPath: harnessPath, diffPatch: '' };
    });

    const result = await runPopulation(
      tempDir,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 1, pbtBranches: 3 }),
      3,
    );

    expect(result.branches).toHaveLength(3);
    expect(result.bestScore).toBe(75);
    // All branches should have results
    for (const branch of result.branches) {
      expect(branch.result.iterations.length).toBeGreaterThan(0);
    }
  });

  it('identifies the branch with highest score', async () => {
    const tasks = [makeTask('task-1')];

    // Return different scores for different branch workspaces
    let callCount = 0;
    mockEvaluateAll.mockImplementation(async () => {
      callCount++;
      const scores = [60, 90, 70]; // Branch 1 wins
      const idx = (callCount - 1) % 3;
      const score = scores[idx];
      return {
        results: { 'task-1': { pass: score >= 50, score } },
        aggregate: score,
      };
    });

    const result = await runPopulation(
      tempDir,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 1, pbtBranches: 3 }),
      3,
    );

    expect(result.bestBranch).toBe(1);
    expect(result.bestScore).toBe(90);
  });

  it('branch workspaces are independent', async () => {
    const tasks = [makeTask('task-1')];
    const score: Score = { pass: true, score: 80 };

    mockEvaluateAll.mockResolvedValue({
      results: { 'task-1': score },
      aggregate: 80,
    });

    await runPopulation(
      tempDir,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 1, pbtBranches: 2 }),
      2,
    );

    // Verify each branch has its own workspace
    const branch0 = path.join(tempDir, 'branches', '0');
    const branch1 = path.join(tempDir, 'branches', '1');
    const stat0 = await fs.stat(branch0);
    const stat1 = await fs.stat(branch1);
    expect(stat0.isDirectory()).toBe(true);
    expect(stat1.isDirectory()).toBe(true);

    // They should be different directories
    expect(branch0).not.toBe(branch1);
  });
});
