import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KairnConfig, SkeletonSpec } from '../../../types.js';
import type { AgentTask } from '../types.js';
import type { DocNode } from '../../../ir/types.js';

// ─── Mock callLLM ──────────────────────────────────────────────────────────

vi.mock('../../../llm.js', () => ({
  callLLM: vi.fn(),
}));

import { callLLM } from '../../../llm.js';

const mockedCallLLM = vi.mocked(callLLM);

// ─── Helpers ───────────────────────────────────────────────────────────────

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

function makeSkeleton(overrides: Partial<SkeletonSpec> = {}): SkeletonSpec {
  return {
    name: 'test-project',
    description: 'A test project',
    tools: [],
    outline: {
      tech_stack: ['TypeScript', 'Node.js'],
      workflow_type: 'api-development',
      key_commands: ['build', 'test'],
      custom_rules: [],
      custom_agents: [],
      custom_skills: [],
    },
    ...overrides,
  };
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    agent: 'doc-writer',
    items: ['DECISIONS', 'LEARNINGS', 'SPRINT'],
    max_tokens: 4096,
    ...overrides,
  };
}

// ─── generateDocs ──────────────────────────────────────────────────────────

describe('generateDocs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { agent: "doc-writer", docs: DocNode[] }', async () => {
    const { generateDocs } = await import('../doc-writer.js');

    const llmDocs: Array<{ name: string; content: string }> = [
      { name: 'DECISIONS', content: '# Decisions\n\n| Date | Decision | Rationale |\n|------|----------|-----------|' },
      { name: 'LEARNINGS', content: '# Learnings\n\n| Date | Learning | Impact |\n|------|----------|--------|' },
      { name: 'SPRINT', content: '# Sprint\n\n## Acceptance Criteria\n\n- [ ] Criterion 1\n\n## Status\n\nNot started' },
    ];
    mockedCallLLM.mockResolvedValue(JSON.stringify(llmDocs));

    const result = await generateDocs('Build a REST API for managing tasks', makeSkeleton(), makeTask(), makeConfig());

    expect(result.agent).toBe('doc-writer');
    if (result.agent === 'doc-writer') {
      expect(Array.isArray(result.docs)).toBe(true);
      expect(result.docs.length).toBeGreaterThanOrEqual(3);
      for (const doc of result.docs) {
        expect(doc).toHaveProperty('name');
        expect(doc).toHaveProperty('content');
        expect(typeof doc.name).toBe('string');
        expect(typeof doc.content).toBe('string');
      }
    }
  });

  it('always includes DECISIONS, LEARNINGS, SPRINT docs even when LLM omits them', async () => {
    const { generateDocs } = await import('../doc-writer.js');

    // LLM returns only one doc, missing the required three
    const llmDocs: Array<{ name: string; content: string }> = [
      { name: 'ARCHITECTURE', content: '# Architecture\n\nService layer design...' },
    ];
    mockedCallLLM.mockResolvedValue(JSON.stringify(llmDocs));

    const result = await generateDocs('Build a REST API for managing tasks', makeSkeleton(), makeTask(), makeConfig());

    if (result.agent === 'doc-writer') {
      const names = result.docs.map((d: DocNode) => d.name);
      expect(names).toContain('DECISIONS');
      expect(names).toContain('LEARNINGS');
      expect(names).toContain('SPRINT');
      // The LLM-provided doc should also be present
      expect(names).toContain('ARCHITECTURE');
    }
  });

  it('injects default DECISIONS template when LLM omits it', async () => {
    const { generateDocs } = await import('../doc-writer.js');

    mockedCallLLM.mockResolvedValue(JSON.stringify([]));

    const result = await generateDocs('Build a REST API', makeSkeleton(), makeTask(), makeConfig());

    if (result.agent === 'doc-writer') {
      const decisions = result.docs.find((d: DocNode) => d.name === 'DECISIONS');
      expect(decisions).toBeDefined();
      expect(decisions!.content).toContain('# Decisions');
      expect(decisions!.content).toContain('| Date | Decision | Rationale |');
    }
  });

  it('injects default LEARNINGS template when LLM omits it', async () => {
    const { generateDocs } = await import('../doc-writer.js');

    mockedCallLLM.mockResolvedValue(JSON.stringify([]));

    const result = await generateDocs('Build a REST API', makeSkeleton(), makeTask(), makeConfig());

    if (result.agent === 'doc-writer') {
      const learnings = result.docs.find((d: DocNode) => d.name === 'LEARNINGS');
      expect(learnings).toBeDefined();
      expect(learnings!.content).toContain('# Learnings');
      expect(learnings!.content).toContain('| Date | Learning | Impact |');
    }
  });

  it('injects default SPRINT template with acceptance criteria structure', async () => {
    const { generateDocs } = await import('../doc-writer.js');

    mockedCallLLM.mockResolvedValue(JSON.stringify([]));

    const result = await generateDocs('Build a REST API', makeSkeleton(), makeTask(), makeConfig());

    if (result.agent === 'doc-writer') {
      const sprint = result.docs.find((d: DocNode) => d.name === 'SPRINT');
      expect(sprint).toBeDefined();
      expect(sprint!.content).toContain('# Sprint');
      expect(sprint!.content).toContain('## Acceptance Criteria');
      expect(sprint!.content).toContain('- [ ]');
      expect(sprint!.content).toContain('## Status');
    }
  });

  it('does not duplicate required docs when LLM provides them', async () => {
    const { generateDocs } = await import('../doc-writer.js');

    const customDecisions = '# Decisions\n\nCustom decisions content for this project.';
    const llmDocs = [
      { name: 'DECISIONS', content: customDecisions },
      { name: 'LEARNINGS', content: '# Learnings\n\nCustom learnings.' },
      { name: 'SPRINT', content: '# Sprint\n\n## Acceptance Criteria\n\n- [ ] Custom\n\n## Status\n\nIn progress' },
    ];
    mockedCallLLM.mockResolvedValue(JSON.stringify(llmDocs));

    const result = await generateDocs('Build a REST API', makeSkeleton(), makeTask(), makeConfig());

    if (result.agent === 'doc-writer') {
      const decisionsCount = result.docs.filter((d: DocNode) => d.name === 'DECISIONS').length;
      expect(decisionsCount).toBe(1);
      // LLM-provided content should be preserved, not overwritten
      const decisions = result.docs.find((d: DocNode) => d.name === 'DECISIONS');
      expect(decisions!.content).toBe(customDecisions);
    }
  });

  it('calls callLLM with cacheControl: true', async () => {
    const { generateDocs } = await import('../doc-writer.js');

    mockedCallLLM.mockResolvedValue(JSON.stringify([]));

    const config = makeConfig();
    await generateDocs('Build a REST API', makeSkeleton(), makeTask(), config);

    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
    const callOptions = mockedCallLLM.mock.calls[0][2];
    expect(callOptions).toHaveProperty('cacheControl', true);
  });

  it('includes doc-writer identity in the system prompt', async () => {
    const { generateDocs } = await import('../doc-writer.js');

    mockedCallLLM.mockResolvedValue(JSON.stringify([]));

    await generateDocs('Build a REST API', makeSkeleton(), makeTask(), makeConfig());

    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
    const callOptions = mockedCallLLM.mock.calls[0][2];
    expect(callOptions).toHaveProperty('systemPrompt');
    expect(callOptions.systemPrompt).toContain('doc-writer');
  });

  it('parses JSON with code fence stripping', async () => {
    const { generateDocs } = await import('../doc-writer.js');

    const llmDocs = [
      { name: 'DECISIONS', content: '# Decisions\n\n| Date | Decision | Rationale |\n|------|----------|-----------|' },
      { name: 'LEARNINGS', content: '# Learnings\n\n| Date | Learning | Impact |\n|------|----------|--------|' },
      { name: 'SPRINT', content: '# Sprint\n\n## Acceptance Criteria\n\n- [ ] Done\n\n## Status\n\nComplete' },
    ];
    // Wrap in code fences like LLMs often do
    const fencedResponse = '```json\n' + JSON.stringify(llmDocs) + '\n```';
    mockedCallLLM.mockResolvedValue(fencedResponse);

    const result = await generateDocs('Build a REST API', makeSkeleton(), makeTask(), makeConfig());

    expect(result.agent).toBe('doc-writer');
    if (result.agent === 'doc-writer') {
      expect(result.docs.length).toBeGreaterThanOrEqual(3);
      const decisions = result.docs.find((d: DocNode) => d.name === 'DECISIONS');
      expect(decisions).toBeDefined();
    }
  });

  it('returns empty docs without calling LLM when task.items is empty', async () => {
    const { generateDocs } = await import('../doc-writer.js');

    const emptyTask = makeTask({ items: [] });
    const result = await generateDocs('Build a REST API', makeSkeleton(), emptyTask, makeConfig());

    expect(result.agent).toBe('doc-writer');
    if (result.agent === 'doc-writer') {
      expect(result.docs).toEqual([]);
    }
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });

  it('includes the intent in the user message to the LLM', async () => {
    const { generateDocs } = await import('../doc-writer.js');

    mockedCallLLM.mockResolvedValue(JSON.stringify([]));

    await generateDocs('Build a GraphQL API for e-commerce', makeSkeleton(), makeTask(), makeConfig());

    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
    const userMessage = mockedCallLLM.mock.calls[0][1];
    expect(userMessage).toContain('Build a GraphQL API for e-commerce');
  });

  it('includes the item names in the user message to the LLM', async () => {
    const { generateDocs } = await import('../doc-writer.js');

    mockedCallLLM.mockResolvedValue(JSON.stringify([]));

    const task = makeTask({ items: ['DECISIONS', 'LEARNINGS', 'SPRINT', 'ARCHITECTURE'] });
    await generateDocs('Build a REST API', makeSkeleton(), task, makeConfig());

    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
    const userMessage = mockedCallLLM.mock.calls[0][1];
    expect(userMessage).toContain('DECISIONS');
    expect(userMessage).toContain('LEARNINGS');
    expect(userMessage).toContain('SPRINT');
    expect(userMessage).toContain('ARCHITECTURE');
  });
});

