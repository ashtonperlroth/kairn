import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import type { Task, Trace, Proposal, Mutation, IterationLog, Score } from '../types.js';
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
    score: { pass: true, score: 1.0 },
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

// ─── readHarnessFiles ───────────────────────────────────────────────────────

describe('readHarnessFiles', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(
      '/tmp',
      `kairn-proposer-hf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reads flat files in a directory', async () => {
    const { readHarnessFiles } = await import('../proposer.js');

    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), '# Main harness');
    await fs.writeFile(path.join(tempDir, 'settings.json'), '{}');

    const result = await readHarnessFiles(tempDir);

    expect(result['CLAUDE.md']).toBe('# Main harness');
    expect(result['settings.json']).toBe('{}');
  });

  it('reads nested files with relative paths', async () => {
    const { readHarnessFiles } = await import('../proposer.js');

    await fs.mkdir(path.join(tempDir, 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'commands', 'develop.md'),
      'dev command',
    );
    await fs.mkdir(path.join(tempDir, 'rules'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'rules', 'security.md'),
      'security rule',
    );

    const result = await readHarnessFiles(tempDir);

    expect(result[path.join('commands', 'develop.md')]).toBe('dev command');
    expect(result[path.join('rules', 'security.md')]).toBe('security rule');
  });

  it('returns empty record for nonexistent directory', async () => {
    const { readHarnessFiles } = await import('../proposer.js');

    const result = await readHarnessFiles(path.join(tempDir, 'nonexistent'));

    expect(result).toEqual({});
  });

  it('returns empty record for empty directory', async () => {
    const { readHarnessFiles } = await import('../proposer.js');

    const emptyDir = path.join(tempDir, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });

    const result = await readHarnessFiles(emptyDir);

    expect(result).toEqual({});
  });

  it('handles deeply nested directories', async () => {
    const { readHarnessFiles } = await import('../proposer.js');

    const deepPath = path.join(tempDir, 'a', 'b', 'c');
    await fs.mkdir(deepPath, { recursive: true });
    await fs.writeFile(path.join(deepPath, 'deep.md'), 'deep content');

    const result = await readHarnessFiles(tempDir);

    expect(result[path.join('a', 'b', 'c', 'deep.md')]).toBe('deep content');
  });
});

// ─── PROPOSER_SYSTEM_PROMPT ─────────────────────────────────────────────────

describe('PROPOSER_SYSTEM_PROMPT', () => {
  it('is exported as a non-empty string', async () => {
    const { PROPOSER_SYSTEM_PROMPT } = await import('../proposer.js');

    expect(typeof PROPOSER_SYSTEM_PROMPT).toBe('string');
    expect(PROPOSER_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it('contains key sections from the design doc', async () => {
    const { PROPOSER_SYSTEM_PROMPT } = await import('../proposer.js');

    expect(PROPOSER_SYSTEM_PROMPT).toContain('expert agent environment optimizer');
    expect(PROPOSER_SYSTEM_PROMPT).toContain('Diagnosis Process');
    expect(PROPOSER_SYSTEM_PROMPT).toContain('Output Format');
    expect(PROPOSER_SYSTEM_PROMPT).toContain('MINIMAL changes only');
    expect(PROPOSER_SYSTEM_PROMPT).toContain('valid JSON');
  });

  it('lists all 5 mutation actions including delete_section and delete_file', async () => {
    const { PROPOSER_SYSTEM_PROMPT } = await import('../proposer.js');

    expect(PROPOSER_SYSTEM_PROMPT).toContain('delete_section');
    expect(PROPOSER_SYSTEM_PROMPT).toContain('delete_file');
    expect(PROPOSER_SYSTEM_PROMPT).toContain('replace');
    expect(PROPOSER_SYSTEM_PROMPT).toContain('add_section');
    expect(PROPOSER_SYSTEM_PROMPT).toContain('create_file');
  });

  it('includes balanced mutation guidance (additions AND removals)', async () => {
    const { PROPOSER_SYSTEM_PROMPT } = await import('../proposer.js');

    expect(PROPOSER_SYSTEM_PROMPT).toContain('additions AND removals');
    expect(PROPOSER_SYSTEM_PROMPT).not.toContain('Prefer ADDITIVE changes');
  });

  it('includes MCP configuration guidance', async () => {
    const { PROPOSER_SYSTEM_PROMPT } = await import('../proposer.js');

    expect(PROPOSER_SYSTEM_PROMPT).toContain('.mcp.json');
  });
});

// ─── parseProposerResponse ──────────────────────────────────────────────────

describe('parseProposerResponse', () => {
  it('parses valid JSON response', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const raw = JSON.stringify({
      reasoning: 'The agent failed because CLAUDE.md lacks build instructions.',
      mutations: [
        {
          file: 'CLAUDE.md',
          action: 'add_section',
          new_text: '## Build\nnpm run build',
          rationale: 'Agent needs build instructions.',
        },
      ],
      expected_impact: { 'task-1': '+20% — will know how to build' },
    });

    const result = parseProposerResponse(raw);

    expect(result.reasoning).toBe(
      'The agent failed because CLAUDE.md lacks build instructions.',
    );
    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0].file).toBe('CLAUDE.md');
    expect(result.mutations[0].action).toBe('add_section');
    expect(result.mutations[0].newText).toBe('## Build\nnpm run build');
    expect(result.mutations[0].rationale).toBe(
      'Agent needs build instructions.',
    );
    expect(result.expectedImpact['task-1']).toBe(
      '+20% — will know how to build',
    );
  });

  it('strips markdown code fences before parsing', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const raw = '```json\n' + JSON.stringify({
      reasoning: 'analysis',
      mutations: [],
      expected_impact: {},
    }) + '\n```';

    const result = parseProposerResponse(raw);

    expect(result.reasoning).toBe('analysis');
    expect(result.mutations).toEqual([]);
  });

  it('maps snake_case old_text to camelCase oldText', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const raw = JSON.stringify({
      reasoning: 'Replace bad instructions.',
      mutations: [
        {
          file: 'CLAUDE.md',
          action: 'replace',
          old_text: 'bad instruction',
          new_text: 'good instruction',
          rationale: 'Fix instruction.',
        },
      ],
      expected_impact: {},
    });

    const result = parseProposerResponse(raw);

    expect(result.mutations[0].oldText).toBe('bad instruction');
    expect(result.mutations[0].newText).toBe('good instruction');
  });

  it('rejects mutations with path traversal in file field', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const raw = JSON.stringify({
      reasoning: 'Attempting path traversal.',
      mutations: [
        {
          file: '../../../etc/passwd',
          action: 'create_file',
          new_text: 'malicious content',
          rationale: 'Hack.',
        },
        {
          file: 'CLAUDE.md',
          action: 'add_section',
          new_text: 'safe change',
          rationale: 'Good fix.',
        },
      ],
      expected_impact: {},
    });

    const result = parseProposerResponse(raw);

    // Path traversal mutation should be filtered out
    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0].file).toBe('CLAUDE.md');
  });

  it('throws on missing reasoning field', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const raw = JSON.stringify({
      mutations: [],
      expected_impact: {},
    });

    expect(() => parseProposerResponse(raw)).toThrow();
  });

  it('throws on missing mutations array', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const raw = JSON.stringify({
      reasoning: 'analysis',
      expected_impact: {},
    });

    expect(() => parseProposerResponse(raw)).toThrow();
  });

  it('throws on completely invalid JSON', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    expect(() => parseProposerResponse('not json at all')).toThrow();
  });

  it('requires oldText for replace action', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const raw = JSON.stringify({
      reasoning: 'Replace without old_text.',
      mutations: [
        {
          file: 'CLAUDE.md',
          action: 'replace',
          new_text: 'new content',
          rationale: 'Missing old_text.',
        },
      ],
      expected_impact: {},
    });

    // Should either throw or filter out the bad mutation
    const result = parseProposerResponse(raw);
    expect(result.mutations).toHaveLength(0);
  });

  it('handles response with leading/trailing whitespace', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const raw = '  \n  ' + JSON.stringify({
      reasoning: 'analysis',
      mutations: [],
      expected_impact: {},
    }) + '  \n  ';

    const result = parseProposerResponse(raw);
    expect(result.reasoning).toBe('analysis');
  });

  it('handles triple-backtick fences without language tag', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const raw = '```\n' + JSON.stringify({
      reasoning: 'analysis',
      mutations: [],
      expected_impact: {},
    }) + '\n```';

    const result = parseProposerResponse(raw);
    expect(result.reasoning).toBe('analysis');
  });

  it('accepts delete_section mutation with oldText', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const raw = JSON.stringify({
      reasoning: 'Remove bloated section.',
      mutations: [
        {
          file: 'CLAUDE.md',
          action: 'delete_section',
          old_text: '## Bloated\n\nRemove this.',
          rationale: 'Reducing noise.',
        },
      ],
      expected_impact: {},
    });

    const result = parseProposerResponse(raw);

    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0].action).toBe('delete_section');
    expect(result.mutations[0].oldText).toBe('## Bloated\n\nRemove this.');
    expect(result.mutations[0].file).toBe('CLAUDE.md');
  });

  it('accepts delete_file mutation without oldText or newText', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const raw = JSON.stringify({
      reasoning: 'Remove obsolete rule file.',
      mutations: [
        {
          file: 'rules/obsolete.md',
          action: 'delete_file',
          rationale: 'No longer needed.',
        },
      ],
      expected_impact: {},
    });

    const result = parseProposerResponse(raw);

    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0].action).toBe('delete_file');
    expect(result.mutations[0].file).toBe('rules/obsolete.md');
  });

  it('rejects delete_section without oldText', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const raw = JSON.stringify({
      reasoning: 'Missing old_text for delete_section.',
      mutations: [
        {
          file: 'CLAUDE.md',
          action: 'delete_section',
          rationale: 'No old_text.',
        },
      ],
      expected_impact: {},
    });

    const result = parseProposerResponse(raw);
    expect(result.mutations).toHaveLength(0);
  });

  it('defaults expectedImpact to empty record when missing', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const raw = JSON.stringify({
      reasoning: 'analysis',
      mutations: [],
    });

    const result = parseProposerResponse(raw);
    expect(result.expectedImpact).toEqual({});
  });

  it('extracts JSON from prose-wrapped response', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const jsonObj = {
      reasoning: 'The agent failed because CLAUDE.md lacks build instructions.',
      mutations: [
        {
          file: 'CLAUDE.md',
          action: 'add_section',
          new_text: '## Build\nnpm run build',
          rationale: 'Agent needs build instructions.',
        },
      ],
      expected_impact: { 'task-1': '+20%' },
    };
    const raw = `Looking at the traces, I need to analyze why the tasks failed. Here is my analysis:\n\n${JSON.stringify(jsonObj)}\n\nThat concludes my analysis.`;

    const result = parseProposerResponse(raw);

    expect(result.reasoning).toBe('The agent failed because CLAUDE.md lacks build instructions.');
    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0].file).toBe('CLAUDE.md');
    expect(result.expectedImpact['task-1']).toBe('+20%');
  });

  it('throws on pure English text with no JSON object', async () => {
    const { parseProposerResponse } = await import('../proposer.js');

    const raw = 'Looking at the traces, I can see that task-1 failed because the agent did not have build instructions. I recommend adding a build section.';

    expect(() => parseProposerResponse(raw)).toThrow('Proposer returned invalid JSON');
  });
});

