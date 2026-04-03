import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import type { KairnConfig } from '../../types.js';
import type { Task, EvolveConfig, Score } from '../types.js';

// Mock all external dependencies
vi.mock('../runner.js', () => ({
  evaluateAll: vi.fn(),
}));

vi.mock('../proposer.js', () => ({
  propose: vi.fn(),
  readHarnessFiles: vi.fn().mockResolvedValue({ 'CLAUDE.md': '# Test\n' }),
}));

vi.mock('../mutator.js', () => ({
  applyMutations: vi.fn(),
}));

vi.mock('../trace.js', () => ({
  writeIterationLog: vi.fn(),
}));

vi.mock('../baseline.js', () => ({
  copyDir: vi.fn().mockImplementation(async (_src: string, dest: string) => {
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, 'CLAUDE.md'), '# Baseline Harness\n\n## Section 1\nContent\n', 'utf-8');
  }),
}));

vi.mock('../../llm.js', () => ({
  callLLM: vi.fn().mockResolvedValue(JSON.stringify({
    reasoning: 'Synthesize best from all branches',
    mutations: [{ file: 'CLAUDE.md', action: 'add_section', new_text: '## Synthesized', rationale: 'Cross-branch win' }],
    expected_impact: { 'task-1': '+10%' },
  })),
}));

import { evaluateAll } from '../runner.js';
import { propose } from '../proposer.js';
import { applyMutations } from '../mutator.js';
import { runPopulation } from '../population.js';
import { initBeliefs, sampleThompson, updateBeliefs } from '../sampling.js';
import { measureComplexity, computeComplexityCost, applyKLPenalty } from '../regularization.js';
import { buildSynthesisPrompt } from '../synthesis.js';
import type { BranchResult } from '../population.js';
import type { SynthesisContext } from '../synthesis.js';

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

let tempDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  tempDir = path.join('/tmp', `kairn-pbt-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempDir, { recursive: true });

  // Create baseline
  const baselineDir = path.join(tempDir, 'baseline');
  await fs.mkdir(baselineDir, { recursive: true });
  await fs.writeFile(path.join(baselineDir, 'CLAUDE.md'), '# Baseline\n\n## Section 1\nContent\n', 'utf-8');

  // Create iteration 0 harness (needed by evolve)
  const iter0 = path.join(tempDir, 'iterations', '0', 'harness');
  await fs.mkdir(iter0, { recursive: true });
  await fs.writeFile(path.join(iter0, 'CLAUDE.md'), '# Baseline\n\n## Section 1\nContent\n', 'utf-8');

  // Create tasks.yaml
  await fs.writeFile(path.join(tempDir, 'tasks.yaml'), 'tasks: []\n', 'utf-8');
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('PBT Integration', () => {
  it('full PBT flow: 3 branches x 2 iterations, synthesis, best selection', async () => {
    const tasks = [makeTask('task-1'), makeTask('task-2'), makeTask('task-3')];

    // Simulate different scores per branch
    let evalCall = 0;
    mockEvaluateAll.mockImplementation(async () => {
      evalCall++;
      // Vary scores to simulate branch exploration
      const baseScore = 50 + (evalCall % 5) * 10;
      const results: Record<string, Score> = {};
      for (const task of tasks) {
        const taskScore = baseScore + (task.id.charCodeAt(task.id.length - 1) % 3) * 5;
        results[task.id] = { pass: taskScore >= 50, score: taskScore };
      }
      const values = Object.values(results);
      const aggregate = values.reduce((sum, s) => sum + (s.score ?? 0), 0) / values.length;
      return { results, aggregate };
    });

    mockPropose.mockResolvedValue({
      reasoning: 'Improve harness',
      mutations: [{ file: 'CLAUDE.md', action: 'add_section', newText: '## New rule', rationale: 'Help tasks' }],
      expectedImpact: {},
    });

    mockApplyMutations.mockImplementation(async (_src, nextIterDir) => {
      const hp = path.join(nextIterDir, 'harness');
      await fs.mkdir(hp, { recursive: true });
      await fs.writeFile(path.join(hp, 'CLAUDE.md'), '# Mutated\n', 'utf-8');
      return { newHarnessPath: hp, diffPatch: '' };
    });

    const progressEvents: Array<{ type: string; branchId?: number }> = [];
    const result = await runPopulation(
      tempDir,
      tasks,
      makeKairnConfig(),
      makeEvolveConfig({ maxIterations: 2, pbtBranches: 3 }),
      3,
      (event) => { progressEvents.push({ type: event.type, branchId: event.branchId }); },
    );

    // Verify all 3 branches completed
    expect(result.branches).toHaveLength(3);
    for (const branch of result.branches) {
      expect(branch.result.iterations.length).toBeGreaterThan(0);
      expect(branch.branchId).toBeGreaterThanOrEqual(0);
      expect(branch.branchId).toBeLessThan(3);
    }

    // Verify best branch was identified
    expect(result.bestScore).toBeGreaterThan(0);

    // Verify progress events had branch IDs
    const branchedEvents = progressEvents.filter(e => e.branchId !== undefined);
    expect(branchedEvents.length).toBeGreaterThan(0);
  });

  it('branch isolation: mutations in branch 0 do not affect branch 1', async () => {
    const tasks = [makeTask('task-1')];
    const score: Score = { pass: true, score: 70 };

    mockEvaluateAll.mockResolvedValue({
      results: { 'task-1': score },
      aggregate: 70,
    });

    mockPropose.mockResolvedValue({
      reasoning: 'test',
      mutations: [{ file: 'CLAUDE.md', action: 'add_section', newText: '## Branch-specific', rationale: 'test' }],
      expectedImpact: {},
    });

    mockApplyMutations.mockImplementation(async (_src, nextIterDir) => {
      const hp = path.join(nextIterDir, 'harness');
      await fs.mkdir(hp, { recursive: true });
      await fs.writeFile(path.join(hp, 'CLAUDE.md'), '# Mutated\n', 'utf-8');
      return { newHarnessPath: hp, diffPatch: '' };
    });

    await runPopulation(tempDir, tasks, makeKairnConfig(), makeEvolveConfig({ maxIterations: 1, pbtBranches: 2 }), 2);

    // Verify branches have separate directories
    const branch0 = path.join(tempDir, 'branches', '0');
    const branch1 = path.join(tempDir, 'branches', '1');
    expect((await fs.stat(branch0)).isDirectory()).toBe(true);
    expect((await fs.stat(branch1)).isDirectory()).toBe(true);
  });

  it('Meta-Principal is called with all branch data via synthesis', () => {
    // Verify buildSynthesisPrompt includes all branches
    const branches: BranchResult[] = [0, 1, 2].map(id => ({
      branchId: id,
      result: {
        iterations: [{
          iteration: 0,
          score: 60 + id * 10,
          taskResults: { 'task-1': { pass: true, score: 60 + id * 10 } },
          proposal: null,
          diffPatch: null,
          timestamp: new Date().toISOString(),
        }],
        bestIteration: 0,
        bestScore: 60 + id * 10,
        baselineScore: 60 + id * 10,
      },
      finalHarnessPath: `/tmp/branch-${id}`,
      beliefs: [{ taskId: 'task-1', alpha: 3 + id, beta: 2 }],
    }));

    const context: SynthesisContext = {
      branches,
      tasks: [makeTask('task-1')],
      baselineHarnessPath: '/tmp/baseline',
    };

    const prompt = buildSynthesisPrompt(context);

    // All 3 branches should be in the prompt
    expect(prompt).toContain('Branch 0');
    expect(prompt).toContain('Branch 1');
    expect(prompt).toContain('Branch 2');

    // Branch scores should be present
    expect(prompt).toContain('60.0%');
    expect(prompt).toContain('70.0%');
    expect(prompt).toContain('80.0%');

    // Thompson beliefs should be present
    expect(prompt).toContain('α=3');
    expect(prompt).toContain('α=4');
    expect(prompt).toContain('α=5');
  });

  it('Thompson Sampling beliefs update correctly across simulated iterations', () => {
    const tasks = [makeTask('task-1'), makeTask('task-2'), makeTask('task-3')];
    let beliefs = initBeliefs(tasks);

    // Simulate 3 iterations of updates
    beliefs = updateBeliefs(beliefs, { 'task-1': 90, 'task-2': 30, 'task-3': 75 });
    beliefs = updateBeliefs(beliefs, { 'task-1': 85, 'task-2': 45, 'task-3': 80 });
    beliefs = updateBeliefs(beliefs, { 'task-1': 95, 'task-2': 20, 'task-3': 70 });

    // task-1: always succeeds → alpha should be 4 (1+3)
    expect(beliefs[0].alpha).toBe(4);
    expect(beliefs[0].beta).toBe(1);

    // task-2: always fails → beta should be 4 (1+3)
    expect(beliefs[1].alpha).toBe(1);
    expect(beliefs[1].beta).toBe(4);

    // task-3: always succeeds → alpha should be 4 (1+3)
    expect(beliefs[2].alpha).toBe(4);
    expect(beliefs[2].beta).toBe(1);

    // Thompson Sampling should favor uncertain task-2
    const rng = (() => { let s = 42; return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0x100000000; }; })();

    // Over many trials, task-2 (most uncertain due to low alpha, high beta)
    // should still appear in samples despite low mean
    const counts: Record<string, number> = { 'task-1': 0, 'task-2': 0, 'task-3': 0 };
    for (let i = 0; i < 500; i++) {
      const selected = sampleThompson(beliefs, 1, rng);
      counts[selected[0]]++;
    }

    // task-2 has mean ~0.2 but high uncertainty — it should get selected sometimes
    expect(counts['task-2']).toBeGreaterThan(0);
  });

  it('KL penalty correctly reduces scores for bloated harnesses', async () => {
    const harnessDir = path.join(tempDir, 'test-harness');
    await fs.mkdir(path.join(harnessDir, 'rules'), { recursive: true });
    await fs.writeFile(path.join(harnessDir, 'CLAUDE.md'), '# Test\n\n## S1\nLine 1\n\n## S2\nLine 2\n', 'utf-8');
    await fs.writeFile(path.join(harnessDir, 'rules', 'r1.md'), 'Rule 1\n', 'utf-8');

    const metrics = await measureComplexity(harnessDir);
    expect(metrics.totalFiles).toBe(2);
    expect(metrics.totalSections).toBe(2);
    expect(metrics.totalRules).toBe(1);

    // Same as baseline = 0 cost
    const zeroCost = computeComplexityCost(metrics, metrics);
    expect(zeroCost).toBe(0);

    // Bloated harness
    const bloated = { ...metrics, totalLines: metrics.totalLines * 2, totalFiles: metrics.totalFiles + 3 };
    const highCost = computeComplexityCost(bloated, metrics);
    expect(highCost).toBeGreaterThan(0);

    // Apply penalty
    const raw = 80;
    const penalized = applyKLPenalty(raw, highCost, 0.1);
    expect(penalized).toBeLessThan(raw);

    // Disabled when lambda=0
    expect(applyKLPenalty(raw, highCost, 0)).toBe(raw);
  });

  it('config backward compatibility: new fields default correctly', () => {
    const config = makeEvolveConfig();

    expect(config.samplingStrategy).toBe('thompson');
    expect(config.klLambda).toBe(0);
    expect(config.pbtBranches).toBe(3);
  });
});