// ─── DOC_WRITER_SYSTEM_PROMPT ──────────────────────────────────────────────

describe('DOC_WRITER_SYSTEM_PROMPT', () => {
  it('is exported as a non-empty string', async () => {
    const { DOC_WRITER_SYSTEM_PROMPT } = await import('../doc-writer.js');

    expect(typeof DOC_WRITER_SYSTEM_PROMPT).toBe('string');
    expect(DOC_WRITER_SYSTEM_PROMPT.length).toBeGreaterThan(50);
  });

  it('describes the doc-writer role', async () => {
    const { DOC_WRITER_SYSTEM_PROMPT } = await import('../doc-writer.js');

    expect(DOC_WRITER_SYSTEM_PROMPT).toContain('doc-writer');
  });

  it('mentions the JSON output format', async () => {
    const { DOC_WRITER_SYSTEM_PROMPT } = await import('../doc-writer.js');

    expect(DOC_WRITER_SYSTEM_PROMPT).toContain('JSON');
    expect(DOC_WRITER_SYSTEM_PROMPT).toContain('name');
    expect(DOC_WRITER_SYSTEM_PROMPT).toContain('content');
  });

  it('includes acceptance criteria template guidance', async () => {
    const { DOC_WRITER_SYSTEM_PROMPT } = await import('../doc-writer.js');

    expect(DOC_WRITER_SYSTEM_PROMPT).toContain('Acceptance Criteria');
  });
});

// ─── stripCodeFences ───────────────────────────────────────────────────────

describe('stripCodeFences', () => {
  it('strips ```json fences', async () => {
    const { stripCodeFences } = await import('../doc-writer.js');

    const input = '```json\n{"key": "value"}\n```';
    expect(stripCodeFences(input)).toBe('{"key": "value"}');
  });

  it('strips bare ``` fences', async () => {
    const { stripCodeFences } = await import('../doc-writer.js');

    const input = '```\n{"key": "value"}\n```';
    expect(stripCodeFences(input)).toBe('{"key": "value"}');
  });

  it('returns plain JSON unchanged', async () => {
    const { stripCodeFences } = await import('../doc-writer.js');

    const input = '{"key": "value"}';
    expect(stripCodeFences(input)).toBe('{"key": "value"}');
  });

  it('trims whitespace', async () => {
    const { stripCodeFences } = await import('../doc-writer.js');

    const input = '  \n  {"key": "value"}  \n  ';
    expect(stripCodeFences(input)).toBe('{"key": "value"}');
  });
});