// ─── buildProposerUserMessage ───────────────────────────────────────────────

describe('buildProposerUserMessage', () => {
  it('includes harness file contents in the message', async () => {
    const { buildProposerUserMessage } = await import('../proposer.js');

    const harnessFiles = { 'CLAUDE.md': '# My Harness' };
    const traces: Trace[] = [];
    const tasks: Task[] = [];
    const history: IterationLog[] = [];

    const message = buildProposerUserMessage(harnessFiles, traces, tasks, history);

    expect(message).toContain('CLAUDE.md');
    expect(message).toContain('# My Harness');
  });

  it('includes trace summaries with truncated stdout', async () => {
    const { buildProposerUserMessage } = await import('../proposer.js');

    // Create a long stdout that exceeds 2000 chars
    const longOutput = 'x'.repeat(5000);

    const harnessFiles = { 'CLAUDE.md': '# Harness' };
    const traces = [makeTrace({ stdout: longOutput, taskId: 'task-long' })];
    const tasks = [makeTask({ id: 'task-long' })];
    const history: IterationLog[] = [];

    const message = buildProposerUserMessage(harnessFiles, traces, tasks, history);

    // Should contain the task ID
    expect(message).toContain('task-long');
    // Should NOT contain the full 5000-char output
    expect(message).not.toContain(longOutput);
    // Should contain truncation indicator or truncated content
    expect(message.length).toBeLessThan(longOutput.length);
  });

  it('includes task definitions', async () => {
    const { buildProposerUserMessage } = await import('../proposer.js');

    const harnessFiles = {};
    const traces: Trace[] = [];
    const tasks = [makeTask({ id: 'my-task', description: 'Special task description' })];
    const history: IterationLog[] = [];

    const message = buildProposerUserMessage(harnessFiles, traces, tasks, history);

    expect(message).toContain('my-task');
    expect(message).toContain('Special task description');
  });

  it('includes iteration history when provided', async () => {
    const { buildProposerUserMessage } = await import('../proposer.js');

    const harnessFiles = {};
    const traces: Trace[] = [];
    const tasks: Task[] = [];
    const history = [
      makeIterationLog({ iteration: 0, score: 40 }),
      makeIterationLog({
        iteration: 1,
        score: 60,
        proposal: {
          reasoning: 'Fixed the build instructions.',
          mutations: [
            { file: 'CLAUDE.md', action: 'add_section', newText: '## Build', rationale: 'reason' },
          ],
          expectedImpact: { 'task-1': '+20%' },
        },
      }),
    ];

    const message = buildProposerUserMessage(harnessFiles, traces, tasks, history);

    expect(message).toContain('Iteration 0');
    expect(message).toContain('40');
    expect(message).toContain('Iteration 1');
    expect(message).toContain('60');
  });

  it('includes score information from traces', async () => {
    const { buildProposerUserMessage } = await import('../proposer.js');

    const harnessFiles = {};
    const traces = [
      makeTrace({
        taskId: 'task-scored',
        score: { pass: false, score: 30, details: 'Failed assertion' },
      }),
    ];
    const tasks = [makeTask({ id: 'task-scored' })];
    const history: IterationLog[] = [];

    const message = buildProposerUserMessage(harnessFiles, traces, tasks, history);

    expect(message).toContain('30');
    expect(message).toContain('task-scored');
  });
});

