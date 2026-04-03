import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KairnConfig, SkeletonSpec } from '../../types.js';
import type { CompilationPlan, AgentName } from '../agents/types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const callLLMMock = vi.fn();
vi.mock('../../llm.js', () => ({
  callLLM: callLLMMock,
}));

// Import after mocks are registered
const { generatePlan, generateDefaultPlan } = await import('../plan.js');

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
    description: 'A test project for unit testing',
    tools: [{ tool_id: 'github', reason: 'Version control' }],
    outline: {
      tech_stack: ['TypeScript', 'Node.js'],
      workflow_type: 'feature-development',
      key_commands: ['build', 'test', 'lint'],
      custom_rules: ['no-console'],
      custom_agents: ['architect', 'implementer'],
      custom_skills: [],
    },
    ...overrides,
  };
}

function makeValidPlanJson(overrides: Partial<CompilationPlan> = {}): string {
  const plan: CompilationPlan = {
    project_context: 'Test project: A TypeScript CLI for testing',
    phases: [
      {
        id: 'phase-a',
        agents: [
          { agent: 'sections-writer', items: ['purpose', 'tech-stack', 'commands'], max_tokens: 4096 },
          { agent: 'rule-writer', items: ['security', 'continuity'], max_tokens: 2048 },
          { agent: 'doc-writer', items: ['DECISIONS', 'LEARNINGS', 'SPRINT'], max_tokens: 2048 },
        ],
        dependsOn: [],
      },
      {
        id: 'phase-b',
        agents: [
          { agent: 'command-writer', items: ['help', 'build', 'test'], max_tokens: 4096 },
          { agent: 'agent-writer', items: ['architect', 'implementer'], max_tokens: 4096 },
        ],
        dependsOn: ['phase-a'],
      },
    ],
    ...overrides,
  };
  return JSON.stringify(plan);
}

// ---------------------------------------------------------------------------
// Tests: generatePlan
// ---------------------------------------------------------------------------

