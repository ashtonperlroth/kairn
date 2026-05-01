import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KairnConfig, SkeletonSpec } from '../../../types.js';
import type { AgentTask, AgentResult } from '../types.js';
import type { Section } from '../../../ir/types.js';

// Mock callLLM before importing the module under test
const callLLMMock = vi.fn<(...args: unknown[]) => Promise<string>>();

vi.mock('../../../llm.js', () => ({
  callLLM: (...args: unknown[]) => callLLMMock(...args),
}));

// Import after mocking
const { generateSections } = await import('../sections-writer.js');

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
      workflow_type: 'development',
      key_commands: ['build', 'test', 'lint'],
      custom_rules: [],
      custom_agents: [],
      custom_skills: [],
    },
    ...overrides,
  };
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    agent: 'sections-writer',
    items: ['purpose', 'tech-stack', 'commands'],
    max_tokens: 4096,
    ...overrides,
  };
}

describe('generateSections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns AgentResult with agent: "sections-writer" and sections array', async () => {
    const mockResponse = JSON.stringify([
      { id: 'purpose', heading: '# Test Project', content: 'A test project for testing.' },
      { id: 'tech-stack', heading: '## Tech Stack', content: '- TypeScript\n- Node.js' },
    ]);
    callLLMMock.mockResolvedValueOnce(mockResponse);

    const result = await generateSections(
      'Build a test project',
      makeSkeleton(),
      makeTask({ items: ['purpose', 'tech-stack'] }),
      makeConfig(),
    );

    expect(result.agent).toBe('sections-writer');
    expect('sections' in result).toBe(true);
    const sectionsResult = result as Extract<AgentResult, { agent: 'sections-writer' }>;
    expect(Array.isArray(sectionsResult.sections)).toBe(true);
  });

  it('returned sections have id, heading, content, and order fields', async () => {
    const mockResponse = JSON.stringify([
      { id: 'purpose', heading: '# My Project', content: 'Project purpose.' },
      { id: 'commands', heading: '## Commands', content: '```bash\nnpm run build\n```' },
    ]);
    callLLMMock.mockResolvedValueOnce(mockResponse);

    const result = await generateSections(
      'Build something',
      makeSkeleton(),
      makeTask({ items: ['purpose', 'commands'] }),
      makeConfig(),
    );

    const sectionsResult = result as Extract<AgentResult, { agent: 'sections-writer' }>;
    for (const section of sectionsResult.sections) {
      expect(section).toHaveProperty('id');
      expect(section).toHaveProperty('heading');
      expect(section).toHaveProperty('content');
      expect(section).toHaveProperty('order');
      expect(typeof section.id).toBe('string');
      expect(typeof section.heading).toBe('string');
      expect(typeof section.content).toBe('string');
      expect(typeof section.order).toBe('number');
    }
  });

  it('calls callLLM with agentName "sections-writer" and cacheControl true', async () => {
    const mockResponse = JSON.stringify([
      { id: 'purpose', heading: '# Project', content: 'Purpose.' },
    ]);
    callLLMMock.mockResolvedValueOnce(mockResponse);

    const config = makeConfig();
    await generateSections(
      'Build a CLI tool',
      makeSkeleton(),
      makeTask({ items: ['purpose'] }),
      config,
    );

    expect(callLLMMock).toHaveBeenCalledTimes(1);
    const callArgs = callLLMMock.mock.calls[0] as unknown[];
    const options = callArgs[2] as Record<string, unknown>;
    expect(options.agentName).toBe('sections-writer');
    expect(options.cacheControl).toBe(true);
  });

  it('passes maxTokens from task to callLLM', async () => {
    const mockResponse = JSON.stringify([
      { id: 'purpose', heading: '# Project', content: 'Purpose.' },
    ]);
    callLLMMock.mockResolvedValueOnce(mockResponse);

    await generateSections(
      'Build a tool',
      makeSkeleton(),
      makeTask({ items: ['purpose'], max_tokens: 8192 }),
      makeConfig(),
    );

    const callArgs = callLLMMock.mock.calls[0] as unknown[];
    const options = callArgs[2] as Record<string, unknown>;
    expect(options.maxTokens).toBe(8192);
  });

  it('parses JSON response correctly (plain JSON)', async () => {
    const sections = [
      { id: 'purpose', heading: '# CLI Tool', content: 'A command-line tool.' },
      { id: 'tech-stack', heading: '## Tech Stack', content: '- TypeScript\n- ESM' },
      { id: 'commands', heading: '## Commands', content: '```bash\nnpm test\n```' },
    ];
    callLLMMock.mockResolvedValueOnce(JSON.stringify(sections));

    const result = await generateSections(
      'Build a CLI',
      makeSkeleton(),
      makeTask(),
      makeConfig(),
    );

    const sectionsResult = result as Extract<AgentResult, { agent: 'sections-writer' }>;
    expect(sectionsResult.sections).toHaveLength(3);
    expect(sectionsResult.sections[0].id).toBe('purpose');
    expect(sectionsResult.sections[1].id).toBe('tech-stack');
    expect(sectionsResult.sections[2].id).toBe('commands');
  });

  it('parses JSON response wrapped in code fences', async () => {
    const sections = [
      { id: 'purpose', heading: '# Project', content: 'Purpose text.' },
    ];
    const fenced = '```json\n' + JSON.stringify(sections, null, 2) + '\n```';
    callLLMMock.mockResolvedValueOnce(fenced);

    const result = await generateSections(
      'Build something',
      makeSkeleton(),
      makeTask({ items: ['purpose'] }),
      makeConfig(),
    );

    const sectionsResult = result as Extract<AgentResult, { agent: 'sections-writer' }>;
    expect(sectionsResult.sections).toHaveLength(1);
    expect(sectionsResult.sections[0].id).toBe('purpose');
    expect(sectionsResult.sections[0].heading).toBe('# Project');
  });

  it('parses JSON response with leading text before the array', async () => {
    const sections = [
      { id: 'purpose', heading: '# App', content: 'App purpose.' },
    ];
    const withPreamble = 'Here are the sections:\n\n' + JSON.stringify(sections);
    callLLMMock.mockResolvedValueOnce(withPreamble);

    const result = await generateSections(
      'Build an app',
      makeSkeleton(),
      makeTask({ items: ['purpose'] }),
      makeConfig(),
    );

    const sectionsResult = result as Extract<AgentResult, { agent: 'sections-writer' }>;
    expect(sectionsResult.sections).toHaveLength(1);
    expect(sectionsResult.sections[0].id).toBe('purpose');
  });

  it('handles empty items list by returning empty sections without LLM call', async () => {
    const result = await generateSections(
      'Build something',
      makeSkeleton(),
      makeTask({ items: [] }),
      makeConfig(),
    );

    expect(result.agent).toBe('sections-writer');
    const sectionsResult = result as Extract<AgentResult, { agent: 'sections-writer' }>;
    expect(sectionsResult.sections).toHaveLength(0);
    expect(callLLMMock).not.toHaveBeenCalled();
  });

  it('creates sections with sequential order values starting from 0', async () => {
    const sections = [
      { id: 'purpose', heading: '# Project', content: 'Purpose.' },
      { id: 'tech-stack', heading: '## Tech Stack', content: 'Stack.' },
      { id: 'commands', heading: '## Commands', content: 'Commands.' },
      { id: 'conventions', heading: '## Conventions', content: 'Conventions.' },
    ];
    callLLMMock.mockResolvedValueOnce(JSON.stringify(sections));

    const result = await generateSections(
      'Build a project',
      makeSkeleton(),
      makeTask({ items: ['purpose', 'tech-stack', 'commands', 'conventions'] }),
      makeConfig(),
    );

    const sectionsResult = result as Extract<AgentResult, { agent: 'sections-writer' }>;
    expect(sectionsResult.sections).toHaveLength(4);
    expect(sectionsResult.sections[0].order).toBe(0);
    expect(sectionsResult.sections[1].order).toBe(1);
    expect(sectionsResult.sections[2].order).toBe(2);
    expect(sectionsResult.sections[3].order).toBe(3);
  });

  it('includes skeleton tech_stack and workflow_type in the user message', async () => {
    const mockResponse = JSON.stringify([
      { id: 'purpose', heading: '# Project', content: 'Purpose.' },
    ]);
    callLLMMock.mockResolvedValueOnce(mockResponse);

    const skeleton = makeSkeleton({
      outline: {
        tech_stack: ['Rust', 'Cargo'],
        workflow_type: 'systems-programming',
        key_commands: [],
        custom_rules: [],
        custom_agents: [],
        custom_skills: [],
      },
    });

    await generateSections(
      'Build a systems tool',
      skeleton,
      makeTask({ items: ['purpose'] }),
      makeConfig(),
    );

    const callArgs = callLLMMock.mock.calls[0] as unknown[];
    const userMessage = callArgs[1] as string;
    expect(userMessage).toContain('Rust');
    expect(userMessage).toContain('Cargo');
    expect(userMessage).toContain('systems-programming');
  });

  it('includes context_hint in the user message when provided', async () => {
    const mockResponse = JSON.stringify([
      { id: 'purpose', heading: '# Project', content: 'Purpose.' },
    ]);
    callLLMMock.mockResolvedValueOnce(mockResponse);

    await generateSections(
      'Build a tool',
      makeSkeleton(),
      makeTask({ items: ['purpose'], context_hint: 'Focus on developer experience' }),
      makeConfig(),
    );

    const callArgs = callLLMMock.mock.calls[0] as unknown[];
    const userMessage = callArgs[1] as string;
    expect(userMessage).toContain('Focus on developer experience');
  });

  it('does not include context_hint when not provided', async () => {
    const mockResponse = JSON.stringify([
      { id: 'purpose', heading: '# Project', content: 'Purpose.' },
    ]);
    callLLMMock.mockResolvedValueOnce(mockResponse);

    await generateSections(
      'Build a tool',
      makeSkeleton(),
      makeTask({ items: ['purpose'], context_hint: undefined }),
      makeConfig(),
    );

    const callArgs = callLLMMock.mock.calls[0] as unknown[];
    const userMessage = callArgs[1] as string;
    expect(userMessage).not.toContain('Additional Context');
  });

  it('throws when LLM response has no JSON array', async () => {
    callLLMMock.mockResolvedValueOnce('This is not JSON at all, just plain text.');

    await expect(
      generateSections(
        'Build something',
        makeSkeleton(),
        makeTask({ items: ['purpose'] }),
        makeConfig(),
      ),
    ).rejects.toThrow('sections-writer');
  });

  it('throws when LLM response contains no JSON array at all', async () => {
    callLLMMock.mockResolvedValueOnce('{"error": "something went wrong"}');

    await expect(
      generateSections(
        'Build something',
        makeSkeleton(),
        makeTask({ items: ['purpose'] }),
        makeConfig(),
      ),
    ).rejects.toThrow('sections-writer');
  });

  it('uses createSection factory producing correct Section shape', async () => {
    const mockResponse = JSON.stringify([
      { id: 'verification', heading: '## Verification', content: 'Run npm test.' },
    ]);
    callLLMMock.mockResolvedValueOnce(mockResponse);

    const result = await generateSections(
      'Build a project',
      makeSkeleton(),
      makeTask({ items: ['verification'] }),
      makeConfig(),
    );

    const sectionsResult = result as Extract<AgentResult, { agent: 'sections-writer' }>;
    const section: Section = sectionsResult.sections[0];
    expect(section).toEqual({
      id: 'verification',
      heading: '## Verification',
      content: 'Run npm test.',
      order: 0,
      target: 'claudemd',
    });
  });

  it('provides fallback id when LLM omits id field', async () => {
    const mockResponse = JSON.stringify([
      { heading: '## No ID Section', content: 'Content without id.' },
    ]);
    callLLMMock.mockResolvedValueOnce(mockResponse);

    const result = await generateSections(
      'Build something',
      makeSkeleton(),
      makeTask({ items: ['mystery'] }),
      makeConfig(),
    );

    const sectionsResult = result as Extract<AgentResult, { agent: 'sections-writer' }>;
    expect(sectionsResult.sections[0].id).toBe('section-0');
  });

  it('provides system prompt to callLLM', async () => {
    const mockResponse = JSON.stringify([
      { id: 'purpose', heading: '# Project', content: 'Purpose.' },
    ]);
    callLLMMock.mockResolvedValueOnce(mockResponse);

    await generateSections(
      'Build a tool',
      makeSkeleton(),
      makeTask({ items: ['purpose'] }),
      makeConfig(),
    );

    const callArgs = callLLMMock.mock.calls[0] as unknown[];
    const options = callArgs[2] as Record<string, unknown>;
    expect(typeof options.systemPrompt).toBe('string');
    expect((options.systemPrompt as string).length).toBeGreaterThan(100);
    expect((options.systemPrompt as string)).toContain('sections');
  });
});
