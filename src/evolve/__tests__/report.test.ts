import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { generateMarkdownReport, generateJsonReport } from '../report.js';
import { stringify as yamlStringify } from 'yaml';

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
    taskResults: Record<string, { pass: boolean; score?: number; variance?: { runs: number; scores: number[]; mean: number; stddev: number } }>;
    proposal?: {
      reasoning: string;
      mutations: Array<{ file: string; action: string; newText: string; rationale: string }>;
    };
  }>;
  tasks: Array<{ id: string; template: string; description: string }>;
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
    })),
  };
  await fs.writeFile(
    path.join(workspace, 'tasks.yaml'),
    yamlStringify(tasksFile),
    'utf-8',
  );

  // Write iteration logs
  for (const iter of opts.iterations) {
    const iterDir = path.join(workspace, 'iterations', iter.iteration.toString());
    await fs.mkdir(iterDir, { recursive: true });

    await fs.writeFile(
      path.join(iterDir, 'scores.json'),
      JSON.stringify({ score: iter.score, taskResults: iter.taskResults }, null, 2),
      'utf-8',
    );

    await fs.writeFile(
      path.join(iterDir, 'proposer_reasoning.md'),
      iter.proposal?.reasoning ?? '',
      'utf-8',
    );

    await fs.writeFile(
      path.join(iterDir, 'mutation_diff.patch'),
      '',
      'utf-8',
    );
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
    expect(md).toContain('| Iter | Score | Mutations | Status |');
    expect(md).toContain('baseline');
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
