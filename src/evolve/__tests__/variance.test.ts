import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { evaluateAll } from '../runner.js';
import type { Task, Score, LoopProgressEvent } from '../types.js';
import type { KairnConfig } from '../../types.js';

vi.mock('../scorers.js', () => ({
  scoreTask: vi.fn(),
}));

vi.mock('../trace.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../trace.js')>();
  return {
    ...original,
    writeScore: vi.fn(),
    writeTrace: vi.fn(),
  };
});

import { scoreTask } from '../scorers.js';
import { writeScore } from '../trace.js';

const mockedScoreTask = vi.mocked(scoreTask);
const mockedWriteScore = vi.mocked(writeScore);

function makeTask(id: string): Task {
  return {
    id,
    template: 'add-feature',
    description: `Task ${id}`,
    setup: '',
    expected_outcome: 'Some outcome',
    scoring: 'pass-fail',
    timeout: 30,
  };
}

function makeConfig(): KairnConfig {
  return {
    provider: 'anthropic',
    api_key: 'test-key',
    model: 'claude-sonnet-4-6',
    default_runtime: 'claude-code',
    created_at: new Date().toISOString(),
  };
}

describe('evaluateAll with variance (runsPerTask)', () => {
  let tempDir: string;
  let fakeBinDir: string;
  let origPath: string | undefined;

  beforeEach(async () => {
    tempDir = path.join(
      '/tmp',
      `kairn-variance-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fakeBinDir = path.join(tempDir, 'bin');
    await fs.mkdir(fakeBinDir, { recursive: true });

    // Create fake claude binary
    const fakeScript = path.join(fakeBinDir, 'claude');
    await fs.writeFile(fakeScript, '#!/bin/bash\ncat\necho "done"');
    await fs.chmod(fakeScript, 0o755);

    origPath = process.env['PATH'];
    process.env['PATH'] = `${fakeBinDir}:${origPath}`;

    // Create harness and workspace
    await fs.mkdir(path.join(tempDir, 'harness'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'harness', 'CLAUDE.md'), '# Test');
    await fs.mkdir(path.join(tempDir, 'workspace', 'traces', '0'), { recursive: true });

    vi.clearAllMocks();
    mockedWriteScore.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    process.env['PATH'] = origPath;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('runs each task runsPerTask times when runsPerTask > 1', async () => {
    const tasks = [makeTask('task-1')];
    const config = makeConfig();

    mockedScoreTask
      .mockResolvedValueOnce({ pass: true, score: 80 })
      .mockResolvedValueOnce({ pass: true, score: 90 })
      .mockResolvedValueOnce({ pass: true, score: 70 });

    await evaluateAll(
      tasks,
      path.join(tempDir, 'harness'),
      path.join(tempDir, 'workspace'),
      0,
      config,
      undefined,
      3,
    );

    // scoreTask called 3 times for 1 task with 3 runs
    expect(mockedScoreTask).toHaveBeenCalledTimes(3);
  });

  it('computes correct mean and stddev in variance field', async () => {
    const tasks = [makeTask('task-1')];
    const config = makeConfig();

    // Scores: 80, 90, 70 → mean=80, stddev≈8.16
    mockedScoreTask
      .mockResolvedValueOnce({ pass: true, score: 80 })
      .mockResolvedValueOnce({ pass: true, score: 90 })
      .mockResolvedValueOnce({ pass: true, score: 70 });

    const { results } = await evaluateAll(
      tasks,
      path.join(tempDir, 'harness'),
      path.join(tempDir, 'workspace'),
      0,
      config,
      undefined,
      3,
    );

    const score = results['task-1'];
    expect(score.variance).toBeDefined();
    expect(score.variance!.runs).toBe(3);
    expect(score.variance!.scores).toEqual([80, 90, 70]);
    expect(score.variance!.mean).toBeCloseTo(80, 1);
    expect(score.variance!.stddev).toBeCloseTo(8.165, 1);
  });

  it('uses mean as the canonical score for aggregate', async () => {
    const tasks = [makeTask('task-1'), makeTask('task-2')];
    const config = makeConfig();

    // task-1: 80, 90, 70 → mean 80
    mockedScoreTask
      .mockResolvedValueOnce({ pass: true, score: 80 })
      .mockResolvedValueOnce({ pass: true, score: 90 })
      .mockResolvedValueOnce({ pass: true, score: 70 })
      // task-2: 60, 60, 60 → mean 60
      .mockResolvedValueOnce({ pass: false, score: 60 })
      .mockResolvedValueOnce({ pass: false, score: 60 })
      .mockResolvedValueOnce({ pass: false, score: 60 });

    const { aggregate } = await evaluateAll(
      tasks,
      path.join(tempDir, 'harness'),
      path.join(tempDir, 'workspace'),
      0,
      config,
      undefined,
      3,
    );

    // (80 + 60) / 2 = 70
    expect(aggregate).toBeCloseTo(70, 1);
  });

  it('has no variance field when runsPerTask is 1', async () => {
    const tasks = [makeTask('task-1')];
    const config = makeConfig();

    mockedScoreTask.mockResolvedValueOnce({ pass: true, score: 85 });

    const { results } = await evaluateAll(
      tasks,
      path.join(tempDir, 'harness'),
      path.join(tempDir, 'workspace'),
      0,
      config,
      undefined,
      1,
    );

    expect(results['task-1'].variance).toBeUndefined();
    expect(results['task-1'].score).toBe(85);
  });

  it('has no variance field when runsPerTask is omitted', async () => {
    const tasks = [makeTask('task-1')];
    const config = makeConfig();

    mockedScoreTask.mockResolvedValueOnce({ pass: true, score: 85 });

    const { results } = await evaluateAll(
      tasks,
      path.join(tempDir, 'harness'),
      path.join(tempDir, 'workspace'),
      0,
      config,
    );

    expect(results['task-1'].variance).toBeUndefined();
  });

  it('emits task-run progress events for multi-run tasks', async () => {
    const tasks = [makeTask('task-1')];
    const config = makeConfig();
    const events: LoopProgressEvent[] = [];

    mockedScoreTask
      .mockResolvedValueOnce({ pass: true, score: 80 })
      .mockResolvedValueOnce({ pass: true, score: 90 })
      .mockResolvedValueOnce({ pass: true, score: 70 });

    await evaluateAll(
      tasks,
      path.join(tempDir, 'harness'),
      path.join(tempDir, 'workspace'),
      0,
      config,
      (event) => events.push(event),
      3,
    );

    const runEvents = events.filter(e => e.type === 'task-run');
    expect(runEvents.length).toBe(3);
    expect(runEvents[0].message).toContain('1/3');
    expect(runEvents[1].message).toContain('2/3');
    expect(runEvents[2].message).toContain('3/3');
  });

  it('handles pass/fail scoring (no numeric score) in multi-run', async () => {
    const tasks = [makeTask('task-1')];
    const config = makeConfig();

    // pass=true → 100, pass=false → 0, pass=true → 100
    mockedScoreTask
      .mockResolvedValueOnce({ pass: true })
      .mockResolvedValueOnce({ pass: false })
      .mockResolvedValueOnce({ pass: true });

    const { results } = await evaluateAll(
      tasks,
      path.join(tempDir, 'harness'),
      path.join(tempDir, 'workspace'),
      0,
      config,
      undefined,
      3,
    );

    const score = results['task-1'];
    expect(score.variance).toBeDefined();
    expect(score.variance!.scores).toEqual([100, 0, 100]);
    expect(score.variance!.mean).toBeCloseTo(66.67, 0);
  });
});
