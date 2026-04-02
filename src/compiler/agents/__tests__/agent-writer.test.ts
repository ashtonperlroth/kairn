import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KairnConfig } from '../../../types.js';
import type { AgentTask, AgentWriterResult } from '../types.js';

// ---------------------------------------------------------------------------
// Mock callLLM
// ---------------------------------------------------------------------------

const callLLMMock = vi.fn();

vi.mock('../../../llm.js', () => ({
  callLLM: (...args: unknown[]) => callLLMMock(...args),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const { runAgentWriter } = await import('../agent-writer.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<KairnConfig> = {}): KairnConfig {
  return {
    provider: 'anthropic',
    api_key: 'test-key',
    model: 'claude-sonnet-4-6',
    default_runtime: 'claude-code',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    agent: 'agent-writer',
    items: ['architect', 'reviewer'],
    intent: 'Build a full-stack web app with React and Node',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAgentWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an AgentWriterResult with agent field and agents array', async () => {
    callLLMMock.mockResolvedValueOnce(JSON.stringify([
      { name: 'architect', content: 'You are the project architect.' },
      { name: 'reviewer', content: 'You are the code reviewer.' },
    ]));

    const config = makeConfig();
    const task = makeTask();
    const result = await runAgentWriter(config, task);

    expect(result.agent).toBe('agent-writer');
    expect(Array.isArray(result.agents)).toBe(true);
    expect(result.agents).toHaveLength(2);
  });

  it('returns agents with required name and content fields', async () => {
    callLLMMock.mockResolvedValueOnce(JSON.stringify([
      { name: 'architect', content: 'You are the project architect who designs systems.' },
    ]));

    const config = makeConfig();
    const task = makeTask({ items: ['architect'] });
    const result = await runAgentWriter(config, task);

    expect(result.agents[0].name).toBe('architect');
    expect(result.agents[0].content).toBe('You are the project architect who designs systems.');
  });

  it('returns agents with optional model field', async () => {
    callLLMMock.mockResolvedValueOnce(JSON.stringify([
      { name: 'architect', content: 'You are the architect.', model: 'opus' },
    ]));

    const config = makeConfig();
    const task = makeTask({ items: ['architect'] });
    const result = await runAgentWriter(config, task);

    expect(result.agents[0].model).toBe('opus');
  });

  it('parses modelRouting object correctly from LLM response', async () => {
    callLLMMock.mockResolvedValueOnce(JSON.stringify([
      {
        name: 'architect',
        content: 'You are the architect.',
        modelRouting: {
          default: 'sonnet',
          escalateTo: 'opus',
          escalateWhen: 'cross-cutting architectural changes',
        },
      },
    ]));

    const config = makeConfig();
    const task = makeTask({ items: ['architect'] });
    const result = await runAgentWriter(config, task);

    expect(result.agents[0].modelRouting).toEqual({
      default: 'sonnet',
      escalateTo: 'opus',
      escalateWhen: 'cross-cutting architectural changes',
    });
  });

  it('calls callLLM with cacheControl: true', async () => {
    callLLMMock.mockResolvedValueOnce(JSON.stringify([
      { name: 'architect', content: 'You are the architect.' },
    ]));

    const config = makeConfig();
    const task = makeTask({ items: ['architect'] });
    await runAgentWriter(config, task);

    expect(callLLMMock).toHaveBeenCalledWith(
      config,
      expect.any(String),
      expect.objectContaining({ cacheControl: true }),
    );
  });

  it('strips code fences from LLM response before parsing JSON', async () => {
    const fenced = '```json\n' + JSON.stringify([
      { name: 'reviewer', content: 'You review code for quality.' },
    ]) + '\n```';
    callLLMMock.mockResolvedValueOnce(fenced);

    const config = makeConfig();
    const task = makeTask({ items: ['reviewer'] });
    const result = await runAgentWriter(config, task);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('reviewer');
  });

  it('returns empty agents array without calling LLM when items is empty', async () => {
    const config = makeConfig();
    const task = makeTask({ items: [] });
    const result = await runAgentWriter(config, task);

    expect(result.agent).toBe('agent-writer');
    expect(result.agents).toEqual([]);
    expect(callLLMMock).not.toHaveBeenCalled();
  });

  it('batches into multiple LLM calls when items.length > 8', async () => {
    const items = Array.from({ length: 14 }, (_, i) => `agent-${i}`);

    // First batch (6 items)
    callLLMMock.mockResolvedValueOnce(JSON.stringify(
      items.slice(0, 6).map((name) => ({ name, content: `You are ${name}.` })),
    ));
    // Second batch (6 items)
    callLLMMock.mockResolvedValueOnce(JSON.stringify(
      items.slice(6, 12).map((name) => ({ name, content: `You are ${name}.` })),
    ));
    // Third batch (2 items)
    callLLMMock.mockResolvedValueOnce(JSON.stringify(
      items.slice(12).map((name) => ({ name, content: `You are ${name}.` })),
    ));

    const config = makeConfig();
    const task = makeTask({ items });
    const result = await runAgentWriter(config, task);

    expect(callLLMMock).toHaveBeenCalledTimes(3);
    expect(result.agents).toHaveLength(14);
    expect(result.agents[0].name).toBe('agent-0');
    expect(result.agents[13].name).toBe('agent-13');
  });

  it('does not batch when items.length <= 8', async () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    callLLMMock.mockResolvedValueOnce(JSON.stringify(
      items.map((name) => ({ name, content: `You are ${name}.` })),
    ));

    const config = makeConfig();
    const task = makeTask({ items });
    const result = await runAgentWriter(config, task);

    expect(callLLMMock).toHaveBeenCalledTimes(1);
    expect(result.agents).toHaveLength(8);
  });

  it('includes phaseAContext in the user message when provided', async () => {
    callLLMMock.mockResolvedValueOnce(JSON.stringify([
      { name: 'architect', content: 'You are the architect.' },
    ]));

    const config = makeConfig();
    const task = makeTask({
      items: ['architect'],
      phaseAContext: 'Project uses React with TypeScript. Follow ESLint conventions.',
    });
    await runAgentWriter(config, task);

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain('React with TypeScript');
    expect(userMessage).toContain('ESLint conventions');
  });

  it('handles disallowedTools in agent output', async () => {
    callLLMMock.mockResolvedValueOnce(JSON.stringify([
      {
        name: 'reviewer',
        content: 'You are the reviewer.',
        disallowedTools: ['Bash', 'Write'],
      },
    ]));

    const config = makeConfig();
    const task = makeTask({ items: ['reviewer'] });
    const result = await runAgentWriter(config, task);

    expect(result.agents[0].disallowedTools).toEqual(['Bash', 'Write']);
  });

  it('filters out agents with missing name or content', async () => {
    callLLMMock.mockResolvedValueOnce(JSON.stringify([
      { name: 'valid', content: 'Valid agent.' },
      { name: '', content: 'Missing name.' },
      { name: 'no-content', content: '' },
      { content: 'No name field at all.' },
    ]));

    const config = makeConfig();
    const task = makeTask({ items: ['valid', 'invalid1', 'invalid2', 'invalid3'] });
    const result = await runAgentWriter(config, task);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('valid');
  });

  it('passes intent in the user message', async () => {
    callLLMMock.mockResolvedValueOnce(JSON.stringify([
      { name: 'architect', content: 'You are the architect.' },
    ]));

    const config = makeConfig();
    const task = makeTask({ intent: 'Build a CLI tool for data processing' });
    await runAgentWriter(config, task);

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain('Build a CLI tool for data processing');
  });
});
