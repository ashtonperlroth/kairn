import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { loadTrace, loadIterationTraces, writeTrace, writeScore, traceExists, writeIterationLog, loadIterationLog } from '../trace.js';
import type { Trace, Score, IterationLog, Proposal } from '../types.js';

function makeTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    taskId: 'task-1',
    iteration: 0,
    stdout: 'output text',
    stderr: '',
    toolCalls: [],
    filesChanged: {},
    score: { pass: true, score: 1.0 },
    timing: {
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:01:00.000Z',
      durationMs: 60000,
    },
    ...overrides,
  };
}

describe('writeTrace', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join('/tmp', `kairn-trace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates the trace directory if it does not exist', async () => {
    const traceDir = path.join(tempDir, 'traces', '1', 'task-abc');
    await writeTrace(traceDir, makeTrace());
    const stat = await fs.stat(traceDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('writes stdout.log', async () => {
    const traceDir = path.join(tempDir, 'trace-out');
    await writeTrace(traceDir, makeTrace({ stdout: 'hello stdout' }));
    const content = await fs.readFile(path.join(traceDir, 'stdout.log'), 'utf-8');
    expect(content).toBe('hello stdout');
  });

  it('writes stderr.log', async () => {
    const traceDir = path.join(tempDir, 'trace-err');
    await writeTrace(traceDir, makeTrace({ stderr: 'hello stderr' }));
    const content = await fs.readFile(path.join(traceDir, 'stderr.log'), 'utf-8');
    expect(content).toBe('hello stderr');
  });

  it('writes tool_calls.jsonl with one JSON object per line', async () => {
    const traceDir = path.join(tempDir, 'trace-tc');
    const toolCalls = [
      { tool: 'Bash', input: { command: 'ls' } },
      { tool: 'Read', input: { file_path: '/tmp/a.txt' } },
    ];
    await writeTrace(traceDir, makeTrace({ toolCalls }));
    const content = await fs.readFile(path.join(traceDir, 'tool_calls.jsonl'), 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(toolCalls[0]);
    expect(JSON.parse(lines[1])).toEqual(toolCalls[1]);
  });

  it('writes tool_calls.jsonl as empty string when toolCalls is empty', async () => {
    const traceDir = path.join(tempDir, 'trace-tc-empty');
    await writeTrace(traceDir, makeTrace({ toolCalls: [] }));
    const content = await fs.readFile(path.join(traceDir, 'tool_calls.jsonl'), 'utf-8');
    expect(content).toBe('');
  });

  it('writes files_changed.json', async () => {
    const traceDir = path.join(tempDir, 'trace-fc');
    const filesChanged: Record<string, 'created' | 'modified' | 'deleted'> = {
      'src/foo.ts': 'created',
      'src/bar.ts': 'modified',
    };
    await writeTrace(traceDir, makeTrace({ filesChanged }));
    const content = await fs.readFile(path.join(traceDir, 'files_changed.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual(filesChanged);
  });

  it('writes timing.json', async () => {
    const traceDir = path.join(tempDir, 'trace-timing');
    const timing = {
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:02:00.000Z',
      durationMs: 120000,
    };
    await writeTrace(traceDir, makeTrace({ timing }));
    const content = await fs.readFile(path.join(traceDir, 'timing.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual(timing);
  });

  it('writes score.json', async () => {
    const traceDir = path.join(tempDir, 'trace-score');
    const score: Score = { pass: false, score: 0.5, details: 'partial' };
    await writeTrace(traceDir, makeTrace({ score }));
    const content = await fs.readFile(path.join(traceDir, 'score.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual(score);
  });
});

describe('loadTrace', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join('/tmp', `kairn-trace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('round-trips a trace written with writeTrace', async () => {
    const traceDir = path.join(tempDir, 'traces', '2', 'task-rt');
    const original = makeTrace({
      taskId: 'task-rt',
      iteration: 2,
      stdout: 'some output',
      stderr: 'some error',
      toolCalls: [{ tool: 'Bash', input: { command: 'echo hi' } }],
      filesChanged: { 'src/index.ts': 'modified' },
      score: { pass: true, score: 0.9 },
      timing: {
        startedAt: '2026-01-01T10:00:00.000Z',
        completedAt: '2026-01-01T10:01:30.000Z',
        durationMs: 90000,
      },
    });

    await writeTrace(traceDir, original);
    const loaded = await loadTrace(traceDir);

    expect(loaded.taskId).toBe('task-rt');
    expect(loaded.stdout).toBe('some output');
    expect(loaded.stderr).toBe('some error');
    expect(loaded.toolCalls).toEqual([{ tool: 'Bash', input: { command: 'echo hi' } }]);
    expect(loaded.filesChanged).toEqual({ 'src/index.ts': 'modified' });
    expect(loaded.score).toEqual({ pass: true, score: 0.9 });
    expect(loaded.timing.durationMs).toBe(90000);
  });

  it('extracts iteration number from parent directory name', async () => {
    const traceDir = path.join(tempDir, 'traces', '5', 'task-x');
    await writeTrace(traceDir, makeTrace());
    const loaded = await loadTrace(traceDir);
    expect(loaded.iteration).toBe(5);
  });

  it('falls back to iteration 0 when parent dir is not a number', async () => {
    const traceDir = path.join(tempDir, 'some-non-numeric-parent', 'task-x');
    await writeTrace(traceDir, makeTrace());
    const loaded = await loadTrace(traceDir);
    expect(loaded.iteration).toBe(0);
  });

  it('sets taskId from the trace directory basename', async () => {
    const traceDir = path.join(tempDir, '3', 'my-task-id');
    await writeTrace(traceDir, makeTrace());
    const loaded = await loadTrace(traceDir);
    expect(loaded.taskId).toBe('my-task-id');
  });

  it('parses tool_calls.jsonl with multiple entries', async () => {
    const traceDir = path.join(tempDir, '1', 'task-tc');
    const toolCalls = [
      { tool: 'Bash', input: { command: 'npm test' } },
      { tool: 'Write', input: { file_path: '/tmp/x.ts', content: 'hello' } },
    ];
    await writeTrace(traceDir, makeTrace({ toolCalls }));
    const loaded = await loadTrace(traceDir);
    expect(loaded.toolCalls).toHaveLength(2);
    expect(loaded.toolCalls[0]).toEqual(toolCalls[0]);
    expect(loaded.toolCalls[1]).toEqual(toolCalls[1]);
  });

  it('returns empty toolCalls array when tool_calls.jsonl is absent', async () => {
    const traceDir = path.join(tempDir, '0', 'task-no-tc');
    await fs.mkdir(traceDir, { recursive: true });
    await fs.writeFile(path.join(traceDir, 'stdout.log'), '');
    await fs.writeFile(path.join(traceDir, 'stderr.log'), '');
    // No tool_calls.jsonl written
    const loaded = await loadTrace(traceDir);
    expect(loaded.toolCalls).toEqual([]);
  });

  it('returns defaults when optional files are absent', async () => {
    const traceDir = path.join(tempDir, '0', 'task-minimal');
    await fs.mkdir(traceDir, { recursive: true });
    await fs.writeFile(path.join(traceDir, 'stdout.log'), 'minimal');
    // stderr, files_changed, timing, score, tool_calls all absent

    const loaded = await loadTrace(traceDir);
    expect(loaded.stdout).toBe('minimal');
    expect(loaded.stderr).toBe('');
    expect(loaded.filesChanged).toEqual({});
    expect(loaded.score.pass).toBe(false);
    expect(loaded.toolCalls).toEqual([]);
  });
});

