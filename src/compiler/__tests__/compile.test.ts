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

vi.mock('../../intent/patterns.js', () => ({
  generateIntentPatterns: vi.fn(() => []),
}));

vi.mock('../../intent/prompt-template.js', () => ({
  compileIntentPrompt: vi.fn(() => ''),
}));

vi.mock('../../intent/router-template.js', () => ({
  renderIntentRouter: vi.fn(() => ''),
}));

vi.mock('../../intent/learner-template.js', () => ({
  renderIntentLearner: vi.fn(() => ''),
}));

vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks (vi.mock is hoisted above imports)
// ---------------------------------------------------------------------------

import { compile, generateClarifications } from '../compile.js';
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
