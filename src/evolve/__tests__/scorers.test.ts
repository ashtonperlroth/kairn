import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import type { Task } from '../types.js';
import type { KairnConfig } from '../../types.js';

// Mock the exec helper module
vi.mock('../exec.js', () => ({
  execCommand: vi.fn(),
}));

// Mock callLLM
vi.mock('../../llm.js', () => ({
  callLLM: vi.fn(),
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    template: 'add-feature',
    description: 'Add a hello world endpoint',
    setup: 'install dependencies',
    expected_outcome: 'The endpoint returns 200 OK',
    scoring: 'pass-fail',
    timeout: 30000,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<KairnConfig> = {}): KairnConfig {
  return {
    provider: 'anthropic',
    api_key: 'test-key',
    model: 'claude-sonnet-4-20250514',
    default_runtime: 'claude-code',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// passFailScorer
// ──────────────────────────────────────────────
describe('passFailScorer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(
      '/tmp',
      `kairn-scorer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
    vi.resetAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns pass when stderr has no errors', async () => {
    const { passFailScorer } = await import('../scorers.js');
    const task = makeTask();
    const result = await passFailScorer(task, tempDir, 'all good', '');
    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
  });

  it('returns fail when stderr contains "error"', async () => {
    const { passFailScorer } = await import('../scorers.js');
    const task = makeTask();
    const result = await passFailScorer(task, tempDir, '', 'some error occurred');
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
  });

  it('returns fail when stderr contains "failed"', async () => {
    const { passFailScorer } = await import('../scorers.js');
    const task = makeTask();
    const result = await passFailScorer(task, tempDir, '', 'test failed');
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
  });

  it('returns fail when stderr contains "exception"', async () => {
    const { passFailScorer } = await import('../scorers.js');
    const task = makeTask();
    const result = await passFailScorer(task, tempDir, '', 'unhandled exception');
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
  });

  it('ignores setup stderr lines when checking for errors', async () => {
    const { passFailScorer } = await import('../scorers.js');
    const task = makeTask();
    // Setup stderr has [setup] prefix — should be stripped before error check
    const result = await passFailScorer(task, tempDir, '', '[setup] npm ERR! error something\nActual task output');
    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
  });

  it('still detects real errors after stripping setup lines', async () => {
    const { passFailScorer } = await import('../scorers.js');
    const task = makeTask();
    const result = await passFailScorer(task, tempDir, '', '[setup] npm ERR! error\nError: real task failure');
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
  });

  it('executes verification commands from expected_outcome array', async () => {
    const { execCommand } = await import('../exec.js');
    const mockExec = execCommand as ReturnType<typeof vi.fn>;
    mockExec.mockResolvedValue({ stdout: 'ok', stderr: '' });

    const { passFailScorer } = await import('../scorers.js');
    const task = makeTask({
      expected_outcome: ['npm test', 'npm run lint'],
    });
    const result = await passFailScorer(task, tempDir, '', '');
    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
    expect(result.details).toContain('2 verification commands passed');
    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockExec).toHaveBeenCalledWith('npm test', tempDir);
    expect(mockExec).toHaveBeenCalledWith('npm run lint', tempDir);
  });

  it('executes verification commands from expected_outcome string with newlines', async () => {
    const { execCommand } = await import('../exec.js');
    const mockExec = execCommand as ReturnType<typeof vi.fn>;
    mockExec.mockResolvedValue({ stdout: 'ok', stderr: '' });

    const { passFailScorer } = await import('../scorers.js');
    const task = makeTask({
      expected_outcome: 'npm test\nnpm run build',
    });
    const result = await passFailScorer(task, tempDir, '', '');
    expect(result.pass).toBe(true);
    expect(result.details).toContain('2 verification commands passed');
  });

  it('reports failure when a verification command fails', async () => {
    const { execCommand } = await import('../exec.js');
    const mockExec = execCommand as ReturnType<typeof vi.fn>;
    mockExec
      .mockRejectedValueOnce(new Error('exit code 1'))
      .mockResolvedValueOnce({ stdout: 'ok', stderr: '' });

    const { passFailScorer } = await import('../scorers.js');
    const task = makeTask({
      expected_outcome: ['npm test', 'npm run lint'],
    });
    const result = await passFailScorer(task, tempDir, '', '');
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.details).toContain('Command failed');
  });

  it('strips leading "- " from expected_outcome lines before matching commands', async () => {
    const { execCommand } = await import('../exec.js');
    const mockExec = execCommand as ReturnType<typeof vi.fn>;
    mockExec.mockResolvedValue({ stdout: 'ok', stderr: '' });

    const { passFailScorer } = await import('../scorers.js');
    const task = makeTask({
      expected_outcome: ['- npm test', '- git status'],
    });
    const result = await passFailScorer(task, tempDir, '', '');
    expect(result.pass).toBe(true);
    expect(result.details).toContain('verification commands passed');
    expect(mockExec).toHaveBeenCalledWith('npm test', tempDir);
    expect(mockExec).toHaveBeenCalledWith('git status', tempDir);
  });

  it('falls back to stderr check when no lines look like commands', async () => {
    const { passFailScorer } = await import('../scorers.js');
    const task = makeTask({
      expected_outcome: ['The output should contain "hello"', 'No errors should appear'],
    });
    const result = await passFailScorer(task, tempDir, 'hello', '');
    expect(result.pass).toBe(true);
    expect(result.details).toBe('No errors detected in output');
  });
});

// ──────────────────────────────────────────────
// llmJudgeScorer
// ──────────────────────────────────────────────
describe('llmJudgeScorer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(
      '/tmp',
      `kairn-scorer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
    vi.resetAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns score from LLM judge response', async () => {
    const { callLLM } = await import('../../llm.js');
    const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
    mockCallLLM.mockResolvedValue(
      JSON.stringify({ pass: true, score: 85, reasoning: 'Good job' }),
    );

    const { llmJudgeScorer } = await import('../scorers.js');
    const task = makeTask({ scoring: 'llm-judge' });
    const config = makeConfig();
    const result = await llmJudgeScorer(task, tempDir, 'output', '', config);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(85);
    expect(result.reasoning).toBe('Good job');
  });

  it('handles LLM response wrapped in markdown code block', async () => {
    const { callLLM } = await import('../../llm.js');
    const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
    mockCallLLM.mockResolvedValue(
      '```json\n{"pass": false, "score": 30, "reasoning": "Incomplete"}\n```',
    );

    const { llmJudgeScorer } = await import('../scorers.js');
    const task = makeTask({ scoring: 'llm-judge' });
    const config = makeConfig();
    const result = await llmJudgeScorer(task, tempDir, 'output', '', config);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(30);
    expect(result.reasoning).toBe('Incomplete');
  });

  it('returns error score when LLM returns invalid JSON', async () => {
    const { callLLM } = await import('../../llm.js');
    const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
    mockCallLLM.mockResolvedValue('This is not JSON at all');

    const { llmJudgeScorer } = await import('../scorers.js');
    const task = makeTask({ scoring: 'llm-judge' });
    const config = makeConfig();
    const result = await llmJudgeScorer(task, tempDir, 'output', '', config);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('invalid JSON');
  });

  it('returns error score when callLLM throws', async () => {
    const { callLLM } = await import('../../llm.js');
    const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
    mockCallLLM.mockRejectedValue(new Error('API timeout'));

    const { llmJudgeScorer } = await import('../scorers.js');
    const task = makeTask({ scoring: 'llm-judge' });
    const config = makeConfig();
    const result = await llmJudgeScorer(task, tempDir, 'output', '', config);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('API timeout');
  });

  it('truncates long stdout and stderr in the LLM prompt', async () => {
    const { callLLM } = await import('../../llm.js');
    const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
    mockCallLLM.mockResolvedValue(
      JSON.stringify({ pass: true, score: 100, reasoning: 'ok' }),
    );

    const { llmJudgeScorer } = await import('../scorers.js');
    const task = makeTask({ scoring: 'llm-judge' });
    const config = makeConfig();
    const longStdout = 'x'.repeat(5000);
    const longStderr = 'e'.repeat(3000);

    await llmJudgeScorer(task, tempDir, longStdout, longStderr, config);

    expect(mockCallLLM).toHaveBeenCalledOnce();
    const userMsg = mockCallLLM.mock.calls[0][1] as string;
    // stdout should be truncated to last 2000 chars
    expect(userMsg).not.toContain('x'.repeat(5000));
    expect(userMsg).toContain('x'.repeat(2000));
    // stderr should be truncated to last 1000 chars
    expect(userMsg).not.toContain('e'.repeat(3000));
    expect(userMsg).toContain('e'.repeat(1000));
  });

  it('passes JUDGE_SYSTEM_PROMPT as systemPrompt option', async () => {
    const { callLLM } = await import('../../llm.js');
    const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
    mockCallLLM.mockResolvedValue(
      JSON.stringify({ pass: true, score: 100, reasoning: 'ok' }),
    );

    const { llmJudgeScorer, JUDGE_SYSTEM_PROMPT } = await import('../scorers.js');
    const task = makeTask({ scoring: 'llm-judge' });
    const config = makeConfig();

    await llmJudgeScorer(task, tempDir, 'output', '', config);

    const callOptions = mockCallLLM.mock.calls[0][2] as { systemPrompt: string };
    expect(callOptions.systemPrompt).toBe(JUDGE_SYSTEM_PROMPT);
  });
});

// ──────────────────────────────────────────────
// rubricScorer
// ──────────────────────────────────────────────
describe('rubricScorer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(
      '/tmp',
      `kairn-scorer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
    vi.resetAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('scores each rubric criterion via LLM and returns weighted total', async () => {
    const { callLLM } = await import('../../llm.js');
    const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
    mockCallLLM
      .mockResolvedValueOnce(JSON.stringify({ score: 0.8, reasoning: 'mostly correct' }))
      .mockResolvedValueOnce(JSON.stringify({ score: 0.6, reasoning: 'partially done' }));

    const { rubricScorer } = await import('../scorers.js');
    const task = makeTask({
      scoring: 'rubric',
      rubric: [
        { criterion: 'correctness', weight: 0.7 },
        { criterion: 'style', weight: 0.3 },
      ],
    });
    const config = makeConfig();
    const result = await rubricScorer(task, tempDir, 'output', '', config);

    // Weighted: 0.8*0.7 + 0.6*0.3 = 0.56+0.18 = 0.74 -> 74
    expect(result.score).toBe(74);
    expect(result.pass).toBe(true); // >= 60
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown?.[0]).toEqual({ criterion: 'correctness', score: 0.8, weight: 0.7 });
    expect(result.breakdown?.[1]).toEqual({ criterion: 'style', score: 0.6, weight: 0.3 });
  });

  it('returns fail when weighted score is below 60', async () => {
    const { callLLM } = await import('../../llm.js');
    const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
    mockCallLLM
      .mockResolvedValueOnce(JSON.stringify({ score: 0.3, reasoning: 'bad' }))
      .mockResolvedValueOnce(JSON.stringify({ score: 0.2, reasoning: 'worse' }));

    const { rubricScorer } = await import('../scorers.js');
    const task = makeTask({
      scoring: 'rubric',
      rubric: [
        { criterion: 'correctness', weight: 0.5 },
        { criterion: 'style', weight: 0.5 },
      ],
    });
    const config = makeConfig();
    const result = await rubricScorer(task, tempDir, 'output', '', config);

    // Weighted: 0.3*0.5 + 0.2*0.5 = 0.15+0.10 = 0.25 -> 25
    expect(result.score).toBe(25);
    expect(result.pass).toBe(false);
  });

  it('clamps criterion scores to 0-1 range', async () => {
    const { callLLM } = await import('../../llm.js');
    const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({ score: 1.5, reasoning: 'over' }),
    );

    const { rubricScorer } = await import('../scorers.js');
    const task = makeTask({
      scoring: 'rubric',
      rubric: [{ criterion: 'correctness', weight: 1.0 }],
    });
    const config = makeConfig();
    const result = await rubricScorer(task, tempDir, 'output', '', config);

    expect(result.breakdown?.[0]?.score).toBe(1.0);
    expect(result.score).toBe(100);
  });

  it('falls back to passFailScorer when no rubric is defined', async () => {
    const { rubricScorer } = await import('../scorers.js');
    const task = makeTask({ scoring: 'rubric' });
    const config = makeConfig();
    const result = await rubricScorer(task, tempDir, 'output', '', config);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
  });

  it('gives score 0 for a criterion when LLM returns invalid JSON', async () => {
    const { callLLM } = await import('../../llm.js');
    const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
    mockCallLLM
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(JSON.stringify({ score: 1.0, reasoning: 'perfect' }));

    const { rubricScorer } = await import('../scorers.js');
    const task = makeTask({
      scoring: 'rubric',
      rubric: [
        { criterion: 'correctness', weight: 0.5 },
        { criterion: 'style', weight: 0.5 },
      ],
    });
    const config = makeConfig();
    const result = await rubricScorer(task, tempDir, 'output', '', config);

    // 0*0.5 + 1.0*0.5 = 0.5 -> 50
    expect(result.score).toBe(50);
    expect(result.breakdown?.[0]?.score).toBe(0);
    expect(result.breakdown?.[1]?.score).toBe(1.0);
  });

  it('gives score 0 for a criterion when callLLM throws', async () => {
    const { callLLM } = await import('../../llm.js');
    const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
    mockCallLLM.mockRejectedValueOnce(new Error('network error'));

    const { rubricScorer } = await import('../scorers.js');
    const task = makeTask({
      scoring: 'rubric',
      rubric: [{ criterion: 'correctness', weight: 1.0 }],
    });
    const config = makeConfig();
    const result = await rubricScorer(task, tempDir, 'output', '', config);

    expect(result.score).toBe(0);
    expect(result.breakdown?.[0]?.score).toBe(0);
  });

  it('passes RUBRIC_SYSTEM_PROMPT as systemPrompt option', async () => {
    const { callLLM } = await import('../../llm.js');
    const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({ score: 0.9, reasoning: 'good' }),
    );

    const { rubricScorer, RUBRIC_SYSTEM_PROMPT } = await import('../scorers.js');
    const task = makeTask({
      scoring: 'rubric',
      rubric: [{ criterion: 'correctness', weight: 1.0 }],
    });
    const config = makeConfig();

    await rubricScorer(task, tempDir, 'output', '', config);

    const callOptions = mockCallLLM.mock.calls[0][2] as { systemPrompt: string };
    expect(callOptions.systemPrompt).toBe(RUBRIC_SYSTEM_PROMPT);
  });
});

// ──────────────────────────────────────────────
// scoreTask (dispatcher)
// ──────────────────────────────────────────────
describe('scoreTask', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(
      '/tmp',
      `kairn-scorer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
    vi.resetAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('dispatches to passFailScorer for pass-fail scoring', async () => {
    const { scoreTask } = await import('../scorers.js');
    const task = makeTask({ scoring: 'pass-fail' });
    const result = await scoreTask(task, tempDir, 'output', '');

    expect(result.pass).toBe(true);
  });

  it('dispatches to llmJudgeScorer for llm-judge scoring with config', async () => {
    const { callLLM } = await import('../../llm.js');
    const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
    mockCallLLM.mockResolvedValue(
      JSON.stringify({ pass: true, score: 90, reasoning: 'Excellent' }),
    );

    const { scoreTask } = await import('../scorers.js');
    const task = makeTask({ scoring: 'llm-judge' });
    const config = makeConfig();
    const result = await scoreTask(task, tempDir, 'output', '', config);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(90);
    expect(result.reasoning).toBe('Excellent');
  });

  it('dispatches to rubricScorer for rubric scoring with config', async () => {
    const { callLLM } = await import('../../llm.js');
    const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({ score: 0.9, reasoning: 'good' }),
    );

    const { scoreTask } = await import('../scorers.js');
    const task = makeTask({
      scoring: 'rubric',
      rubric: [{ criterion: 'correctness', weight: 1.0 }],
    });
    const config = makeConfig();
    const result = await scoreTask(task, tempDir, 'output', '', config);

    expect(result.score).toBe(90);
    expect(result.breakdown).toBeDefined();
  });

  it('falls back to passFailScorer when llm-judge requested but no config', async () => {
    const { scoreTask } = await import('../scorers.js');
    const task = makeTask({ scoring: 'llm-judge' });
    const result = await scoreTask(task, tempDir, 'output', '');

    expect(result.pass).toBe(true);
    expect(result.reasoning).toBeUndefined();
  });

  it('falls back to passFailScorer when rubric requested but no config', async () => {
    const { scoreTask } = await import('../scorers.js');
    const task = makeTask({
      scoring: 'rubric',
      rubric: [{ criterion: 'correctness', weight: 1.0 }],
    });
    const result = await scoreTask(task, tempDir, 'output', '');

    expect(result.pass).toBe(true);
    expect(result.breakdown).toBeUndefined();
  });

  it('falls back to passFailScorer for unknown scoring type', async () => {
    const { scoreTask } = await import('../scorers.js');
    const task = makeTask({ scoring: 'unknown' as Task['scoring'] });
    const result = await scoreTask(task, tempDir, 'output', '');

    expect(result.pass).toBe(true);
  });
});