describe('generatePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a valid CompilationPlan from a simple skeleton', async () => {
    callLLMMock.mockResolvedValueOnce(makeValidPlanJson());

    const config = makeConfig();
    const skeleton = makeSkeleton();
    const plan = await generatePlan('Build a CLI tool', skeleton, config);

    expect(plan).toBeDefined();
    expect(plan.project_context).toBeTruthy();
    expect(Array.isArray(plan.phases)).toBe(true);
    expect(plan.phases.length).toBeGreaterThanOrEqual(2);
  });

  it('plan has a non-empty project_context', async () => {
    callLLMMock.mockResolvedValueOnce(makeValidPlanJson());

    const config = makeConfig();
    const skeleton = makeSkeleton();
    const plan = await generatePlan('Build a web API', skeleton, config);

    expect(typeof plan.project_context).toBe('string');
    expect(plan.project_context.trim().length).toBeGreaterThan(0);
  });

  it('plan always has at least 2 phases (Phase A and Phase B)', async () => {
    callLLMMock.mockResolvedValueOnce(makeValidPlanJson());

    const config = makeConfig();
    const skeleton = makeSkeleton();
    const plan = await generatePlan('Build a CLI', skeleton, config);

    expect(plan.phases.length).toBeGreaterThanOrEqual(2);
  });

  it('Phase A has sections-writer, rule-writer, doc-writer with no dependencies', async () => {
    callLLMMock.mockResolvedValueOnce(makeValidPlanJson());

    const config = makeConfig();
    const skeleton = makeSkeleton();
    const plan = await generatePlan('Build a CLI', skeleton, config);

    const phaseA = plan.phases[0];
    expect(phaseA.dependsOn).toEqual([]);

    const agentNames = phaseA.agents.map(a => a.agent);
    expect(agentNames).toContain('sections-writer');
    expect(agentNames).toContain('rule-writer');
    expect(agentNames).toContain('doc-writer');
  });

  it('Phase B has command-writer and agent-writer, depends on Phase A', async () => {
    callLLMMock.mockResolvedValueOnce(makeValidPlanJson());

    const config = makeConfig();
    const skeleton = makeSkeleton();
    const plan = await generatePlan('Build a CLI', skeleton, config);

    const phaseB = plan.phases[1];
    expect(phaseB.dependsOn).toContain(plan.phases[0].id);

    const agentNames = phaseB.agents.map(a => a.agent);
    expect(agentNames).toContain('command-writer');
    expect(agentNames).toContain('agent-writer');
  });

  it('calls callLLM with maxTokens: 2048 and cacheControl: true', async () => {
    callLLMMock.mockResolvedValueOnce(makeValidPlanJson());

    const config = makeConfig();
    const skeleton = makeSkeleton();
    await generatePlan('Build a CLI', skeleton, config);

    expect(callLLMMock).toHaveBeenCalledTimes(1);
    const callArgs = callLLMMock.mock.calls[0];
    const options = callArgs[2] as Record<string, unknown>;
    expect(options.maxTokens).toBe(2048);
    expect(options.cacheControl).toBe(true);
  });

  it('falls back to generateDefaultPlan when LLM call throws', async () => {
    callLLMMock.mockRejectedValueOnce(new Error('API rate limited'));

    const config = makeConfig();
    const skeleton = makeSkeleton();
    const plan = await generatePlan('Build a CLI', skeleton, config);

    // Should NOT throw — should silently fallback
    expect(plan).toBeDefined();
    expect(plan.project_context).toBeTruthy();
    expect(plan.phases.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back when LLM returns invalid JSON', async () => {
    callLLMMock.mockResolvedValueOnce('This is not JSON at all, just random text.');

    const config = makeConfig();
    const skeleton = makeSkeleton();
    const plan = await generatePlan('Build a CLI', skeleton, config);

    // Should NOT throw — should silently fallback
    expect(plan).toBeDefined();
    expect(plan.project_context).toBeTruthy();
    expect(plan.phases.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back when LLM returns JSON with missing required fields', async () => {
    callLLMMock.mockResolvedValueOnce(JSON.stringify({ not_a_plan: true }));

    const config = makeConfig();
    const skeleton = makeSkeleton();
    const plan = await generatePlan('Build a CLI', skeleton, config);

    expect(plan).toBeDefined();
    expect(plan.phases.length).toBeGreaterThanOrEqual(2);
  });

  it('handles JSON wrapped in markdown code fences', async () => {
    const wrappedJson = '```json\n' + makeValidPlanJson() + '\n```';
    callLLMMock.mockResolvedValueOnce(wrappedJson);

    const config = makeConfig();
    const skeleton = makeSkeleton();
    const plan = await generatePlan('Build a CLI', skeleton, config);

    expect(plan).toBeDefined();
    expect(plan.project_context).toBeTruthy();
    expect(plan.phases.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: generateDefaultPlan
// ---------------------------------------------------------------------------

describe('generateDefaultPlan', () => {
  it('works without LLM (deterministic fallback)', () => {
    const skeleton = makeSkeleton();
    const plan = generateDefaultPlan(skeleton);

    expect(plan).toBeDefined();
    expect(plan.project_context).toBeTruthy();
    expect(plan.phases.length).toBeGreaterThanOrEqual(2);
  });

  it('project_context includes skeleton name and description', () => {
    const skeleton = makeSkeleton({
      name: 'my-api',
      description: 'A REST API for widgets',
    });
    const plan = generateDefaultPlan(skeleton);

    expect(plan.project_context).toContain('my-api');
    expect(plan.project_context).toContain('A REST API for widgets');
  });

  it('Phase A has sections-writer, rule-writer, doc-writer with no dependencies', () => {
    const skeleton = makeSkeleton();
    const plan = generateDefaultPlan(skeleton);

    const phaseA = plan.phases[0];
    expect(phaseA.dependsOn).toEqual([]);

    const agentNames = phaseA.agents.map(a => a.agent);
    expect(agentNames).toContain('sections-writer');
    expect(agentNames).toContain('rule-writer');
    expect(agentNames).toContain('doc-writer');
  });

  it('Phase B depends on Phase A', () => {
    const skeleton = makeSkeleton();
    const plan = generateDefaultPlan(skeleton);

    const phaseB = plan.phases[1];
    expect(phaseB.dependsOn).toContain(plan.phases[0].id);
  });

  it('Phase B has command-writer', () => {
    const skeleton = makeSkeleton();
    const plan = generateDefaultPlan(skeleton);

    const phaseB = plan.phases[1];
    const agentNames = phaseB.agents.map(a => a.agent);
    expect(agentNames).toContain('command-writer');
  });

  it('includes agent-writer in Phase B when skeleton has custom_agents', () => {
    const skeleton = makeSkeleton({
      outline: {
        tech_stack: ['TypeScript'],
        workflow_type: 'feature-development',
        key_commands: ['build'],
        custom_rules: [],
        custom_agents: ['architect', 'implementer'],
        custom_skills: [],
      },
    });
    const plan = generateDefaultPlan(skeleton);

    const phaseB = plan.phases[1];
    const agentNames = phaseB.agents.map(a => a.agent);
    expect(agentNames).toContain('agent-writer');
  });

  it('includes skill-writer when skeleton has custom_skills', () => {
    const skeleton = makeSkeleton({
      outline: {
        tech_stack: ['TypeScript'],
        workflow_type: 'feature-development',
        key_commands: ['build'],
        custom_rules: [],
        custom_agents: [],
        custom_skills: ['tdd', 'pair-programming'],
      },
    });
    const plan = generateDefaultPlan(skeleton);

    const phaseB = plan.phases[1];
    const agentNames = phaseB.agents.map(a => a.agent);
    expect(agentNames).toContain('skill-writer');

    const skillTask = phaseB.agents.find(a => a.agent === 'skill-writer');
    expect(skillTask).toBeDefined();
    expect(skillTask!.items).toEqual(['tdd', 'pair-programming']);
  });

  it('omits skill-writer when skeleton has no custom_skills', () => {
    const skeleton = makeSkeleton({
      outline: {
        tech_stack: ['TypeScript'],
        workflow_type: 'feature-development',
        key_commands: ['build'],
        custom_rules: [],
        custom_agents: [],
        custom_skills: [],
      },
    });
    const plan = generateDefaultPlan(skeleton);

    const allAgentNames = plan.phases.flatMap(p => p.agents.map(a => a.agent));
    expect(allAgentNames).not.toContain('skill-writer');
  });

  it('includes custom_rules items in rule-writer', () => {
    const skeleton = makeSkeleton({
      outline: {
        tech_stack: ['TypeScript'],
        workflow_type: 'feature-development',
        key_commands: ['build'],
        custom_rules: ['no-console', 'strict-types'],
        custom_agents: [],
        custom_skills: [],
      },
    });
    const plan = generateDefaultPlan(skeleton);

    const phaseA = plan.phases[0];
    const ruleTask = phaseA.agents.find(a => a.agent === 'rule-writer');
    expect(ruleTask).toBeDefined();
    expect(ruleTask!.items).toContain('security');
    expect(ruleTask!.items).toContain('continuity');
    expect(ruleTask!.items).toContain('no-console');
    expect(ruleTask!.items).toContain('strict-types');
  });

  it('includes key_commands in command-writer items', () => {
    const skeleton = makeSkeleton({
      outline: {
        tech_stack: ['TypeScript'],
        workflow_type: 'feature-development',
        key_commands: ['build', 'test', 'deploy'],
        custom_rules: [],
        custom_agents: [],
        custom_skills: [],
      },
    });
    const plan = generateDefaultPlan(skeleton);

    const phaseB = plan.phases[1];
    const cmdTask = phaseB.agents.find(a => a.agent === 'command-writer');
    expect(cmdTask).toBeDefined();
    expect(cmdTask!.items).toContain('help');
    expect(cmdTask!.items).toContain('build');
    expect(cmdTask!.items).toContain('test');
    expect(cmdTask!.items).toContain('deploy');
  });
});

// ---------------------------------------------------------------------------
// Tests: Token budgets
// ---------------------------------------------------------------------------

describe('token budgets', () => {
  it('sections-writer gets max_tokens: 4096', () => {
    const skeleton = makeSkeleton();
    const plan = generateDefaultPlan(skeleton);

    const task = plan.phases
      .flatMap(p => p.agents)
      .find(a => a.agent === 'sections-writer');
    expect(task).toBeDefined();
    expect(task!.max_tokens).toBe(4096);
  });

  it('command-writer gets max_tokens: 4096', () => {
    const skeleton = makeSkeleton();
    const plan = generateDefaultPlan(skeleton);

    const task = plan.phases
      .flatMap(p => p.agents)
      .find(a => a.agent === 'command-writer');
    expect(task).toBeDefined();
    expect(task!.max_tokens).toBe(4096);
  });

  it('agent-writer gets max_tokens: 4096', () => {
    const skeleton = makeSkeleton({
      outline: {
        tech_stack: ['TypeScript'],
        workflow_type: 'feature-development',
        key_commands: ['build'],
        custom_rules: [],
        custom_agents: ['architect'],
        custom_skills: [],
      },
    });
    const plan = generateDefaultPlan(skeleton);

    const task = plan.phases
      .flatMap(p => p.agents)
      .find(a => a.agent === 'agent-writer');
    expect(task).toBeDefined();
    expect(task!.max_tokens).toBe(4096);
  });

  it('rule-writer gets max_tokens: 2048', () => {
    const skeleton = makeSkeleton();
    const plan = generateDefaultPlan(skeleton);

    const task = plan.phases
      .flatMap(p => p.agents)
      .find(a => a.agent === 'rule-writer');
    expect(task).toBeDefined();
    expect(task!.max_tokens).toBe(2048);
  });

  it('doc-writer gets max_tokens: 2048', () => {
    const skeleton = makeSkeleton();
    const plan = generateDefaultPlan(skeleton);

    const task = plan.phases
      .flatMap(p => p.agents)
      .find(a => a.agent === 'doc-writer');
    expect(task).toBeDefined();
    expect(task!.max_tokens).toBe(2048);
  });

  it('skill-writer gets max_tokens: 2048', () => {
    const skeleton = makeSkeleton({
      outline: {
        tech_stack: ['TypeScript'],
        workflow_type: 'feature-development',
        key_commands: ['build'],
        custom_rules: [],
        custom_agents: [],
        custom_skills: ['tdd'],
      },
    });
    const plan = generateDefaultPlan(skeleton);

    const task = plan.phases
      .flatMap(p => p.agents)
      .find(a => a.agent === 'skill-writer');
    expect(task).toBeDefined();
    expect(task!.max_tokens).toBe(2048);
  });
});
