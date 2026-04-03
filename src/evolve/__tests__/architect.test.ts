import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import type { Task, Trace, IterationLog, Score, ArchitectProposal } from '../types.js';
import type { KairnConfig } from '../../types.js';

// ─── Test helpers ───────────────────────────────────────────────────────────

function makeTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    taskId: 'task-1',
    iteration: 0,
    stdout: 'output text',
    stderr: '',
    toolCalls: [],
    filesChanged: {},
    score: { pass: true, score: 80 },
    timing: {
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:01:00.000Z',
      durationMs: 60000,
    },
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    template: 'add-feature',
    description: 'Add a hello world function',
    setup: '',
    expected_outcome: 'hello world function exists',
    scoring: 'pass-fail',
    timeout: 30,
    ...overrides,
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

function makeIterationLog(overrides: Partial<IterationLog> = {}): IterationLog {
  return {
    iteration: 0,
    score: 50,
    taskResults: { 'task-1': { pass: false, score: 50 } },
    proposal: null,
    diffPatch: null,
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── ARCHITECT_SYSTEM_PROMPT ────────────────────────────────────────────────

describe('ARCHITECT_SYSTEM_PROMPT', () => {
  it('is exported as a non-empty string', async () => {
    const { ARCHITECT_SYSTEM_PROMPT } = await import('../architect.js');

    expect(typeof ARCHITECT_SYSTEM_PROMPT).toBe('string');
    expect(ARCHITECT_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it('contains key architect-specific terms', async () => {
    const { ARCHITECT_SYSTEM_PROMPT } = await import('../architect.js');

    expect(ARCHITECT_SYSTEM_PROMPT).toContain('ARCHITECT');
    expect(ARCHITECT_SYSTEM_PROMPT).toContain('REIMAGINE');
    expect(ARCHITECT_SYSTEM_PROMPT).toContain('up to 10 mutations');
  });

  it('does NOT contain the reactive proposer 3-mutation limit', async () => {
    const { ARCHITECT_SYSTEM_PROMPT } = await import('../architect.js');

    expect(ARCHITECT_SYSTEM_PROMPT).not.toContain('AT MOST 3 mutations');
  });

  it('lists all 5 mutation actions', async () => {
    const { ARCHITECT_SYSTEM_PROMPT } = await import('../architect.js');

    expect(ARCHITECT_SYSTEM_PROMPT).toContain('replace');
    expect(ARCHITECT_SYSTEM_PROMPT).toContain('add_section');
    expect(ARCHITECT_SYSTEM_PROMPT).toContain('create_file');
    expect(ARCHITECT_SYSTEM_PROMPT).toContain('delete_section');
    expect(ARCHITECT_SYSTEM_PROMPT).toContain('delete_file');
  });

  it('mentions speculative rationale is allowed', async () => {
    const { ARCHITECT_SYSTEM_PROMPT } = await import('../architect.js');

    expect(ARCHITECT_SYSTEM_PROMPT).toContain('SPECULATIVE');
  });

  it('mentions bold changes over incremental tweaks', async () => {
    const { ARCHITECT_SYSTEM_PROMPT } = await import('../architect.js');

    expect(ARCHITECT_SYSTEM_PROMPT).toContain('Bold changes');
  });
});

// ─── buildArchitectUserMessage ──────────────────────────────────────────────

describe('buildArchitectUserMessage', () => {
  it('includes harness file contents', async () => {
    const { buildArchitectUserMessage } = await import('../architect.js');

    const harnessFiles = { 'CLAUDE.md': '# Main harness content' };
    const message = buildArchitectUserMessage(
      harnessFiles, [], [makeTask()], [], undefined,
    );

    expect(message).toContain('CLAUDE.md');
    expect(message).toContain('# Main harness content');
  });

  it('includes task definitions', async () => {
    const { buildArchitectUserMessage } = await import('../architect.js');

    const tasks = [makeTask({ id: 'my-task', description: 'Special description' })];
    const message = buildArchitectUserMessage({}, [], tasks, [], undefined);

    expect(message).toContain('my-task');
    expect(message).toContain('Special description');
  });

  it('includes "Evolution Summary" section when history is provided', async () => {
    const { buildArchitectUserMessage } = await import('../architect.js');

    const history = [
      makeIterationLog({ iteration: 0, score: 40 }),
      makeIterationLog({ iteration: 1, score: 60 }),
    ];
    const message = buildArchitectUserMessage({}, [], [makeTask()], history, undefined);

    expect(message).toContain('Evolution Summary');
    expect(message).toContain('improving');
  });

  it('includes "What\'s Working" section when history is provided', async () => {
    const { buildArchitectUserMessage } = await import('../architect.js');

    const history = [
      makeIterationLog({
        iteration: 1,
        score: 70,
        taskResults: {
          'task-1': { pass: true, score: 90 },
          'task-2': { pass: false, score: 30 },
        },
      }),
    ];
    const message = buildArchitectUserMessage({}, [], [makeTask()], history, undefined);

    expect(message).toContain("What's Working");
    expect(message).toContain('task-1');
  });

  it('includes "Knowledge Base" section when knowledgeContext is provided', async () => {
    const { buildArchitectUserMessage } = await import('../architect.js');

    const knowledge = '- Pattern: PostToolUse hook improves doc consistency (+12%)';
    const message = buildArchitectUserMessage({}, [], [makeTask()], [], knowledge);

    expect(message).toContain('Knowledge Base');
    expect(message).toContain('PostToolUse hook');
  });

  it('omits "Knowledge Base" section when knowledgeContext is not provided', async () => {
    const { buildArchitectUserMessage } = await import('../architect.js');

    const message = buildArchitectUserMessage({}, [], [makeTask()], [], undefined);

    expect(message).not.toContain('Knowledge Base');
  });

  it('handles empty history gracefully', async () => {
    const { buildArchitectUserMessage } = await import('../architect.js');

    const message = buildArchitectUserMessage({}, [], [makeTask()], [], undefined);

    // Should not crash, should not contain Evolution Summary header content
    expect(typeof message).toBe('string');
    expect(message.length).toBeGreaterThan(0);
  });

  it('includes trace information', async () => {
    const { buildArchitectUserMessage } = await import('../architect.js');

    const traces = [makeTrace({ taskId: 'traced-task', score: { pass: false, score: 25 } })];
    const message = buildArchitectUserMessage({}, traces, [makeTask()], [], undefined);

    expect(message).toContain('traced-task');
  });
});

// ─── buildEvolutionSummary ──────────────────────────────────────────────────

describe('buildEvolutionSummary', () => {
  it('returns empty string for empty history', async () => {
    const { buildEvolutionSummary } = await import('../architect.js');

    expect(buildEvolutionSummary([])).toBe('');
  });

  it('shows "improving" trend when scores go up', async () => {
    const { buildEvolutionSummary } = await import('../architect.js');

    const history = [
      makeIterationLog({ iteration: 0, score: 30 }),
      makeIterationLog({ iteration: 1, score: 50 }),
      makeIterationLog({ iteration: 2, score: 70 }),
    ];

    const result = buildEvolutionSummary(history);

    expect(result).toContain('improving');
    expect(result).toContain('30.0');
    expect(result).toContain('70.0');
  });

  it('shows "declining" trend when scores go down', async () => {
    const { buildEvolutionSummary } = await import('../architect.js');

    const history = [
      makeIterationLog({ iteration: 0, score: 80 }),
      makeIterationLog({ iteration: 1, score: 60 }),
    ];

    const result = buildEvolutionSummary(history);

    expect(result).toContain('declining');
  });

  it('shows "flat" trend when scores unchanged', async () => {
    const { buildEvolutionSummary } = await import('../architect.js');

    const history = [
      makeIterationLog({ iteration: 0, score: 50 }),
      makeIterationLog({ iteration: 1, score: 50 }),
    ];

    const result = buildEvolutionSummary(history);

    expect(result).toContain('flat');
  });

  it('shows "insufficient data" for single-iteration history', async () => {
    const { buildEvolutionSummary } = await import('../architect.js');

    const history = [makeIterationLog({ iteration: 0, score: 50 })];

    const result = buildEvolutionSummary(history);

    expect(result).toContain('insufficient data');
  });

  it('reports best score and total mutations', async () => {
    const { buildEvolutionSummary } = await import('../architect.js');

    const history = [
      makeIterationLog({ iteration: 0, score: 30, proposal: null }),
      makeIterationLog({
        iteration: 1,
        score: 60,
        proposal: {
          reasoning: 'test',
          mutations: [
            { file: 'a.md', action: 'add_section', newText: 'x', rationale: 'r' },
            { file: 'b.md', action: 'add_section', newText: 'y', rationale: 'r' },
          ],
          expectedImpact: {},
        },
      }),
    ];

    const result = buildEvolutionSummary(history);

    expect(result).toContain('Best score: 60.0');
    expect(result).toContain('Total mutations tried: 2');
  });
});

// ─── buildWhatsWorking ──────────────────────────────────────────────────────

describe('buildWhatsWorking', () => {
  it('returns empty string for empty history', async () => {
    const { buildWhatsWorking } = await import('../architect.js');

    expect(buildWhatsWorking([], [])).toBe('');
  });

  it('lists consistently passing tasks', async () => {
    const { buildWhatsWorking } = await import('../architect.js');

    const history = [
      makeIterationLog({
        iteration: 2,
        score: 75,
        taskResults: {
          'task-pass': { pass: true, score: 95 },
          'task-fail': { pass: false, score: 20 },
        },
      }),
    ];

    const result = buildWhatsWorking(history, []);

    expect(result).toContain("What's Working");
    expect(result).toContain('task-pass');
    expect(result).not.toContain('task-fail');
  });

  it('shows message when no tasks are passing', async () => {
    const { buildWhatsWorking } = await import('../architect.js');

    const history = [
      makeIterationLog({
        iteration: 1,
        score: 0,
        taskResults: {
          'task-1': { pass: false, score: 0 },
        },
      }),
    ];

    const result = buildWhatsWorking(history, []);

    expect(result).toContain('No tasks consistently passing');
  });
});

// ─── proposeArchitecture (integration with mocked LLM) ─────────────────────

vi.mock('../../llm.js', () => ({
  callLLM: vi.fn(),
}));

vi.mock('../trace.js', () => ({
  loadIterationTraces: vi.fn(),
}));

import { callLLM } from '../../llm.js';
import { loadIterationTraces } from '../trace.js';

const mockedCallLLM = vi.mocked(callLLM);
const mockedLoadIterationTraces = vi.mocked(loadIterationTraces);

describe('proposeArchitecture', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(
      '/tmp',
      `kairn-architect-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns ArchitectProposal with structural=true and source=architect', async () => {
    const { proposeArchitecture } = await import('../architect.js');

    const harnessPath = path.join(tempDir, 'harness');
    await fs.mkdir(harnessPath, { recursive: true });
    await fs.writeFile(path.join(harnessPath, 'CLAUDE.md'), '# Test Harness');

    mockedLoadIterationTraces.mockResolvedValue([
      makeTrace({ taskId: 'task-1', score: { pass: false, score: 40 } }),
    ]);

    const llmResponse = JSON.stringify({
      reasoning: 'The harness needs a new agents/ directory for multi-agent workflows.',
      mutations: [
        {
          file: 'agents/reviewer.md',
          action: 'create_file',
          new_text: '# Reviewer Agent\nReviews code before commit.',
          rationale: 'Multi-agent patterns improve code quality in similar projects.',
        },
      ],
      expected_impact: { 'task-1': '+25% — reviewer catches errors' },
    });
    mockedCallLLM.mockResolvedValue(llmResponse);

    const result = await proposeArchitecture(
      5,
      path.join(tempDir, 'workspace'),
      harnessPath,
      [],
      [makeTask()],
      makeConfig(),
      'claude-opus-4-6',
      undefined,
    );

    expect(result.structural).toBe(true);
    expect(result.source).toBe('architect');
    expect(result.reasoning).toContain('agents/ directory');
    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0].file).toBe('agents/reviewer.md');
    expect(result.expectedImpact['task-1']).toContain('+25%');
  });

  it('passes ARCHITECT_SYSTEM_PROMPT and maxTokens 16384 to callLLM', async () => {
    const { proposeArchitecture, ARCHITECT_SYSTEM_PROMPT } = await import('../architect.js');

    const harnessPath = path.join(tempDir, 'harness');
    await fs.mkdir(harnessPath, { recursive: true });
    await fs.writeFile(path.join(harnessPath, 'CLAUDE.md'), '# Harness');

    mockedLoadIterationTraces.mockResolvedValue([]);
    mockedCallLLM.mockResolvedValue(JSON.stringify({
      reasoning: 'No structural changes needed.',
      mutations: [],
      expected_impact: {},
    }));

    await proposeArchitecture(
      5,
      path.join(tempDir, 'workspace'),
      harnessPath,
      [],
      [],
      makeConfig(),
      'claude-opus-4-6',
      undefined,
    );

    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
    const calledOptions = mockedCallLLM.mock.calls[0][2] as {
      systemPrompt: string;
      maxTokens: number;
      jsonMode: boolean;
      cacheControl: boolean;
    };
    expect(calledOptions.systemPrompt).toBe(ARCHITECT_SYSTEM_PROMPT);
    expect(calledOptions.maxTokens).toBe(16384);
    expect(calledOptions.jsonMode).toBe(true);
    expect(calledOptions.cacheControl).toBe(true);
  });

  it('uses the architectModel for the LLM call', async () => {
    const { proposeArchitecture } = await import('../architect.js');

    const harnessPath = path.join(tempDir, 'harness');
    await fs.mkdir(harnessPath, { recursive: true });
    await fs.writeFile(path.join(harnessPath, 'CLAUDE.md'), '# Harness');

    mockedLoadIterationTraces.mockResolvedValue([]);
    mockedCallLLM.mockResolvedValue(JSON.stringify({
      reasoning: 'analysis',
      mutations: [],
      expected_impact: {},
    }));

    const config = makeConfig();

    await proposeArchitecture(
      5,
      path.join(tempDir, 'workspace'),
      harnessPath,
      [],
      [],
      config,
      'claude-opus-4-6',
      undefined,
    );

    const calledConfig = mockedCallLLM.mock.calls[0][0] as KairnConfig;
    expect(calledConfig.model).toBe('claude-opus-4-6');
    // Original config should not be mutated
    expect(config.model).toBe('claude-sonnet-4-6');
  });

  it('passes knowledgeContext through to the user message', async () => {
    const { proposeArchitecture } = await import('../architect.js');

    const harnessPath = path.join(tempDir, 'harness');
    await fs.mkdir(harnessPath, { recursive: true });
    await fs.writeFile(path.join(harnessPath, 'CLAUDE.md'), '# Harness');

    mockedLoadIterationTraces.mockResolvedValue([]);
    mockedCallLLM.mockResolvedValue(JSON.stringify({
      reasoning: 'Used knowledge base patterns.',
      mutations: [],
      expected_impact: {},
    }));

    await proposeArchitecture(
      5,
      path.join(tempDir, 'workspace'),
      harnessPath,
      [],
      [makeTask()],
      makeConfig(),
      'claude-opus-4-6',
      '- Pattern: PostToolUse hook for doc consistency',
    );

    const calledUserMessage = mockedCallLLM.mock.calls[0][1] as string;
    expect(calledUserMessage).toContain('Knowledge Base');
    expect(calledUserMessage).toContain('PostToolUse hook');
  });

  it('propagates LLM errors', async () => {
    const { proposeArchitecture } = await import('../architect.js');

    const harnessPath = path.join(tempDir, 'harness');
    await fs.mkdir(harnessPath, { recursive: true });
    await fs.writeFile(path.join(harnessPath, 'CLAUDE.md'), '# Harness');

    mockedLoadIterationTraces.mockResolvedValue([]);
    mockedCallLLM.mockRejectedValue(new Error('API rate limit exceeded'));

    await expect(
      proposeArchitecture(
        5,
        path.join(tempDir, 'workspace'),
        harnessPath,
        [],
        [],
        makeConfig(),
        'claude-opus-4-6',
        undefined,
      ),
    ).rejects.toThrow('API rate limit exceeded');
  });
});
