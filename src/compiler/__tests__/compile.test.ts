/**
 * Tests for the refactored compile() function using the multi-agent pipeline.
 *
 * Mocks the pipeline dependencies (plan, batch, linker, LLM, config, registry)
 * and verifies that compile() orchestrates them correctly and produces a valid
 * EnvironmentSpec with both `ir` and backward-compatible `harness` fields.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { KairnConfig, SkeletonSpec, CompileProgress } from '../../types.js';
import type { CompilationPlan } from '../agents/types.js';
import type { HarnessIR } from '../../ir/types.js';
import { createEmptyIR } from '../../ir/types.js';
import type { LinkReport } from '../linker.js';

// ---------------------------------------------------------------------------
// Mocks — vi.mock factories must not reference top-level variables
// ---------------------------------------------------------------------------

vi.mock('../../config.js', () => ({
  loadConfig: vi.fn(),
  getEnvsDir: vi.fn(() => '/tmp/kairn-test-envs'),
  ensureDirs: vi.fn(),
}));

vi.mock('../../registry/loader.js', () => ({
  loadRegistry: vi.fn(() => [
    {
      id: 'context7',
      name: 'Context7',
      description: 'Docs',
      category: 'docs',
      tier: 1,
      type: 'mcp_server',
      auth: 'none',
      best_for: ['docs'],
      install: { mcp_config: { command: 'npx', args: ['@context7/mcp'] } },
    },
  ]),
}));

vi.mock('../../llm.js', () => ({
  callLLM: vi.fn(),
}));

vi.mock('../plan.js', () => ({
  generatePlan: vi.fn(),
}));

vi.mock('../batch.js', () => ({
  executePlan: vi.fn(),
}));

vi.mock('../linker.js', () => ({
  linkHarness: vi.fn(),
}));

// Intent routing mocks removed in v2.12 — compile.ts no longer imports these modules

vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks (vi.mock is hoisted above imports)
// ---------------------------------------------------------------------------

import { compile, generateClarifications, buildSettings } from '../compile.js';
import { loadConfig } from '../../config.js';
import { callLLM } from '../../llm.js';
import { generatePlan } from '../plan.js';
import { executePlan } from '../batch.js';
import { linkHarness } from '../linker.js';

// Cast to Mock for convenience
const mockedLoadConfig = loadConfig as Mock;
const mockedCallLLM = callLLM as Mock;
const mockedGeneratePlan = generatePlan as Mock;
const mockedExecutePlan = executePlan as Mock;
const mockedLinkHarness = linkHarness as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(): KairnConfig {
  return {
    provider: 'anthropic',
    api_key: 'test-key',
    model: 'claude-sonnet-4-6',
    default_runtime: 'claude-code',
    created_at: new Date().toISOString(),
    auth_type: 'api-key',
  };
}

function makeSkeleton(): SkeletonSpec {
  return {
    name: 'test-project',
    description: 'A test project',
    tools: [{ tool_id: 'context7', reason: 'docs' }],
    outline: {
      tech_stack: ['TypeScript', 'Node.js'],
      workflow_type: 'code',
      key_commands: ['build', 'test'],
      custom_rules: ['testing'],
      custom_agents: ['reviewer'],
      custom_skills: ['tdd'],
    },
  };
}

function makePlan(): CompilationPlan {
  return {
    project_context: 'test-project: A test project',
    phases: [
      {
        id: 'phase-a',
        agents: [
          { agent: 'sections-writer', items: ['purpose'], max_tokens: 4096 },
          { agent: 'rule-writer', items: ['security'], max_tokens: 2048 },
          { agent: 'doc-writer', items: ['DECISIONS'], max_tokens: 2048 },
        ],
        dependsOn: [],
      },
      {
        id: 'phase-b',
        agents: [
          { agent: 'command-writer', items: ['help', 'build'], max_tokens: 4096 },
          { agent: 'agent-writer', items: ['reviewer'], max_tokens: 4096 },
          { agent: 'skill-writer', items: ['tdd'], max_tokens: 2048 },
        ],
        dependsOn: ['phase-a'],
      },
    ],
  };
}

function makeIR(): HarnessIR {
  const ir = createEmptyIR();
  ir.meta = {
    name: 'test-project',
    purpose: 'A test project',
    techStack: { language: 'TypeScript', framework: 'Node.js' },
    autonomyLevel: 1,
  };
  ir.sections = [
    { id: 'purpose', heading: '## Purpose', content: 'A test project', order: 1 },
  ];
  ir.commands = [
    { name: 'help', description: 'Show help', content: 'Show available commands.' },
    { name: 'build', description: 'Build project', content: 'Run npm run build.' },
  ];
  ir.rules = [
    { name: 'security', content: '# Security\n\n- No secrets' },
    { name: 'continuity', content: '# Continuity\n\n- Update docs' },
  ];
  ir.agents = [
    { name: 'reviewer', content: 'Review code quality.' },
  ];
  ir.skills = [
    { name: 'tdd', content: 'TDD workflow...' },
  ];
  ir.docs = [
    { name: 'DECISIONS', content: '# Decisions' },
  ];
  return ir;
}

function makeLinkReport(): LinkReport {
  return { warnings: [], autoFixes: ['Injected default /project:help command'] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('compile()', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockedLoadConfig.mockResolvedValue(makeConfig());
    mockedCallLLM.mockResolvedValue(JSON.stringify(makeSkeleton()));
    mockedGeneratePlan.mockResolvedValue(makePlan());
    mockedExecutePlan.mockResolvedValue(makeIR());
    mockedLinkHarness.mockReturnValue({ ir: makeIR(), report: makeLinkReport() });
  });

  it('returns an EnvironmentSpec with the ir field (HarnessIR)', async () => {
    const spec = await compile('Build a TypeScript CLI');

    expect(spec).toBeDefined();
    expect(spec.ir).toBeDefined();
    expect(spec.ir!.meta.name).toBe('test-project');
    expect(spec.ir!.sections).toHaveLength(1);
    expect(spec.ir!.commands).toHaveLength(2);
    expect(spec.ir!.rules).toHaveLength(2);
    expect(spec.ir!.agents).toHaveLength(1);
    expect(spec.ir!.skills).toHaveLength(1);
    expect(spec.ir!.docs).toHaveLength(1);
  });

  it('returns a target-neutral HarnessProgram converted from the linked IR', async () => {
    const spec = await compile('Build a TypeScript CLI');

    expect(spec.program).toBeDefined();
    expect(spec.program!.compatibility.source).toBe('HarnessIR');
    expect(spec.program!.targets).toEqual(['claude-code']);
    expect(spec.program!.workflows.map((workflow) => workflow.id)).toContain('workflow:build');
    expect(spec.program!.agents.map((agent) => agent.id)).toEqual(['agent:reviewer']);
    expect(spec.program!.skills.map((skill) => skill.id)).toEqual(['skill:tdd']);
  });

  it('returns backward-compatible harness fields from IR', async () => {
    const spec = await compile('Build a TypeScript CLI');

    // Commands should be a Record<string, string> derived from IR
    expect(spec.harness.commands).toHaveProperty('help');
    expect(spec.harness.commands).toHaveProperty('build');
    expect(typeof spec.harness.commands['help']).toBe('string');

    // Rules
    expect(spec.harness.rules).toHaveProperty('security');
    expect(spec.harness.rules).toHaveProperty('continuity');

    // Agents
    expect(spec.harness.agents).toHaveProperty('reviewer');

    // Skills
    expect(spec.harness.skills).toHaveProperty('tdd');

    // Docs
    expect(spec.harness.docs).toHaveProperty('DECISIONS');
  });

  it('calls generatePlan, executePlan, linkHarness in sequence', async () => {
    await compile('Build a TypeScript CLI');

    expect(mockedGeneratePlan).toHaveBeenCalledOnce();
    expect(mockedExecutePlan).toHaveBeenCalledOnce();
    expect(mockedLinkHarness).toHaveBeenCalledOnce();

    // Verify executePlan was called with the plan from generatePlan
    const plan = await mockedGeneratePlan.mock.results[0].value;
    expect(mockedExecutePlan.mock.calls[0][0]).toBe(plan);
  });

  it('emits progress callbacks with new phase names', async () => {
    const phases: string[] = [];

    await compile('Build a TypeScript CLI', (p: CompileProgress) => {
      phases.push(p.phase);
    });

    // Should include the new phases
    expect(phases).toContain('registry');
    expect(phases).toContain('pass1');
    expect(phases).toContain('plan');
    expect(phases).toContain('done');
  });

  it('populates harness.claude_md from renderClaudeMd', async () => {
    const spec = await compile('Build a TypeScript CLI');

    // claude_md should be populated (from renderClaudeMd on the IR sections)
    expect(spec.harness.claude_md).toBeDefined();
    expect(typeof spec.harness.claude_md).toBe('string');
    expect(spec.harness.claude_md.length).toBeGreaterThan(0);
  });

  it('includes settings and mcp_config in harness', async () => {
    const spec = await compile('Build a TypeScript CLI');

    // Settings should have permissions
    expect(spec.harness.settings).toBeDefined();
    expect(spec.harness.mcp_config).toBeDefined();
  });

  it('has standard EnvironmentSpec fields', async () => {
    const spec = await compile('Build a TypeScript CLI');

    expect(spec.id).toMatch(/^env_/);
    expect(spec.name).toBe('test-project');
    expect(spec.description).toBe('A test project');
    expect(spec.intent).toBe('Build a TypeScript CLI');
    expect(spec.created_at).toBeDefined();
    expect(spec.autonomy_level).toBe(1);
    expect(spec.tools).toHaveLength(1);
  });

  it('forwards linker warnings through progress callbacks', async () => {
    mockedLinkHarness.mockReturnValue({
      ir: makeIR(),
      report: {
        warnings: ['Command "deploy" references non-existent agent "deployer"'],
        autoFixes: [],
      },
    });

    const messages: string[] = [];

    await compile('Build a TypeScript CLI', (p: CompileProgress) => {
      if (p.status === 'warning' && p.message.includes('non-existent')) {
        messages.push(p.message);
      }
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('non-existent agent');
  });

  it('emits adapter capability warnings for the configured runtime target', async () => {
    mockedLoadConfig.mockResolvedValue({
      ...makeConfig(),
      default_runtime: 'hermes',
    });

    const messages: string[] = [];
    await compile('Build a TypeScript CLI', (p: CompileProgress) => {
      if (p.status === 'warning') messages.push(p.message);
    });

    expect(messages.some((message) => message.includes('Hermes') && message.includes('agents'))).toBe(true);
    expect(messages.some((message) => message.includes('Hermes') && message.includes('docs'))).toBe(true);
  });

  it('uses concurrency 2 for claude-code-oauth auth type', async () => {
    const oauthConfig = makeConfig();
    oauthConfig.auth_type = 'claude-code-oauth';
    mockedLoadConfig.mockResolvedValue(oauthConfig);

    await compile('Build a TypeScript CLI');

    // concurrency argument (3rd positional) should be 2
    expect(mockedExecutePlan.mock.calls[0][2]).toBe(2);
  });

  it('uses concurrency 3 for api-key auth type', async () => {
    await compile('Build a TypeScript CLI');

    // concurrency argument (3rd positional) should be 3
    expect(mockedExecutePlan.mock.calls[0][2]).toBe(3);
  });

  it('produces empty intent_patterns (intent routing removed in v2.12)', async () => {
    const spec = await compile('Build a TypeScript CLI');

    expect(spec.harness.intent_patterns).toEqual([]);
  });

  it('produces empty intent_prompt_template (intent routing removed in v2.12)', async () => {
    const spec = await compile('Build a TypeScript CLI');

    expect(spec.harness.intent_prompt_template).toBe('');
  });

  it('produces empty hooks (no intent-router/intent-learner)', async () => {
    const spec = await compile('Build a TypeScript CLI');

    expect(spec.harness.hooks).toEqual({});
  });

  it('includes Available Commands section in claude_md', async () => {
    const spec = await compile('Build a TypeScript CLI');

    // The IR has commands 'help' and 'build', so CLAUDE.md should include them
    expect(spec.harness.claude_md).toContain('## Available Commands');
    expect(spec.harness.claude_md).toContain('/project:help');
    expect(spec.harness.claude_md).toContain('/project:build');
  });

  it('does not include Environment Variables section when no tools have env_vars', async () => {
    const spec = await compile('Build a TypeScript CLI');

    // The default mock registry tool (context7) has no env_vars
    expect(spec.harness.claude_md).not.toContain('## Environment Variables');
  });
});

// ---------------------------------------------------------------------------
// buildSettings — .env deny + doc-update hook
// ---------------------------------------------------------------------------

describe('buildSettings()', () => {
  it('includes Read(./.env) in deny when no tools use env vars', () => {
    const skeleton = makeSkeleton();
    const registry = [
      {
        id: 'context7',
        name: 'Context7',
        description: 'Docs',
        category: 'docs',
        tier: 1,
        type: 'mcp_server' as const,
        auth: 'none' as const,
        best_for: ['docs'],
        install: {},
      },
    ];

    const result = buildSettings(skeleton, registry);
    const deny = (result.permissions as Record<string, string[]>).deny;
    expect(deny).toContain('Read(./.env)');
  });

  it('omits Read(./.env) from deny when tools use api_key auth', () => {
    const skeleton = makeSkeleton();
    skeleton.tools = [{ tool_id: 'semgrep', reason: 'static analysis' }];
    const registry = [
      {
        id: 'semgrep',
        name: 'Semgrep',
        description: 'Static analysis',
        category: 'code-quality',
        tier: 2,
        type: 'mcp_server' as const,
        auth: 'api_key' as const,
        best_for: ['coding'],
        env_vars: [{ name: 'SEMGREP_APP_TOKEN', description: 'Semgrep app token' }],
        install: {},
      },
    ];

    const result = buildSettings(skeleton, registry);
    const deny = (result.permissions as Record<string, string[]>).deny;
    expect(deny).not.toContain('Read(./.env)');
  });

  it('omits Read(./.env) from deny when tools have env_vars', () => {
    const skeleton = makeSkeleton();
    skeleton.tools = [{ tool_id: 'github', reason: 'GitHub access' }];
    const registry = [
      {
        id: 'github',
        name: 'GitHub',
        description: 'GitHub integration',
        category: 'scm',
        tier: 1,
        type: 'mcp_server' as const,
        auth: 'none' as const,
        best_for: ['coding'],
        env_vars: [{ name: 'GITHUB_TOKEN', description: 'Personal access token' }],
        install: {},
      },
    ];

    const result = buildSettings(skeleton, registry);
    const deny = (result.permissions as Record<string, string[]>).deny;
    expect(deny).not.toContain('Read(./.env)');
  });

  it('always includes core deny rules regardless of env var usage', () => {
    const skeleton = makeSkeleton();
    const registry = [
      {
        id: 'context7',
        name: 'Context7',
        description: 'Docs',
        category: 'docs',
        tier: 1,
        type: 'mcp_server' as const,
        auth: 'none' as const,
        best_for: ['docs'],
        install: {},
      },
    ];

    const result = buildSettings(skeleton, registry);
    const deny = (result.permissions as Record<string, string[]>).deny;
    expect(deny).toContain('Bash(rm -rf *)');
    expect(deny).toContain('Bash(curl * | sh)');
    expect(deny).toContain('Bash(wget * | sh)');
    expect(deny).toContain('Read(./secrets/**)');
  });

  it('includes PostToolUse doc-update prompt hook', () => {
    const skeleton = makeSkeleton();
    const registry = [
      {
        id: 'context7',
        name: 'Context7',
        description: 'Docs',
        category: 'docs',
        tier: 1,
        type: 'mcp_server' as const,
        auth: 'none' as const,
        best_for: ['docs'],
        install: {},
      },
    ];

    const result = buildSettings(skeleton, registry);
    const hooks = result.hooks as Record<string, unknown[]>;
    const postToolUse = hooks.PostToolUse as Array<{ matcher: string; hooks: Array<{ type: string; prompt?: string }> }>;
    expect(postToolUse).toBeDefined();

    // Find the doc-update prompt hook
    const docUpdateHook = postToolUse.find(
      (h) => h.matcher === 'Write|Edit' && h.hooks.some((hk) => hk.type === 'prompt' && hk.prompt?.includes('.claude/docs/'))
    );
    expect(docUpdateHook).toBeDefined();
    expect(docUpdateHook!.hooks[0].prompt).toContain('architectural decision');
    expect(docUpdateHook!.hooks[0].prompt).toContain("don't add noise");
  });
});

describe('generateClarifications()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLoadConfig.mockResolvedValue(makeConfig());
  });

  it('still works unchanged', async () => {
    mockedCallLLM.mockResolvedValue('[{"question":"Language?","suggestion":"TypeScript"}]');

    const clarifications = await generateClarifications('Build a CLI');

    expect(clarifications).toHaveLength(1);
    expect(clarifications[0].question).toBe('Language?');
  });

  it('returns empty array on parse failure', async () => {
    mockedCallLLM.mockResolvedValue('not json');

    const clarifications = await generateClarifications('Build a CLI');

    expect(clarifications).toEqual([]);
  });
});