describe('loadIterationTraces', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join('/tmp', `kairn-trace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('loads all task traces for a given iteration', async () => {
    const workspace = path.join(tempDir, 'workspace');
    const iter = 1;

    for (const taskId of ['task-a', 'task-b', 'task-c']) {
      const traceDir = path.join(workspace, 'traces', String(iter), taskId);
      await writeTrace(traceDir, makeTrace({ taskId }));
    }

    const traces = await loadIterationTraces(workspace, iter);
    expect(traces).toHaveLength(3);
    const ids = traces.map(t => t.taskId).sort();
    expect(ids).toEqual(['task-a', 'task-b', 'task-c']);
  });

  it('returns empty array when iteration directory does not exist', async () => {
    const workspace = path.join(tempDir, 'workspace');
    const traces = await loadIterationTraces(workspace, 99);
    expect(traces).toEqual([]);
  });
});

describe('writeScore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join('/tmp', `kairn-trace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes score.json to an existing trace directory', async () => {
    const traceDir = path.join(tempDir, 'trace-ws');
    await fs.mkdir(traceDir);
    const score: Score = { pass: true, score: 0.75, details: 'good' };

    await writeScore(traceDir, score);

    const content = await fs.readFile(path.join(traceDir, 'score.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual(score);
  });

  it('overwrites an existing score.json', async () => {
    const traceDir = path.join(tempDir, 'trace-overwrite');
    await fs.mkdir(traceDir);
    await fs.writeFile(path.join(traceDir, 'score.json'), JSON.stringify({ pass: false }));

    const newScore: Score = { pass: true, score: 1.0 };
    await writeScore(traceDir, newScore);

    const content = await fs.readFile(path.join(traceDir, 'score.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual(newScore);
  });

  it('writes score with all optional fields', async () => {
    const traceDir = path.join(tempDir, 'trace-full-score');
    await fs.mkdir(traceDir);
    const score: Score = {
      pass: true,
      score: 0.9,
      details: 'mostly correct',
      reasoning: 'the output matched expected',
      breakdown: [{ criterion: 'correctness', score: 0.9, weight: 1.0 }],
    };

    await writeScore(traceDir, score);

    const content = await fs.readFile(path.join(traceDir, 'score.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual(score);
  });
});

describe('traceExists', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join('/tmp', `kairn-trace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns true when stdout.log exists in trace directory', async () => {
    const traceDir = path.join(tempDir, 'populated-trace');
    await fs.mkdir(traceDir);
    await fs.writeFile(path.join(traceDir, 'stdout.log'), 'output');

    const result = await traceExists(traceDir);
    expect(result).toBe(true);
  });

  it('returns false when trace directory does not exist', async () => {
    const traceDir = path.join(tempDir, 'nonexistent');
    const result = await traceExists(traceDir);
    expect(result).toBe(false);
  });

  it('returns false when directory exists but stdout.log is absent', async () => {
    const traceDir = path.join(tempDir, 'empty-trace');
    await fs.mkdir(traceDir);

    const result = await traceExists(traceDir);
    expect(result).toBe(false);
  });
});

describe('writeIterationLog', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join('/tmp', `kairn-iterlog-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates the iterations/{N} directory', async () => {
    const log: IterationLog = {
      iteration: 0,
      score: 0.8,
      taskResults: {},
      proposal: null,
      diffPatch: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    await writeIterationLog(tempDir, log);
    const stat = await fs.stat(path.join(tempDir, 'iterations', '0'));
    expect(stat.isDirectory()).toBe(true);
  });

  it('writes scores.json with score and taskResults', async () => {
    const taskResults: Record<string, Score> = {
      'task-a': { pass: true, score: 1.0 },
      'task-b': { pass: false, score: 0.4 },
    };
    const log: IterationLog = {
      iteration: 1,
      score: 0.7,
      taskResults,
      proposal: null,
      diffPatch: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    await writeIterationLog(tempDir, log);
    const content = await fs.readFile(
      path.join(tempDir, 'iterations', '1', 'scores.json'),
      'utf-8',
    );
    const parsed = JSON.parse(content) as { score: number; taskResults: Record<string, Score> };
    expect(parsed.score).toBe(0.7);
    expect(parsed.taskResults).toEqual(taskResults);
  });

  it('writes proposer_reasoning.md from proposal.reasoning', async () => {
    const proposal: Proposal = {
      reasoning: 'This is the proposer reasoning text',
      mutations: [],
      expectedImpact: {},
    };
    const log: IterationLog = {
      iteration: 2,
      score: 0.9,
      taskResults: {},
      proposal,
      diffPatch: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    await writeIterationLog(tempDir, log);
    const content = await fs.readFile(
      path.join(tempDir, 'iterations', '2', 'proposer_reasoning.md'),
      'utf-8',
    );
    expect(content).toBe('This is the proposer reasoning text');
  });

  it('writes baseline message to proposer_reasoning.md when proposal is null', async () => {
    const log: IterationLog = {
      iteration: 0,
      score: 0.5,
      taskResults: {},
      proposal: null,
      diffPatch: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    await writeIterationLog(tempDir, log);
    const content = await fs.readFile(
      path.join(tempDir, 'iterations', '0', 'proposer_reasoning.md'),
      'utf-8',
    );
    expect(content).toBe('Baseline evaluation (no proposal)');
  });

  it('writes mutation_diff.patch with diffPatch content', async () => {
    const log: IterationLog = {
      iteration: 3,
      score: 0.6,
      taskResults: {},
      proposal: null,
      diffPatch: '--- a/CLAUDE.md\n+++ b/CLAUDE.md\n@@ -1 +1 @@\n-old\n+new',
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    await writeIterationLog(tempDir, log);
    const content = await fs.readFile(
      path.join(tempDir, 'iterations', '3', 'mutation_diff.patch'),
      'utf-8',
    );
    expect(content).toBe('--- a/CLAUDE.md\n+++ b/CLAUDE.md\n@@ -1 +1 @@\n-old\n+new');
  });

  it('writes empty string to mutation_diff.patch when diffPatch is null', async () => {
    const log: IterationLog = {
      iteration: 0,
      score: 0.5,
      taskResults: {},
      proposal: null,
      diffPatch: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    await writeIterationLog(tempDir, log);
    const content = await fs.readFile(
      path.join(tempDir, 'iterations', '0', 'mutation_diff.patch'),
      'utf-8',
    );
    expect(content).toBe('');
  });
});

describe('loadIterationLog', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join('/tmp', `kairn-iterlog-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns null when the iteration directory does not exist', async () => {
    const result = await loadIterationLog(tempDir, 99);
    expect(result).toBeNull();
  });

  it('round-trips a log written with writeIterationLog', async () => {
    const taskResults: Record<string, Score> = {
      'task-a': { pass: true, score: 1.0 },
    };
    const proposal: Proposal = {
      reasoning: 'Round-trip reasoning',
      mutations: [],
      expectedImpact: { 'task-a': 'should improve' },
    };
    const original: IterationLog = {
      iteration: 1,
      score: 0.85,
      taskResults,
      proposal,
      diffPatch: 'some diff content',
      timestamp: '2026-01-01T00:00:00.000Z',
    };

    await writeIterationLog(tempDir, original);
    const loaded = await loadIterationLog(tempDir, 1);

    expect(loaded).not.toBeNull();
    expect(loaded!.iteration).toBe(1);
    expect(loaded!.score).toBe(0.85);
    expect(loaded!.taskResults).toEqual(taskResults);
    expect(loaded!.proposal?.reasoning).toBe('Round-trip reasoning');
    expect(loaded!.diffPatch).toBe('some diff content');
  });

  it('returns score 0 and empty taskResults when scores.json is missing', async () => {
    const iterDir = path.join(tempDir, 'iterations', '2');
    await fs.mkdir(iterDir, { recursive: true });
    // No scores.json, but directory exists

    const loaded = await loadIterationLog(tempDir, 2);
    expect(loaded).not.toBeNull();
    expect(loaded!.score).toBe(0);
    expect(loaded!.taskResults).toEqual({});
  });

  it('returns null proposal when proposer_reasoning.md is missing', async () => {
    const iterDir = path.join(tempDir, 'iterations', '3');
    await fs.mkdir(iterDir, { recursive: true });

    const loaded = await loadIterationLog(tempDir, 3);
    expect(loaded).not.toBeNull();
    expect(loaded!.proposal).toBeNull();
  });

  it('returns null diffPatch when mutation_diff.patch is empty', async () => {
    const log: IterationLog = {
      iteration: 4,
      score: 0.5,
      taskResults: {},
      proposal: null,
      diffPatch: null,
      timestamp: '',
    };
    await writeIterationLog(tempDir, log);
    const loaded = await loadIterationLog(tempDir, 4);
    expect(loaded).not.toBeNull();
    expect(loaded!.diffPatch).toBeNull();
  });

  it('returns the correct iteration number', async () => {
    const log: IterationLog = {
      iteration: 7,
      score: 0.5,
      taskResults: {},
      proposal: null,
      diffPatch: null,
      timestamp: '',
    };
    await writeIterationLog(tempDir, log);
    const loaded = await loadIterationLog(tempDir, 7);
    expect(loaded!.iteration).toBe(7);
  });
});
