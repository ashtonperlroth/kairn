import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentTask } from '../types.js';
import type { KairnConfig, SkeletonSpec } from '../../../types.js';
import type { RuleNode } from '../../../ir/types.js';

// ---------------------------------------------------------------------------
// Mock callLLM before importing the module under test
// ---------------------------------------------------------------------------

const callLLMMock = vi.fn();

vi.mock('../../../llm.js', () => ({
  callLLM: callLLMMock,
}));

// Import after mocking
const { generateRules } = await import('../rule-writer.js');

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

function makeSkeleton(overrides: Partial<SkeletonSpec> = {}): SkeletonSpec {
  return {
    name: 'test-project',
    description: 'A test project',
    tools: [],
    outline: {
      tech_stack: ['typescript', 'express', 'vitest'],
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
    agent: 'rule-writer',
    items: ['security', 'api-conventions', 'testing'],
    max_tokens: 8192,
    ...overrides,
  };
}

/** Wrap a JSON array in a markdown code fence (LLMs often do this). */
function fenced(json: string): string {
  return '```json\n' + json + '\n```';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -- Return shape -----------------------------------------------------------

  it('returns AgentResult with agent: "rule-writer" and rules: RuleNode[]', async () => {
    const llmResponse = JSON.stringify([
      { name: 'security', content: 'Never expose secrets.', paths: null },
      { name: 'continuity', content: 'Keep docs current.', paths: null },
      { name: 'api', content: 'Use REST conventions.', paths: ['src/api/**'] },
    ]);
    callLLMMock.mockResolvedValueOnce(llmResponse);

    const result = await generateRules(
      'Build a REST API with Express and TypeScript',
      makeSkeleton(),
      makeTask(),
      makeConfig(),
    );

    expect(result.agent).toBe('rule-writer');
    if (result.agent === 'rule-writer') {
      expect(Array.isArray(result.rules)).toBe(true);
      expect(result.rules.length).toBe(3);
    }
  });

  // -- Default rule injection -------------------------------------------------

  it('injects default security rule when LLM omits it', async () => {
    const llmResponse = JSON.stringify([
      { name: 'continuity', content: 'Keep docs current.', paths: null },
      { name: 'api', content: 'REST patterns.', paths: ['src/api/**'] },
    ]);
    callLLMMock.mockResolvedValueOnce(llmResponse);

    const result = await generateRules(
      'Build a REST API with Express and TypeScript',
      makeSkeleton(),
      makeTask(),
      makeConfig(),
    );

    if (result.agent === 'rule-writer') {
      const securityRule = result.rules.find((r: RuleNode) => r.name === 'security');
      expect(securityRule).toBeDefined();
      expect(securityRule!.content).toBeTruthy();
    }
  });

  it('injects default continuity rule when LLM omits it', async () => {
    const llmResponse = JSON.stringify([
      { name: 'security', content: 'No secrets in code.', paths: null },
      { name: 'testing', content: 'Write tests first.', paths: ['src/**/*.test.ts'] },
    ]);
    callLLMMock.mockResolvedValueOnce(llmResponse);

    const result = await generateRules(
      'Build a REST API with Express and TypeScript',
      makeSkeleton(),
      makeTask(),
      makeConfig(),
    );

    if (result.agent === 'rule-writer') {
      const continuityRule = result.rules.find((r: RuleNode) => r.name === 'continuity');
      expect(continuityRule).toBeDefined();
      expect(continuityRule!.content).toBeTruthy();
    }
  });

  it('does not duplicate security rule when LLM already includes it', async () => {
    const llmResponse = JSON.stringify([
      { name: 'security', content: 'Custom security policy.', paths: null },
      { name: 'continuity', content: 'Keep docs current.', paths: null },
    ]);
    callLLMMock.mockResolvedValueOnce(llmResponse);

    const result = await generateRules(
      'Build a REST API with Express and TypeScript',
      makeSkeleton(),
      makeTask(),
      makeConfig(),
    );

    if (result.agent === 'rule-writer') {
      const securityRules = result.rules.filter((r: RuleNode) => r.name === 'security');
      expect(securityRules.length).toBe(1);
      expect(securityRules[0].content).toBe('Custom security policy.');
    }
  });

  // -- Path scoping -----------------------------------------------------------

  it('sets paths array for path-scoped rules', async () => {
    const llmResponse = JSON.stringify([
      { name: 'security', content: 'No secrets.', paths: null },
      { name: 'continuity', content: 'Docs current.', paths: null },
      { name: 'api', content: 'REST conventions.', paths: ['src/api/**', 'src/routes/**'] },
    ]);
    callLLMMock.mockResolvedValueOnce(llmResponse);

    const result = await generateRules(
      'Build a REST API with Express and TypeScript',
      makeSkeleton(),
      makeTask(),
      makeConfig(),
    );

    if (result.agent === 'rule-writer') {
      const apiRule = result.rules.find((r: RuleNode) => r.name === 'api');
      expect(apiRule).toBeDefined();
      expect(apiRule!.paths).toEqual(['src/api/**', 'src/routes/**']);
    }
  });

  it('leaves paths as undefined for global rules (paths: null)', async () => {
    const llmResponse = JSON.stringify([
      { name: 'security', content: 'Global security rule.', paths: null },
      { name: 'continuity', content: 'Keep things updated.', paths: null },
    ]);
    callLLMMock.mockResolvedValueOnce(llmResponse);

    const result = await generateRules(
      'Build a REST API with Express and TypeScript',
      makeSkeleton(),
      makeTask(),
      makeConfig(),
    );

    if (result.agent === 'rule-writer') {
      const securityRule = result.rules.find((r: RuleNode) => r.name === 'security');
      expect(securityRule).toBeDefined();
      expect(securityRule!.paths).toBeUndefined();
    }
  });

  // -- LLM call options -------------------------------------------------------

  it('calls callLLM with cacheControl: true', async () => {
    const llmResponse = JSON.stringify([
      { name: 'security', content: 'No secrets.', paths: null },
      { name: 'continuity', content: 'Docs current.', paths: null },
    ]);
    callLLMMock.mockResolvedValueOnce(llmResponse);

    await generateRules(
      'Build a REST API with Express and TypeScript',
      makeSkeleton(),
      makeTask(),
      makeConfig(),
    );

    expect(callLLMMock).toHaveBeenCalledTimes(1);
    const callArgs = callLLMMock.mock.calls[0];
    expect(callArgs[2]).toMatchObject({ cacheControl: true });
  });

  it('calls callLLM with a systemPrompt string', async () => {
    const llmResponse = JSON.stringify([
      { name: 'security', content: 'No secrets.', paths: null },
      { name: 'continuity', content: 'Docs current.', paths: null },
    ]);
    callLLMMock.mockResolvedValueOnce(llmResponse);

    await generateRules(
      'Build a REST API with Express and TypeScript',
      makeSkeleton(),
      makeTask(),
      makeConfig(),
    );

    const callArgs = callLLMMock.mock.calls[0];
    expect(typeof callArgs[2].systemPrompt).toBe('string');
    expect(callArgs[2].systemPrompt.length).toBeGreaterThan(0);
  });

  // -- Code fence stripping ---------------------------------------------------

  it('parses JSON response wrapped in markdown code fences', async () => {
    const llmResponse = fenced(
      JSON.stringify([
        { name: 'security', content: 'Secure by default.', paths: null },
        { name: 'continuity', content: 'Track changes.', paths: null },
      ]),
    );
    callLLMMock.mockResolvedValueOnce(llmResponse);

    const result = await generateRules(
      'Build a REST API with Express and TypeScript',
      makeSkeleton(),
      makeTask(),
      makeConfig(),
    );

    expect(result.agent).toBe('rule-writer');
    if (result.agent === 'rule-writer') {
      expect(result.rules.length).toBeGreaterThanOrEqual(2);
    }
  });

  // -- Empty items → no LLM call ---------------------------------------------

  it('returns empty rules without calling LLM when items is empty', async () => {
    const task = makeTask({ items: [] });

    const result = await generateRules(
      'Build a REST API with Express and TypeScript',
      makeSkeleton(),
      task,
      makeConfig(),
    );

    expect(result).toEqual({ agent: 'rule-writer', rules: [] });
    expect(callLLMMock).not.toHaveBeenCalled();
  });
});
