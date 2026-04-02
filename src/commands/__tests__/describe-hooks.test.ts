import { describe, it, expect } from 'vitest';
import { buildFileMap, summarizeSpec } from '../../adapter/claude-code.js';
import type { EnvironmentSpec, RegistryTool } from '../../types.js';
import { createEmptyIR, createCommandNode, createRuleNode, createAgentNode } from '../../ir/types.js';
import type { HarnessIR } from '../../ir/types.js';

function makeSpec(overrides?: Partial<EnvironmentSpec>): EnvironmentSpec {
  return {
    id: 'env_test-123',
    name: 'test-project',
    description: 'Test project',
    intent: 'Build a test project',
    created_at: '2026-04-01T00:00:00.000Z',
    autonomy_level: 1,
    tools: [],
    harness: {
      claude_md: '# Test\n## Purpose\nTest project',
      settings: {},
      mcp_config: {},
      commands: { deploy: '# Deploy\nDeploy to production.' },
      rules: { security: '# Security\nDo not leak secrets.' },
      skills: {},
      agents: { debugger: '# Debugger\nRoot-cause analysis.' },
      docs: {},
      hooks: {
        'intent-router': '// router script content',
        'intent-learner': '// learner script content',
      },
      intent_patterns: [
        {
          pattern: '\\b(deploy|ship)\\b',
          command: '/project:deploy',
          description: 'Deploy to production',
          source: 'generated',
        },
      ],
      intent_prompt_template: 'You are an intent classifier...',
    },
    ...overrides,
  };
}

describe('buildFileMap with hooks', () => {
  it('includes intent-router.mjs in file map', () => {
    const spec = makeSpec();
    const files = buildFileMap(spec);
    expect(files.has('.claude/hooks/intent-router.mjs')).toBe(true);
    expect(files.get('.claude/hooks/intent-router.mjs')).toBe('// router script content');
  });

  it('includes intent-learner.mjs in file map', () => {
    const spec = makeSpec();
    const files = buildFileMap(spec);
    expect(files.has('.claude/hooks/intent-learner.mjs')).toBe(true);
    expect(files.get('.claude/hooks/intent-learner.mjs')).toBe('// learner script content');
  });

  it('settings.json contains UserPromptSubmit hooks', () => {
    const spec = makeSpec();
    const files = buildFileMap(spec);
    const settingsJson = files.get('.claude/settings.json');
    expect(settingsJson).toBeDefined();
    const settings = JSON.parse(settingsJson!);
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.UserPromptSubmit).toBeDefined();
    expect(settings.hooks.UserPromptSubmit.length).toBeGreaterThan(0);
  });

  it('UserPromptSubmit has Tier 1 command hook', () => {
    const spec = makeSpec();
    const files = buildFileMap(spec);
    const settings = JSON.parse(files.get('.claude/settings.json')!);
    const upsHooks = settings.hooks.UserPromptSubmit;
    const tier1 = upsHooks.find((h: any) =>
      h.hooks?.some((hh: any) => hh.type === 'command' && hh.command?.includes('intent-router.mjs'))
    );
    expect(tier1).toBeDefined();
  });

  it('UserPromptSubmit has Tier 2 prompt hook', () => {
    const spec = makeSpec();
    const files = buildFileMap(spec);
    const settings = JSON.parse(files.get('.claude/settings.json')!);
    const upsHooks = settings.hooks.UserPromptSubmit;
    const tier2 = upsHooks.find((h: any) =>
      h.hooks?.some((hh: any) => hh.type === 'prompt')
    );
    expect(tier2).toBeDefined();
  });

  it('SessionStart includes intent-learner hook', () => {
    const spec = makeSpec();
    const files = buildFileMap(spec);
    const settings = JSON.parse(files.get('.claude/settings.json')!);
    const sessionStart = settings.hooks?.SessionStart;
    expect(sessionStart).toBeDefined();
    const learnerHook = sessionStart?.find((h: any) =>
      h.hooks?.some((hh: any) => hh.command?.includes('intent-learner.mjs'))
    );
    expect(learnerHook).toBeDefined();
  });

  it('hook paths use $CLAUDE_PROJECT_DIR', () => {
    const spec = makeSpec();
    const files = buildFileMap(spec);
    const settings = JSON.parse(files.get('.claude/settings.json')!);
    const upsHooks = settings.hooks.UserPromptSubmit;
    const tier1 = upsHooks.find((h: any) =>
      h.hooks?.some((hh: any) => hh.command?.includes('$CLAUDE_PROJECT_DIR'))
    );
    expect(tier1).toBeDefined();
  });

  it('preserves existing settings (statusLine, env loader)', () => {
    const spec = makeSpec({
      harness: {
        ...makeSpec().harness,
        settings: { statusLine: { command: 'echo test' } },
        commands: { status: '# Status\nShow status.' },
      },
    });
    const files = buildFileMap(spec, { hasEnvVars: true });
    const settings = JSON.parse(files.get('.claude/settings.json')!);
    expect(settings.statusLine).toBeDefined();
    // Should also have env loader hook in SessionStart
    const sessionStart = settings.hooks?.SessionStart;
    expect(sessionStart?.length).toBeGreaterThanOrEqual(2); // env loader + intent learner
  });

  it('handles spec with no hooks gracefully', () => {
    const spec = makeSpec();
    spec.harness.hooks = {};
    spec.harness.intent_patterns = [];
    spec.harness.intent_prompt_template = '';
    const files = buildFileMap(spec);
    // Should not write empty hook files
    expect(files.has('.claude/hooks/intent-router.mjs')).toBe(false);
  });

  it('includes intent-log.jsonl placeholder', () => {
    const spec = makeSpec();
    const files = buildFileMap(spec);
    expect(files.has('.claude/hooks/intent-log.jsonl')).toBe(true);
    expect(files.get('.claude/hooks/intent-log.jsonl')).toBe('');
  });
});

