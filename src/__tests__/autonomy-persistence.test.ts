import { describe, it, expect } from 'vitest';
import { applyAutonomyLevel } from '../autonomy.js';
import type { EnvironmentSpec, AutonomyLevel } from '../types.js';

function makeSpec(level: AutonomyLevel, overrides?: Partial<EnvironmentSpec['harness']>): EnvironmentSpec {
  return {
    id: 'env_test-123',
    name: 'test-project',
    description: 'Test project',
    intent: 'Build a test project',
    created_at: '2026-04-01T00:00:00.000Z',
    autonomy_level: level,
    tools: [],
    harness: {
      claude_md: '# Test\n## Purpose\nTest project\n## Tech Stack\n- TypeScript\n- Node.js',
      settings: {},
      mcp_config: {},
      commands: { status: '# Status\nShow status.' },
      rules: { security: '# Security\nDo not leak secrets.' },
      skills: {},
      agents: {},
      docs: {},
      hooks: {},
      intent_patterns: [],
      intent_prompt_template: '',
      ...overrides,
    },
  };
}

describe('applyAutonomyLevel — persistence_routing', () => {
  it('sets persistence_routing to "manual" for level 1', () => {
    const spec = makeSpec(1);
    applyAutonomyLevel(spec);
    const settings = spec.harness.settings as Record<string, unknown>;
    expect(settings.persistence_routing).toBe('manual');
  });

  it('sets persistence_routing to "manual" for level 2', () => {
    const spec = makeSpec(2);
    applyAutonomyLevel(spec);
    const settings = spec.harness.settings as Record<string, unknown>;
    expect(settings.persistence_routing).toBe('manual');
  });

  it('sets persistence_routing to "auto" for level 3', () => {
    const spec = makeSpec(3);
    applyAutonomyLevel(spec);
    const settings = spec.harness.settings as Record<string, unknown>;
    expect(settings.persistence_routing).toBe('auto');
  });

  it('sets persistence_routing to "auto" for level 4', () => {
    const spec = makeSpec(4);
    applyAutonomyLevel(spec);
    const settings = spec.harness.settings as Record<string, unknown>;
    expect(settings.persistence_routing).toBe('auto');
  });

  it('does not overwrite existing persistence_routing if already set', () => {
    const spec = makeSpec(3, {
      settings: { persistence_routing: 'off' },
    });
    applyAutonomyLevel(spec);
    const settings = spec.harness.settings as Record<string, unknown>;
    // Should preserve the explicit 'off' value
    expect(settings.persistence_routing).toBe('off');
  });

  it('persistence_routing coexists with other settings fields', () => {
    const spec = makeSpec(2, {
      settings: { statusLine: { command: 'echo test' } },
    });
    applyAutonomyLevel(spec);
    const settings = spec.harness.settings as Record<string, unknown>;
    expect(settings.persistence_routing).toBe('manual');
    expect(settings.statusLine).toEqual({ command: 'echo test' });
  });

  it('persistence_routing coexists with hooks in settings', () => {
    const spec = makeSpec(3);
    applyAutonomyLevel(spec);
    const settings = spec.harness.settings as Record<string, unknown>;
    expect(settings.persistence_routing).toBe('auto');
    // Level 3 adds SessionStart hooks — verify they still exist
    expect(settings.hooks).toBeDefined();
  });
});