// ─── propose (integration with mocked LLM) ─────────────────────────────────

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

describe('propose', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(
      '/tmp',
      `kairn-proposer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reads harness files, loads traces, calls LLM, and returns a Proposal', async () => {
    const { propose } = await import('../proposer.js');

    // Set up harness directory
    const harnessPath = path.join(tempDir, 'harness');
    await fs.mkdir(harnessPath, { recursive: true });
    await fs.writeFile(path.join(harnessPath, 'CLAUDE.md'), '# Test Harness');

    // Mock traces
    mockedLoadIterationTraces.mockResolvedValue([
      makeTrace({ taskId: 'task-1', score: { pass: false, score: 20 } }),
    ]);

    // Mock LLM response
    const llmResponse = JSON.stringify({
      reasoning: 'Task failed because harness lacks test command.',
      mutations: [
        {
          file: 'CLAUDE.md',
          action: 'add_section',
          new_text: '## Testing\nnpm test',
          rationale: 'Agent needs to know how to run tests.',
        },
      ],
      expected_impact: { 'task-1': '+30%' },
    });
    mockedCallLLM.mockResolvedValue(llmResponse);

    const result = await propose(
      1,
      path.join(tempDir, 'workspace'),
      harnessPath,
      [],
      [makeTask()],
      makeConfig(),
      'claude-opus-4-6',
    );

    expect(result.reasoning).toContain('test command');
    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0].file).toBe('CLAUDE.md');
    expect(result.expectedImpact['task-1']).toBe('+30%');
  });

  it('passes the proposer model to callLLM via config override', async () => {
    const { propose } = await import('../proposer.js');

    const harnessPath = path.join(tempDir, 'harness');
    await fs.mkdir(harnessPath, { recursive: true });
    await fs.writeFile(path.join(harnessPath, 'CLAUDE.md'), '# Harness');

    mockedLoadIterationTraces.mockResolvedValue([]);
    mockedCallLLM.mockResolvedValue(JSON.stringify({
      reasoning: 'No failures.',
      mutations: [],
      expected_impact: {},
    }));

    const config = makeConfig();

    await propose(
      0,
      path.join(tempDir, 'workspace'),
      harnessPath,
      [],
      [],
      config,
      'claude-opus-4-6',
    );

    // Verify callLLM was called with the proposer model
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
    const calledConfig = mockedCallLLM.mock.calls[0][0] as KairnConfig;
    expect(calledConfig.model).toBe('claude-opus-4-6');
    // Original config should not be mutated
    expect(config.model).toBe('claude-sonnet-4-6');
  });

  it('passes PROPOSER_SYSTEM_PROMPT to callLLM', async () => {
    const { propose, PROPOSER_SYSTEM_PROMPT } = await import('../proposer.js');

    const harnessPath = path.join(tempDir, 'harness');
    await fs.mkdir(harnessPath, { recursive: true });
    await fs.writeFile(path.join(harnessPath, 'CLAUDE.md'), '# Harness');

    mockedLoadIterationTraces.mockResolvedValue([]);
    mockedCallLLM.mockResolvedValue(JSON.stringify({
      reasoning: 'No changes needed.',
      mutations: [],
      expected_impact: {},
    }));

    await propose(
      0,
      path.join(tempDir, 'workspace'),
      harnessPath,
      [],
      [],
      makeConfig(),
      'claude-opus-4-6',
    );

    const calledOptions = mockedCallLLM.mock.calls[0][2] as {
      systemPrompt: string;
      maxTokens?: number;
      jsonMode?: boolean;
    };
    expect(calledOptions.systemPrompt).toBe(PROPOSER_SYSTEM_PROMPT);
    expect(calledOptions.maxTokens).toBe(8192);
    expect(calledOptions.jsonMode).toBe(true);
  });

  it('propagates LLM errors', async () => {
    const { propose } = await import('../proposer.js');

    const harnessPath = path.join(tempDir, 'harness');
    await fs.mkdir(harnessPath, { recursive: true });
    await fs.writeFile(path.join(harnessPath, 'CLAUDE.md'), '# Harness');

    mockedLoadIterationTraces.mockResolvedValue([]);
    mockedCallLLM.mockRejectedValue(new Error('API rate limit exceeded'));

    await expect(
      propose(
        0,
        path.join(tempDir, 'workspace'),
        harnessPath,
        [],
        [],
        makeConfig(),
        'claude-opus-4-6',
      ),
    ).rejects.toThrow('API rate limit exceeded');
  });
});