/**
 * Construct a minimal HarnessIR matching the flat harness fields in makeSpec().
 * Uses 1 command, 1 rule, 1 agent — same as the default spec.
 */
function makeIR(): HarnessIR {
  const ir = createEmptyIR();
  ir.commands.push(createCommandNode('deploy', '# Deploy\nDeploy to production.', 'Deploy'));
  ir.rules.push(createRuleNode('security', '# Security\nDo not leak secrets.'));
  ir.agents.push(createAgentNode('debugger', '# Debugger\nRoot-cause analysis.'));
  return ir;
}

/** Empty registry — summarizeSpec needs it but our tests don't depend on tool details. */
const emptyRegistry: RegistryTool[] = [];

describe('buildFileMap with ir field', () => {
  it('produces identical file map for spec with ir and spec without ir', () => {
    const specWithoutIR = makeSpec();
    const specWithIR = makeSpec({ ir: makeIR() });

    const mapWithout = buildFileMap(specWithoutIR);
    const mapWith = buildFileMap(specWithIR);

    // Both should have the same set of keys
    const keysWithout = [...mapWithout.keys()].sort();
    const keysWith = [...mapWith.keys()].sort();
    expect(keysWith).toEqual(keysWithout);

    // Both should have the same content for each key
    for (const key of keysWithout) {
      expect(mapWith.get(key)).toBe(mapWithout.get(key));
    }
  });

  it('works correctly with a legacy spec that has no ir field', () => {
    const legacySpec = makeSpec();
    // Explicitly ensure no ir field
    delete (legacySpec as Partial<Pick<EnvironmentSpec, 'ir'>> & Omit<EnvironmentSpec, 'ir'>).ir;

    const files = buildFileMap(legacySpec);
    expect(files.has('.claude/CLAUDE.md')).toBe(true);
    expect(files.has('.claude/commands/deploy.md')).toBe(true);
    expect(files.has('.claude/rules/security.md')).toBe(true);
    expect(files.has('.claude/agents/debugger.md')).toBe(true);
  });
});

describe('summarizeSpec with HarnessIR', () => {
  it('uses ir counts when ir field is present', () => {
    const ir = makeIR();
    // Add extra items to IR that differ from flat harness to prove IR is preferred
    ir.commands.push(createCommandNode('test', '# Test\nRun tests.', 'Test'));
    ir.rules.push(createRuleNode('naming', '# Naming\nUse camelCase.'));

    const spec = makeSpec({ ir });
    // Flat harness has: 1 command, 1 rule, 1 agent, 0 skills
    // IR has: 2 commands, 2 rules, 1 agent, 0 skills
    const summary = summarizeSpec(spec, emptyRegistry);

    expect(summary.commandCount).toBe(2); // From IR, not flat harness (which has 1)
    expect(summary.ruleCount).toBe(2);    // From IR, not flat harness (which has 1)
    expect(summary.agentCount).toBe(1);
    expect(summary.skillCount).toBe(0);
    expect(summary.toolCount).toBe(0);
  });

  it('falls back to harness flat field counts when ir is absent', () => {
    const spec = makeSpec();
    // Flat harness has: 1 command, 1 rule, 1 agent, 0 skills
    const summary = summarizeSpec(spec, emptyRegistry);

    expect(summary.commandCount).toBe(1);
    expect(summary.ruleCount).toBe(1);
    expect(summary.agentCount).toBe(1);
    expect(summary.skillCount).toBe(0);
    expect(summary.toolCount).toBe(0);
  });

  it('returns correct tool count from spec.tools regardless of ir presence', () => {
    const specWithTools = makeSpec({
      tools: [
        { tool_id: 'github', reason: 'Version control' },
        { tool_id: 'linear', reason: 'Issue tracking' },
      ],
      ir: makeIR(),
    });
    const summary = summarizeSpec(specWithTools, emptyRegistry);
    expect(summary.toolCount).toBe(2);
  });

  it('returns pluginCommands and envSetup from registry lookup', () => {
    const registry: RegistryTool[] = [{
      id: 'test-tool',
      name: 'Test Tool',
      description: 'A test tool',
      category: 'testing',
      tier: 1,
      type: 'plugin',
      auth: 'api_key',
      best_for: ['testing'],
      env_vars: [{ name: 'TEST_KEY', description: 'API key for testing' }],
      signup_url: 'https://example.com',
      install: { plugin_command: 'npm install test-tool' },
    }];

    const spec = makeSpec({
      tools: [{ tool_id: 'test-tool', reason: 'For testing' }],
      ir: makeIR(),
    });
    const summary = summarizeSpec(spec, registry);

    expect(summary.pluginCommands).toEqual(['npm install test-tool']);
    expect(summary.envSetup).toHaveLength(1);
    expect(summary.envSetup[0].envVar).toBe('TEST_KEY');
  });
});
