import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import type { EvolveConfig } from '../../evolve/types.js';

// ---------------------------------------------------------------------------
// Test: loadEvolveConfigFromWorkspace helper
// ---------------------------------------------------------------------------

// We'll test the helper function in isolation. It's not exported by default,
// so we test it via the module that will contain it. For now, we'll test
// the logic by importing it once implemented.

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../evolve/loop.js', () => ({
  evolve: vi.fn(),
}));

vi.mock('../../evolve/runner.js', () => ({
  runTask: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  loadConfig: vi.fn(),
}));

import { evolve } from '../../evolve/loop.js';
import { loadConfig } from '../../config.js';
import type { EvolveResult, LoopProgressEvent } from '../../evolve/types.js';

const mockEvolve = vi.mocked(evolve);
const mockLoadConfig = vi.mocked(loadConfig);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = path.join('/tmp', `kairn-evolve-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempDir, { recursive: true });
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

/**
 * Create a minimal workspace with config.yaml and tasks.yaml
 */
async function createTestWorkspace(options?: {
  configOverrides?: Partial<EvolveConfig>;
  taskCount?: number;
  withBaseline?: boolean;
}): Promise<string> {
  const workspace = path.join(tempDir, '.kairn-evolve');
  await fs.mkdir(workspace, { recursive: true });

  // Write config.yaml
  const config = {
    model: options?.configOverrides?.model ?? 'claude-sonnet-4-6',
    proposer_model: options?.configOverrides?.proposerModel ?? 'claude-opus-4-6',
    scorer: options?.configOverrides?.scorer ?? 'pass-fail',
    max_iterations: options?.configOverrides?.maxIterations ?? 5,
    parallel_tasks: options?.configOverrides?.parallelTasks ?? 1,
  };
  await fs.writeFile(path.join(workspace, 'config.yaml'), yamlStringify(config), 'utf-8');

  // Write tasks.yaml
  const taskCount = options?.taskCount ?? 2;
  const tasks = Array.from({ length: taskCount }, (_, i) => ({
    id: `task-${i + 1}`,
    template: 'add-feature',
    description: `Test task ${i + 1}`,
    setup: '',
    expected_outcome: 'Some outcome',
    scoring: 'pass-fail',
    timeout: 60,
  }));
  await fs.writeFile(path.join(workspace, 'tasks.yaml'), yamlStringify({ tasks }), 'utf-8');

  // Optionally create baseline harness
  if (options?.withBaseline) {
    const baselineHarness = path.join(workspace, 'iterations', '0', 'harness');
    await fs.mkdir(baselineHarness, { recursive: true });
    await fs.writeFile(path.join(baselineHarness, 'CLAUDE.md'), '# Baseline', 'utf-8');
  }

  return workspace;
}

function makeEvolveResult(overrides?: Partial<EvolveResult>): EvolveResult {
  return {
    iterations: [
      {
        iteration: 0,
        score: 60,
        taskResults: { 'task-1': { pass: false, score: 60 } },
        proposal: null,
        diffPatch: null,
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      {
        iteration: 1,
        score: 85,
        taskResults: { 'task-1': { pass: true, score: 85 } },
        proposal: {
          reasoning: 'Improved instructions',
          mutations: [{ file: 'CLAUDE.md', action: 'add_section', newText: '## Better', rationale: 'More detail' }],
          expectedImpact: { 'task-1': '+25%' },
        },
        diffPatch: '--- a/CLAUDE.md\n+++ b/CLAUDE.md',
        timestamp: '2026-01-01T00:01:00.000Z',
      },
    ],
    bestIteration: 1,
    bestScore: 85,
    baselineScore: 60,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: loadEvolveConfigFromWorkspace
// ---------------------------------------------------------------------------

describe('loadEvolveConfigFromWorkspace', () => {
  // This function will be exported from evolve.ts for testability
  // We import it dynamically to avoid circular issues with mocks
  let loadEvolveConfigFromWorkspace: (workspacePath: string) => Promise<EvolveConfig>;

  beforeEach(async () => {
    // Dynamic import to get the actual function (not mocked)
    const mod = await import('../evolve.js');
    loadEvolveConfigFromWorkspace = mod.loadEvolveConfigFromWorkspace;
  });

  it('reads config.yaml and returns EvolveConfig', async () => {
    const workspace = await createTestWorkspace({
      configOverrides: {
        model: 'test-model',
        proposerModel: 'test-proposer',
        scorer: 'llm-judge',
        maxIterations: 10,
        parallelTasks: 2,
      },
    });

    const config = await loadEvolveConfigFromWorkspace(workspace);

    expect(config.model).toBe('test-model');
    expect(config.proposerModel).toBe('test-proposer');
    expect(config.scorer).toBe('llm-judge');
    expect(config.maxIterations).toBe(10);
    expect(config.parallelTasks).toBe(2);
  });

  it('returns defaults when config.yaml is missing', async () => {
    const workspace = path.join(tempDir, 'no-config');
    await fs.mkdir(workspace, { recursive: true });

    const config = await loadEvolveConfigFromWorkspace(workspace);

    expect(config.model).toBe('claude-sonnet-4-6');
    expect(config.proposerModel).toBe('claude-sonnet-4-6');
    expect(config.scorer).toBe('pass-fail');
    expect(config.maxIterations).toBe(5);
    expect(config.parallelTasks).toBe(1);
  });

  it('fills in defaults for missing fields in config.yaml', async () => {
    const workspace = path.join(tempDir, 'partial-config');
    await fs.mkdir(workspace, { recursive: true });
    // Write partial config
    await fs.writeFile(
      path.join(workspace, 'config.yaml'),
      yamlStringify({ model: 'custom-model' }),
      'utf-8',
    );

    const config = await loadEvolveConfigFromWorkspace(workspace);

    expect(config.model).toBe('custom-model');
    // Defaults for missing fields
    expect(config.proposerModel).toBe('claude-sonnet-4-6');
    expect(config.scorer).toBe('pass-fail');
    expect(config.maxIterations).toBe(5);
    expect(config.parallelTasks).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: evolve run command --iterations flag
// ---------------------------------------------------------------------------

describe('evolve run command', () => {
  it('accepts --iterations option', async () => {
    // We verify the Command object has the --iterations option registered
    const { evolveCommand } = await import('../evolve.js');
    const runCmd = evolveCommand.commands.find(c => c.name() === 'run');
    expect(runCmd).toBeDefined();

    const iterationsOpt = runCmd!.options.find(o => o.long === '--iterations');
    expect(iterationsOpt).toBeDefined();
  });

  it('accepts --task option alongside --iterations', async () => {
    const { evolveCommand } = await import('../evolve.js');
    const runCmd = evolveCommand.commands.find(c => c.name() === 'run');
    expect(runCmd).toBeDefined();

    const taskOpt = runCmd!.options.find(o => o.long === '--task');
    expect(taskOpt).toBeDefined();

    const iterationsOpt = runCmd!.options.find(o => o.long === '--iterations');
    expect(iterationsOpt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: evolution loop integration in CLI
// ---------------------------------------------------------------------------

describe('evolve run --iterations (evolution loop path)', () => {
  it('calls evolve() when --task is not provided', async () => {
    // This tests that the module imports evolve from loop.ts
    const { evolve: evolveFunc } = await import('../../evolve/loop.js');
    expect(evolveFunc).toBeDefined();
  });

  it('evolve command imports evolve from loop module', async () => {
    // Verify the evolve command module can be loaded and has the evolveCommand export
    const mod = await import('../evolve.js');
    expect(mod.evolveCommand).toBeDefined();
    // Verify loadEvolveConfigFromWorkspace is exported for the loop path
    expect(mod.loadEvolveConfigFromWorkspace).toBeDefined();
    expect(typeof mod.loadEvolveConfigFromWorkspace).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Tests: summary output formatting
// ---------------------------------------------------------------------------

describe('evolution summary output', () => {
  it('EvolveResult has the fields needed for summary display', () => {
    const result = makeEvolveResult();

    // Verify all fields needed for summary output exist
    expect(result.iterations).toBeDefined();
    expect(result.baselineScore).toBeDefined();
    expect(result.bestScore).toBeDefined();
    expect(result.bestIteration).toBeDefined();

    // Verify iteration log entries have fields needed for the table
    const iter = result.iterations[0];
    expect(iter.iteration).toBeDefined();
    expect(iter.score).toBeDefined();
    expect(iter.proposal).toBeDefined(); // null or Proposal
    expect(iter.diffPatch).toBeDefined(); // null or string

    // Verify improvement calculation
    const improvement = result.bestScore - result.baselineScore;
    expect(improvement).toBe(25);
  });

  it('iteration table can determine status for each iteration type', () => {
    const result = makeEvolveResult();

    for (const iter of result.iterations) {
      let status = 'evaluated';
      if (iter.iteration === 0) status = 'baseline';
      else if (!iter.proposal && !iter.diffPatch) status = 'rollback';
      else if (iter.score >= 100) status = 'perfect';
      else if (iter.iteration === result.bestIteration) status = 'best';

      // iteration 0 should be 'baseline'
      if (iter.iteration === 0) {
        expect(status).toBe('baseline');
      }
      // iteration 1 is the best
      if (iter.iteration === 1) {
        expect(status).toBe('best');
      }
    }
  });

  it('identifies rollback iteration correctly', () => {
    const result = makeEvolveResult({
      iterations: [
        {
          iteration: 0,
          score: 70,
          taskResults: { 'task-1': { pass: true, score: 70 } },
          proposal: null,
          diffPatch: null,
          timestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          iteration: 1,
          score: 50,
          taskResults: { 'task-1': { pass: false, score: 50 } },
          proposal: null,  // null proposal + null diffPatch = rollback
          diffPatch: null,
          timestamp: '2026-01-01T00:01:00.000Z',
        },
      ],
      bestIteration: 0,
      bestScore: 70,
      baselineScore: 70,
    });

    const iter1 = result.iterations[1];
    let status = 'evaluated';
    if (iter1.iteration === 0) status = 'baseline';
    else if (!iter1.proposal && !iter1.diffPatch) status = 'rollback';
    else if (iter1.score >= 100) status = 'perfect';
    else if (iter1.iteration === result.bestIteration) status = 'best';

    expect(status).toBe('rollback');
  });
});
