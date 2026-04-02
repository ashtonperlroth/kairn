import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentTask, AgentResult } from '../types.js';
import type { KairnConfig, SkeletonSpec } from '../../../types.js';

// ---------------------------------------------------------------------------
// Mock all six specialist modules
// ---------------------------------------------------------------------------

vi.mock('../sections-writer.js', () => ({ generateSections: vi.fn() }));
vi.mock('../rule-writer.js', () => ({ generateRules: vi.fn() }));
vi.mock('../doc-writer.js', () => ({ generateDocs: vi.fn() }));
vi.mock('../command-writer.js', () => ({ generateCommands: vi.fn() }));
vi.mock('../agent-writer.js', () => ({ generateAgents: vi.fn() }));
vi.mock('../skill-writer.js', () => ({ generateSkills: vi.fn() }));

// Import mocked functions so we can configure them
import { generateSections } from '../sections-writer.js';
import { generateRules } from '../rule-writer.js';
import { generateDocs } from '../doc-writer.js';
import { generateCommands } from '../command-writer.js';
import { generateAgents } from '../agent-writer.js';
import { generateSkills } from '../skill-writer.js';

// Import the module under test (after mocks are registered)
import { dispatchAgent } from '../dispatch.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeConfig(): KairnConfig {
  return {
    provider: 'anthropic',
    api_key: 'test-key',
    model: 'claude-sonnet-4-6',
    default_runtime: 'claude-code',
    created_at: new Date().toISOString(),
  };
}

function makeSkeleton(): SkeletonSpec {
  return {
    name: 'test-project',
    description: 'A test project',
    tools: [],
    outline: {
      tech_stack: ['TypeScript', 'Node.js'],
      workflow_type: 'feature-development',
      key_commands: ['build', 'test'],
      custom_rules: ['no-any'],
      custom_agents: ['reviewer'],
      custom_skills: ['deploy'],
    },
  };
}

function makeTask(agent: AgentTask['agent']): AgentTask {
  return {
    agent,
    items: ['item-a', 'item-b'],
    context_hint: 'test hint',
    max_tokens: 4096,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dispatchAgent', () => {
  const intent = 'Build a REST API with Express';
  const config = makeConfig();
  const skeleton = makeSkeleton();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches sections-writer task to generateSections', async () => {
    const task = makeTask('sections-writer');
    const expected: AgentResult = {
      agent: 'sections-writer',
      sections: [{ id: 's1', heading: 'Intro', content: 'Hello', order: 0 }],
    };
    vi.mocked(generateSections).mockResolvedValueOnce(expected);

    const result = await dispatchAgent(task, config, intent, skeleton);

    expect(result).toBe(expected);
    expect(generateSections).toHaveBeenCalledOnce();
  });

  it('dispatches rule-writer task to generateRules', async () => {
    const task = makeTask('rule-writer');
    const expected: AgentResult = {
      agent: 'rule-writer',
      rules: [{ name: 'no-any', content: 'Avoid any' }],
    };
    vi.mocked(generateRules).mockResolvedValueOnce(expected);

    const result = await dispatchAgent(task, config, intent, skeleton);

    expect(result).toBe(expected);
    expect(generateRules).toHaveBeenCalledOnce();
  });

  it('dispatches doc-writer task to generateDocs', async () => {
    const task = makeTask('doc-writer');
    const expected: AgentResult = {
      agent: 'doc-writer',
      docs: [{ name: 'API', content: 'API docs' }],
    };
    vi.mocked(generateDocs).mockResolvedValueOnce(expected);

    const result = await dispatchAgent(task, config, intent, skeleton);

    expect(result).toBe(expected);
    expect(generateDocs).toHaveBeenCalledOnce();
  });

  it('dispatches command-writer task to generateCommands', async () => {
    const task = makeTask('command-writer');
    const expected: AgentResult = {
      agent: 'command-writer',
      commands: [{ name: 'build', description: 'Run build', content: 'npm run build' }],
    };
    vi.mocked(generateCommands).mockResolvedValueOnce(expected);

    const result = await dispatchAgent(task, config, intent, skeleton);

    expect(result).toBe(expected);
    expect(generateCommands).toHaveBeenCalledOnce();
  });

  it('dispatches agent-writer task to generateAgents', async () => {
    const task = makeTask('agent-writer');
    const expected: AgentResult = {
      agent: 'agent-writer',
      agents: [{ name: 'reviewer', content: 'Review code' }],
    };
    vi.mocked(generateAgents).mockResolvedValueOnce(expected);

    const result = await dispatchAgent(task, config, intent, skeleton);

    expect(result).toBe(expected);
    expect(generateAgents).toHaveBeenCalledOnce();
  });

  it('dispatches skill-writer task to generateSkills', async () => {
    const task = makeTask('skill-writer');
    const expected: AgentResult = {
      agent: 'skill-writer',
      skills: [{ name: 'deploy', content: 'Deploy steps' }],
    };
    vi.mocked(generateSkills).mockResolvedValueOnce(expected);

    const result = await dispatchAgent(task, config, intent, skeleton);

    expect(result).toBe(expected);
    expect(generateSkills).toHaveBeenCalledOnce();
  });

  it('passes correct arguments (intent, skeleton, task, config) to each specialist', async () => {
    const task = makeTask('sections-writer');
    const expected: AgentResult = {
      agent: 'sections-writer',
      sections: [],
    };
    vi.mocked(generateSections).mockResolvedValueOnce(expected);

    await dispatchAgent(task, config, intent, skeleton);

    expect(generateSections).toHaveBeenCalledWith(intent, skeleton, task, config);
  });

  it('throws on unknown agent name', async () => {
    const badTask = { agent: 'unknown-agent', items: [], max_tokens: 1024 } as unknown as AgentTask;

    await expect(
      dispatchAgent(badTask, config, intent, skeleton),
    ).rejects.toThrow('Unknown agent: unknown-agent');
  });
});
