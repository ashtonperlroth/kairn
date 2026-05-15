import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { generateMarkdownReport, generateJsonReport } from '../report.js';
import { writeIterationLog } from '../trace.js';
import { stringify as yamlStringify } from 'yaml';
import { estimateTelemetry } from '../cost.js';
import type { EvolveTelemetry } from '../cost.js';
import type { Mutation, Score } from '../types.js';

// ---------------------------------------------------------------------------
// Test workspace helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = path.join(
    '/tmp',
    `kairn-report-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

/**
 * Create a workspace with iteration logs and tasks.yaml.
 */
async function createWorkspace(opts: {
  iterations: Array<{
    iteration: number;
    score: number;
    taskResults: Record<string, Score>;
    proposal?: {
      reasoning: string;
      mutations: Mutation[];
      expectedImpact?: Record<string, string>;
    };
    source?: 'reactive' | 'architect';
    telemetry?: EvolveTelemetry;
    rawScore?: number;
    complexityCost?: number;
    timestamp?: string;
  }>;
  tasks: Array<{ id: string; template: string; description: string; category?: 'harness-sensitivity' | 'substantive' }>;
  minMeasuredTasksForBest?: number;
}): Promise<string> {
  const workspace = path.join(tempDir, '.kairn-evolve');

  // Write tasks.yaml
  await fs.mkdir(workspace, { recursive: true });
  const tasksFile = {
    tasks: opts.tasks.map(t => ({
      id: t.id,
      template: t.template,
      description: t.description,
      setup: '',
      expected_outcome: 'outcome',
      scoring: 'pass-fail',
      timeout: 60,
      ...(t.category ? { category: t.category } : {}),
    })),
  };
  await fs.writeFile(
    path.join(workspace, 'tasks.yaml'),
    yamlStringify(tasksFile),
    'utf-8',
  );
  if (opts.minMeasuredTasksForBest !== undefined) {
    await fs.writeFile(
      path.join(workspace, 'config.yaml'),
      yamlStringify({ min_measured_tasks_for_best: opts.minMeasuredTasksForBest }),
      'utf-8',
    );
  }

  for (const iter of opts.iterations) {
    await writeIterationLog(workspace, {
      iteration: iter.iteration,
      score: iter.score,
      taskResults: iter.taskResults,
      proposal: iter.proposal
        ? {
            reasoning: iter.proposal.reasoning,
            mutations: iter.proposal.mutations,
            expectedImpact: iter.proposal.expectedImpact ?? {},
          }
        : null,
      diffPatch: null,
      timestamp: iter.timestamp ?? '2026-01-01T00:00:00.000Z',
      ...(iter.telemetry ? { telemetry: iter.telemetry } : {}),
      ...(iter.source ? { source: iter.source } : {}),
      ...(iter.rawScore !== undefined ? { rawScore: iter.rawScore } : {}),
      ...(iter.complexityCost !== undefined ? { complexityCost: iter.complexityCost } : {}),
    });
  }

  return workspace;
}

// ---------------------------------------------------------------------------
// generateMarkdownReport
// ---------------------------------------------------------------------------

describe('generateMarkdownReport', () => {
  it('returns a fallback message when no iterations exist', async () => {
    const workspace = path.join(tempDir, 'empty-workspace');
    await fs.mkdir(workspace, { recursive: true });

    const md = await generateMarkdownReport(workspace);

    expect(md).toContain('No iterations found');
  });

  it('labels carried estimates in markdown reports', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 80,
          taskResults: {
            'task-1': { pass: true, score: 100 },
            'task-2': { pass: false, score: 60 },
          },
        },
        {
          iteration: 1,
          score: 90,
          taskResults: {
            'task-1': {
              pass: true,
              score: 100,
              scoreType: 'estimated',
              estimateReason: 'pruned',
              estimatedFromIteration: 0,
            },
            'task-2': { pass: true, score: 80, scoreType: 'measured' },
          },
        },
      ],
      tasks: [
        { id: 'task-1', template: 'add-feature', description: 'Task 1' },
        { id: 'task-2', template: 'fix-bug', description: 'Task 2' },
      ],
    });

    const md = await generateMarkdownReport(workspace);

    expect(md).toContain('90.0% (1 measured, 1 estimated)');
    expect(md).toContain('100% est.');
    expect(md).toContain('| Best measured score | 80.0% |');
    expect(md).toContain('| Best estimated score | 100.0% (1 estimated tasks) |');
  });

  it('does not report an under-evidenced estimate as the best iteration', async () => {
    const workspace = await createWorkspace({
      minMeasuredTasksForBest: 2,
      iterations: [
        {
          iteration: 0,
          score: 80,
          taskResults: {
            'task-1': { pass: true, score: 80, scoreType: 'measured' },
            'task-2': { pass: true, score: 80, scoreType: 'measured' },
          },
        },
        {
          iteration: 1,
          score: 95,
          taskResults: {
            'task-1': { pass: true, score: 100, scoreType: 'estimated' },
            'task-2': { pass: true, score: 90, scoreType: 'measured' },
          },
        },
      ],
      tasks: [
        { id: 'task-1', template: 'add-feature', description: 'Task 1' },
        { id: 'task-2', template: 'fix-bug', description: 'Task 2' },
      ],
    });

    const md = await generateMarkdownReport(workspace);
    const report = await generateJsonReport(workspace);

    expect(md).toContain('| Best score | 80.0% |');
    expect(md).toContain('| Best iteration | 0 |');
    expect(report.overview.bestScore).toBe(80);
    expect(report.overview.bestIteration).toBe(0);
  });

  it('includes overview section with correct scores', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 50, taskResults: { 'task-1': { pass: false, score: 50 } } },
        { iteration: 1, score: 80, taskResults: { 'task-1': { pass: true, score: 80 } } },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Add feature' }],
    });

    const md = await generateMarkdownReport(workspace);

    expect(md).toContain('# Evolution Report');
    expect(md).toContain('## Overview');
    expect(md).toContain('50.0%');
    expect(md).toContain('80.0%');
    expect(md).toContain('+30.0 points');
  });

  it('includes iteration summary table', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 60, taskResults: { 'task-1': { pass: false, score: 60 } } },
        { iteration: 1, score: 90, taskResults: { 'task-1': { pass: true, score: 90 } } },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Add feature' }],
    });

    const md = await generateMarkdownReport(workspace);

    expect(md).toContain('## Iterations');
    expect(md).toContain('| Iter | Score | Mutations | Mode | Usage | Cost | Status |');
    expect(md).toContain('baseline');
  });

  it('aggregates cost by phase in markdown reports', async () => {
    const proposerTelemetry = estimateTelemetry({
      phase: 'proposer',
      model: 'claude-sonnet-4-6',
      durationMs: 12,
      inputText: 'prompt',
      outputText: 'proposal',
      source: 'test',
    });
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 60,
          taskResults: { 'task-1': { pass: false, score: 60 } },
          telemetry: proposerTelemetry,
        },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Add feature' }],
    });

    const md = await generateMarkdownReport(workspace);

    expect(md).toContain('## Cost by Phase');
    expect(md).toContain('| proposer | 1 |');
  });

  it('includes leaderboard table', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 50,
          taskResults: {
            'task-1': { pass: false, score: 40 },
            'task-2': { pass: false, score: 60 },
          },
        },
        {
          iteration: 1,
          score: 75,
          taskResults: {
            'task-1': { pass: true, score: 80 },
            'task-2': { pass: true, score: 70 },
          },
        },
      ],
      tasks: [
        { id: 'task-1', template: 'add-feature', description: 'Task 1' },
        { id: 'task-2', template: 'fix-bug', description: 'Task 2' },
      ],
    });

    const md = await generateMarkdownReport(workspace);

    expect(md).toContain('## Leaderboard');
    expect(md).toContain('task-1');
    expect(md).toContain('task-2');
  });
});

// ---------------------------------------------------------------------------
// generateJsonReport
// ---------------------------------------------------------------------------

describe('generateJsonReport', () => {
  it('returns valid EvolutionReport structure', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 50, taskResults: { 'task-1': { pass: false, score: 50 } } },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Add feature' }],
    });

    const report = await generateJsonReport(workspace);

    expect(report).toHaveProperty('overview');
    expect(report).toHaveProperty('iterations');
    expect(report).toHaveProperty('leaderboard');
    expect(report).toHaveProperty('counterfactuals');
    expect(report.overview).toHaveProperty('usage');
    expect(report.overview).toHaveProperty('cost');
  });

  it('overview contains correct metrics', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 40, taskResults: { 'task-1': { pass: false, score: 40 } } },
        { iteration: 1, score: 70, taskResults: { 'task-1': { pass: true, score: 70 } } },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const report = await generateJsonReport(workspace);

    expect(report.overview.totalIterations).toBe(2);
    expect(report.overview.baselineScore).toBe(40);
    expect(report.overview.bestScore).toBe(70);
    expect(report.overview.bestIteration).toBe(1);
    expect(report.overview.improvement).toBe(30);
  });

  it('aggregates cost by phase in JSON reports', async () => {
    const scorerTelemetry = estimateTelemetry({
      phase: 'scorer',
      model: 'claude-sonnet-4-6',
      durationMs: 8,
      inputText: 'judge',
      outputText: 'score',
      source: 'test',
    });
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 50,
          taskResults: { 'task-1': { pass: false, score: 50 } },
          telemetry: scorerTelemetry,
        },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const report = await generateJsonReport(workspace);

    expect(report.overview.costByPhase?.scorer?.calls).toBe(1);
    expect(report.overview.costByPhase?.scorer?.cost.estimatedUSD).toBeGreaterThan(0);
  });

  it('iterations array has correct entries', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 50, taskResults: { 'task-1': { pass: false, score: 50 } } },
        { iteration: 1, score: 80, taskResults: { 'task-1': { pass: true, score: 80 } } },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const report = await generateJsonReport(workspace);

    expect(report.iterations).toHaveLength(2);
    expect(report.iterations[0].iteration).toBe(0);
    expect(report.iterations[0].status).toBe('baseline');
    expect(report.iterations[1].iteration).toBe(1);
    expect(report.iterations[1].score).toBe(80);
  });

  it('reports mutation counts from complete persisted proposals after reload', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 50, taskResults: { 'task-1': { pass: false, score: 50 } } },
        {
          iteration: 1,
          score: 80,
          taskResults: { 'task-1': { pass: true, score: 80 } },
          proposal: {
            reasoning: 'Use stricter verification',
            mutations: [{
              file: 'CLAUDE.md',
              action: 'add_section',
              newText: '## Verify',
              rationale: 'Require explicit validation',
            }],
            expectedImpact: { 'task-1': 'higher pass rate' },
          },
        },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const report = await generateJsonReport(workspace);

    expect(report.iterations[1].mutationCount).toBe(1);
  });

  it('reports mutation rationale in counterfactual reasoning after reload', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 50, taskResults: { 'task-1': { pass: false, score: 50 } } },
        {
          iteration: 1,
          score: 55,
          taskResults: { 'task-1': { pass: false, score: 55 } },
          proposal: {
            reasoning: 'Improve validation instructions',
            mutations: [{
              file: 'CLAUDE.md',
              action: 'add_section',
              newText: '## Validate',
              rationale: 'Require exact test evidence',
            }],
          },
        },
        { iteration: 2, score: 85, taskResults: { 'task-1': { pass: true, score: 85 } } },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const md = await generateMarkdownReport(workspace);

    expect(md).toContain('add_section in CLAUDE.md: Require exact test evidence');
  });

  it('leaderboard tracks per-task scores across iterations', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 50,
          taskResults: {
            'task-1': { pass: false, score: 30 },
            'task-2': { pass: true, score: 70 },
          },
        },
        {
          iteration: 1,
          score: 75,
          taskResults: {
            'task-1': { pass: true, score: 80 },
            'task-2': { pass: true, score: 70 },
          },
        },
      ],
      tasks: [
        { id: 'task-1', template: 'add-feature', description: 'Task 1' },
        { id: 'task-2', template: 'fix-bug', description: 'Task 2' },
      ],
    });

    const report = await generateJsonReport(workspace);

    expect(report.leaderboard).toHaveLength(2);

    const task1 = report.leaderboard.find(e => e.taskId === 'task-1');
    expect(task1).toBeDefined();
    expect(task1!.scores[0]).toBe(30);
    expect(task1!.scores[1]).toBe(80);
    expect(task1!.bestScore).toBe(80);
    expect(task1!.bestIteration).toBe(1);
  });

  it('handles empty workspace gracefully', async () => {
    const workspace = path.join(tempDir, 'empty');
    await fs.mkdir(workspace, { recursive: true });

    const report = await generateJsonReport(workspace);

    expect(report.overview.totalIterations).toBe(0);
    expect(report.iterations).toHaveLength(0);
    expect(report.leaderboard).toHaveLength(0);
  });

  it('output is valid JSON when stringified', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 60, taskResults: { 'task-1': { pass: false, score: 60 } } },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const report = await generateJsonReport(workspace);
    const json = JSON.stringify(report);
    const parsed = JSON.parse(json) as unknown;

    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe('object');
  });

  it('includes stddev in iterations when variance data exists', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 80,
          taskResults: {
            'task-1': {
              pass: true,
              score: 80,
              variance: { runs: 3, scores: [70, 80, 90], mean: 80, stddev: 8.16 },
            },
          },
        },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const report = await generateJsonReport(workspace);
    expect(report.iterations[0].stddev).toBeCloseTo(8.16, 1);
  });

  it('omits stddev in iterations when no variance data', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 80, taskResults: { 'task-1': { pass: true, score: 80 } } },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const report = await generateJsonReport(workspace);
    expect(report.iterations[0].stddev).toBeUndefined();
  });

  it('includes variance in leaderboard when present', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 75,
          taskResults: {
            'task-1': {
              pass: true,
              score: 75,
              variance: { runs: 3, scores: [70, 75, 80], mean: 75, stddev: 4.08 },
            },
          },
        },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const report = await generateJsonReport(workspace);
    expect(report.leaderboard[0].variance).toBeDefined();
    expect(report.leaderboard[0].variance![0].runs).toBe(3);
    expect(report.leaderboard[0].variance![0].stddev).toBeCloseTo(4.08, 1);
  });

  it('includes usage and estimated cost telemetry in overview and iterations', async () => {
    const telemetry: EvolveTelemetry = {
      phase: 'iteration',
      model: 'claude-sonnet-4-6',
      durationMs: 1200,
      usage: {
        status: 'estimated',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        source: 'test',
        reason: 'test estimate',
      },
      cost: {
        status: 'estimated',
        estimatedUSD: 0.00105,
        currency: 'USD',
        source: 'test',
        reason: 'test estimate',
      },
    };
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 80, taskResults: { 'task-1': { pass: true, score: 80 } }, telemetry },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const report = await generateJsonReport(workspace);

    expect(report.overview.usage?.status).toBe('estimated');
    expect(report.overview.usage?.totalTokens).toBe(150);
    expect(report.overview.cost?.estimatedUSD).toBe(0.00105);
    expect(report.iterations[0].model).toBe('claude-sonnet-4-6');
    expect(report.iterations[0].phase).toBe('iteration');
    expect(report.iterations[0].durationMs).toBe(1200);
    expect(report.iterations[0].usage?.status).toBe('estimated');
    expect(report.iterations[0].cost?.status).toBe('estimated');
  });
});

describe('generateMarkdownReport with variance', () => {
  it('shows ±stddev in iteration table when variance data exists', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 70,
          taskResults: {
            'task-1': {
              pass: true,
              score: 70,
              variance: { runs: 3, scores: [60, 70, 80], mean: 70, stddev: 8.16 },
            },
          },
        },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const md = await generateMarkdownReport(workspace);
    expect(md).toContain('±8.2');
  });

  it('shows ±stddev in leaderboard per task', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 65,
          taskResults: {
            'task-1': {
              pass: true,
              score: 65,
              variance: { runs: 3, scores: [60, 65, 70], mean: 65, stddev: 4.08 },
            },
          },
        },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const md = await generateMarkdownReport(workspace);
    expect(md).toContain('65% ±4.1');
  });

  it('does NOT show stddev when no variance data exists', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 80, taskResults: { 'task-1': { pass: true, score: 80 } } },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const md = await generateMarkdownReport(workspace);
    expect(md).not.toContain('±');
  });
});

// ---------------------------------------------------------------------------
// Mode column and architect iteration tracking
// ---------------------------------------------------------------------------

describe('generateMarkdownReport with mode column', () => {
  it('includes Mode column in iteration table header', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 50, taskResults: { 'task-1': { pass: false, score: 50 } } },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const md = await generateMarkdownReport(workspace);
    expect(md).toContain('| Iter | Score | Mutations | Mode | Usage | Cost | Status |');
  });

  it('shows reactive mode for iterations without source', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 50, taskResults: { 'task-1': { pass: false, score: 50 } } },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const md = await generateMarkdownReport(workspace);
    expect(md).toContain('| reactive |');
  });

  it('shows architect mode for architect iterations', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 50, taskResults: { 'task-1': { pass: false, score: 50 } } },
        { iteration: 1, score: 70, taskResults: { 'task-1': { pass: true, score: 70 } }, source: 'architect' },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const md = await generateMarkdownReport(workspace);
    expect(md).toContain('| architect |');
  });

  it('includes Architect Iterations section when architect iterations exist', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 50, taskResults: { 'task-1': { pass: false, score: 50 } } },
        { iteration: 1, score: 78.5, taskResults: { 'task-1': { pass: true, score: 78.5 } }, source: 'architect' },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const md = await generateMarkdownReport(workspace);
    expect(md).toContain('## Architect Iterations');
    expect(md).toContain('Iteration 1: architect (score: 78.5)');
  });

  it('omits Architect Iterations section when no architect iterations exist', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 50, taskResults: { 'task-1': { pass: false, score: 50 } } },
        { iteration: 1, score: 70, taskResults: { 'task-1': { pass: true, score: 70 } }, source: 'reactive' },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const md = await generateMarkdownReport(workspace);
    expect(md).not.toContain('## Architect Iterations');
  });
});

describe('generateJsonReport with mode field', () => {
  it('includes mode field in iterations array', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 50, taskResults: { 'task-1': { pass: false, score: 50 } } },
        { iteration: 1, score: 70, taskResults: { 'task-1': { pass: true, score: 70 } }, source: 'architect' },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const report = await generateJsonReport(workspace);
    expect(report.iterations[0].mode).toBe('reactive');
    expect(report.iterations[1].mode).toBe('architect');
  });

  it('defaults mode to reactive when source is not set', async () => {
    const workspace = await createWorkspace({
      iterations: [
        { iteration: 0, score: 50, taskResults: { 'task-1': { pass: false, score: 50 } } },
      ],
      tasks: [{ id: 'task-1', template: 'add-feature', description: 'Task' }],
    });

    const report = await generateJsonReport(workspace);
    expect(report.iterations[0].mode).toBe('reactive');
  });
});

// ---------------------------------------------------------------------------
// Category breakdown in reports
// ---------------------------------------------------------------------------

describe('generateMarkdownReport with category breakdown', () => {
  it('shows separate scores when tasks have mixed categories', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 72.5,
          taskResults: {
            'harness-1': { pass: true, score: 80 },
            'harness-2': { pass: true, score: 90 },
            'substantive-1': { pass: false, score: 50 },
            'substantive-2': { pass: true, score: 70 },
          },
        },
      ],
      tasks: [
        { id: 'harness-1', template: 'convention-adherence', description: 'Harness 1', category: 'harness-sensitivity' },
        { id: 'harness-2', template: 'rule-compliance', description: 'Harness 2', category: 'harness-sensitivity' },
        { id: 'substantive-1', template: 'real-bug-fix', description: 'Substantive 1', category: 'substantive' },
        { id: 'substantive-2', template: 'real-feature-add', description: 'Substantive 2', category: 'substantive' },
      ],
    });

    const md = await generateMarkdownReport(workspace);

    expect(md).toContain('Harness adherence');
    expect(md).toContain('Substantive tasks');
    // Check it reports counts
    expect(md).toContain('2 tasks');
  });

  it('shows only overall score when all tasks are one category', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 80,
          taskResults: {
            'task-1': { pass: true, score: 80 },
            'task-2': { pass: true, score: 80 },
          },
        },
      ],
      tasks: [
        { id: 'task-1', template: 'convention-adherence', description: 'Task 1', category: 'harness-sensitivity' },
        { id: 'task-2', template: 'rule-compliance', description: 'Task 2', category: 'harness-sensitivity' },
      ],
    });

    const md = await generateMarkdownReport(workspace);

    expect(md).not.toContain('Harness adherence');
    expect(md).not.toContain('Substantive tasks');
  });

  it('defaults tasks without category to harness-sensitivity', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 75,
          taskResults: {
            'no-category': { pass: true, score: 80 },
            'substantive-1': { pass: false, score: 70 },
          },
        },
      ],
      tasks: [
        { id: 'no-category', template: 'add-feature', description: 'No category set' },
        { id: 'substantive-1', template: 'real-bug-fix', description: 'Substantive', category: 'substantive' },
      ],
    });

    const md = await generateMarkdownReport(workspace);

    // Should show breakdown because there are two categories
    expect(md).toContain('Harness adherence');
    expect(md).toContain('Substantive tasks');
    // The no-category task defaults to harness-sensitivity (80%), substantive is 70%
    expect(md).toContain('80.0% (1 tasks)');
    expect(md).toContain('70.0% (1 tasks)');
  });

  it('shows category breakdown at the best iteration', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 50,
          taskResults: {
            'h1': { pass: false, score: 40 },
            's1': { pass: false, score: 60 },
          },
        },
        {
          iteration: 1,
          score: 75,
          taskResults: {
            'h1': { pass: true, score: 90 },
            's1': { pass: false, score: 60 },
          },
        },
      ],
      tasks: [
        { id: 'h1', template: 'convention-adherence', description: 'Harness', category: 'harness-sensitivity' },
        { id: 's1', template: 'real-bug-fix', description: 'Substantive', category: 'substantive' },
      ],
    });

    const md = await generateMarkdownReport(workspace);

    // At best iteration (1): harness = 90%, substantive = 60%
    expect(md).toContain('90.0%');
    expect(md).toContain('60.0%');
    expect(md).toContain('Harness adherence');
    expect(md).toContain('Substantive tasks');
  });
});

describe('generateJsonReport with category breakdown', () => {
  it('includes categoryBreakdown in overview when mixed categories', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 72.5,
          taskResults: {
            'h1': { pass: true, score: 80 },
            'h2': { pass: true, score: 90 },
            's1': { pass: false, score: 50 },
            's2': { pass: true, score: 70 },
          },
        },
      ],
      tasks: [
        { id: 'h1', template: 'convention-adherence', description: 'H1', category: 'harness-sensitivity' },
        { id: 'h2', template: 'rule-compliance', description: 'H2', category: 'harness-sensitivity' },
        { id: 's1', template: 'real-bug-fix', description: 'S1', category: 'substantive' },
        { id: 's2', template: 'real-feature-add', description: 'S2', category: 'substantive' },
      ],
    });

    const report = await generateJsonReport(workspace);

    expect(report.overview.categoryBreakdown).toBeDefined();
    expect(report.overview.categoryBreakdown!.harnessAdherence).toEqual({
      score: 85,
      count: 2,
    });
    expect(report.overview.categoryBreakdown!.substantiveTasks).toEqual({
      score: 60,
      count: 2,
    });
  });

  it('omits categoryBreakdown when all tasks are one category', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 80,
          taskResults: {
            'h1': { pass: true, score: 80 },
          },
        },
      ],
      tasks: [
        { id: 'h1', template: 'convention-adherence', description: 'H1', category: 'harness-sensitivity' },
      ],
    });

    const report = await generateJsonReport(workspace);

    expect(report.overview.categoryBreakdown).toBeUndefined();
  });

  it('defaults tasks without category to harness-sensitivity in JSON', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 75,
          taskResults: {
            'no-cat': { pass: true, score: 80 },
            's1': { pass: false, score: 70 },
          },
        },
      ],
      tasks: [
        { id: 'no-cat', template: 'add-feature', description: 'No cat' },
        { id: 's1', template: 'real-bug-fix', description: 'S1', category: 'substantive' },
      ],
    });

    const report = await generateJsonReport(workspace);

    expect(report.overview.categoryBreakdown).toBeDefined();
    expect(report.overview.categoryBreakdown!.harnessAdherence.count).toBe(1);
    expect(report.overview.categoryBreakdown!.harnessAdherence.score).toBe(80);
    expect(report.overview.categoryBreakdown!.substantiveTasks.count).toBe(1);
    expect(report.overview.categoryBreakdown!.substantiveTasks.score).toBe(70);
  });

  it('computes category scores at best iteration', async () => {
    const workspace = await createWorkspace({
      iterations: [
        {
          iteration: 0,
          score: 50,
          taskResults: {
            'h1': { pass: false, score: 40 },
            's1': { pass: false, score: 60 },
          },
        },
        {
          iteration: 1,
          score: 75,
          taskResults: {
            'h1': { pass: true, score: 90 },
            's1': { pass: false, score: 60 },
          },
        },
      ],
      tasks: [
        { id: 'h1', template: 'convention-adherence', description: 'H', category: 'harness-sensitivity' },
        { id: 's1', template: 'real-bug-fix', description: 'S', category: 'substantive' },
      ],
    });

    const report = await generateJsonReport(workspace);

    // Best iteration is 1 (score: 75)
    expect(report.overview.categoryBreakdown).toBeDefined();
    expect(report.overview.categoryBreakdown!.harnessAdherence.score).toBe(90);
    expect(report.overview.categoryBreakdown!.substantiveTasks.score).toBe(60);
  });
});
