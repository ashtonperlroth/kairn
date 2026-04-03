/**
 * Tests for buildSettings() — tech-stack-aware permissions and formatter hooks.
 *
 * Validates that the generated settings.json permissions and hooks
 * vary correctly based on the skeleton's tech_stack field.
 */
import { describe, it, expect } from 'vitest';
import type { SkeletonSpec, RegistryTool } from '../../types.js';
import { buildSettings } from '../compile.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkeleton(techStack: string[]): SkeletonSpec {
  return {
    name: 'test-project',
    description: 'A test project',
    tools: [],
    outline: {
      tech_stack: techStack,
      workflow_type: 'code',
      key_commands: ['build', 'test'],
      custom_rules: [],
      custom_agents: [],
      custom_skills: [],
    },
  };
}

const emptyRegistry: RegistryTool[] = [];

// Helper to extract permissions from settings
function getPermissions(settings: Record<string, unknown>): { allow: string[]; deny: string[] } {
  const perms = settings.permissions as { allow: string[]; deny: string[] };
  return perms;
}

// Helper to extract hooks from settings
function getHooks(settings: Record<string, unknown>): Record<string, unknown[]> {
  return settings.hooks as Record<string, unknown[]>;
}

// ---------------------------------------------------------------------------
// Tests: Permission derivation from tech stack
// ---------------------------------------------------------------------------

describe('buildSettings() — tech-stack-aware permissions', () => {
  it('always includes Read, Write, Edit in allow list', () => {
    const settings = buildSettings(makeSkeleton(['Python']), emptyRegistry);
    const { allow } = getPermissions(settings);

    expect(allow).toContain('Read');
    expect(allow).toContain('Write');
    expect(allow).toContain('Edit');
  });

  it('adds Python permissions for Python tech stack', () => {
    const settings = buildSettings(makeSkeleton(['Python', 'FastAPI']), emptyRegistry);
    const { allow } = getPermissions(settings);

    expect(allow).toContain('Bash(python *)');
    expect(allow).toContain('Bash(pip *)');
    expect(allow).toContain('Bash(pytest *)');
    expect(allow).toContain('Bash(uv *)');
    // Should NOT include Node.js permissions
    expect(allow).not.toContain('Bash(npm run *)');
    expect(allow).not.toContain('Bash(npx *)');
  });

  it('adds Node.js permissions for TypeScript tech stack', () => {
    const settings = buildSettings(makeSkeleton(['TypeScript', 'Node.js']), emptyRegistry);
    const { allow } = getPermissions(settings);

    expect(allow).toContain('Bash(npm run *)');
    expect(allow).toContain('Bash(npx *)');
    // Should NOT include Python permissions
    expect(allow).not.toContain('Bash(python *)');
    expect(allow).not.toContain('Bash(pip *)');
  });

  it('adds Node.js permissions for JavaScript tech stack', () => {
    const settings = buildSettings(makeSkeleton(['JavaScript', 'React']), emptyRegistry);
    const { allow } = getPermissions(settings);

    expect(allow).toContain('Bash(npm run *)');
    expect(allow).toContain('Bash(npx *)');
  });

  it('adds Rust permissions for Rust tech stack', () => {
    const settings = buildSettings(makeSkeleton(['Rust', 'Actix']), emptyRegistry);
    const { allow } = getPermissions(settings);

    expect(allow).toContain('Bash(cargo *)');
    expect(allow).not.toContain('Bash(npm run *)');
  });

  it('adds Go permissions for Go tech stack', () => {
    const settings = buildSettings(makeSkeleton(['Go', 'Gin']), emptyRegistry);
    const { allow } = getPermissions(settings);

    expect(allow).toContain('Bash(go *)');
    expect(allow).not.toContain('Bash(npm run *)');
  });

  it('adds Go permissions for Golang tech stack', () => {
    const settings = buildSettings(makeSkeleton(['Golang']), emptyRegistry);
    const { allow } = getPermissions(settings);

    expect(allow).toContain('Bash(go *)');
  });

  it('adds Ruby permissions for Ruby tech stack', () => {
    const settings = buildSettings(makeSkeleton(['Ruby', 'Rails']), emptyRegistry);
    const { allow } = getPermissions(settings);

    expect(allow).toContain('Bash(bundle *)');
    expect(allow).toContain('Bash(rake *)');
    expect(allow).not.toContain('Bash(npm run *)');
  });

  it('adds Docker permissions for Docker tech stack', () => {
    const settings = buildSettings(makeSkeleton(['Python', 'Docker']), emptyRegistry);
    const { allow } = getPermissions(settings);

    expect(allow).toContain('Bash(docker *)');
    expect(allow).toContain('Bash(docker compose *)');
    // Also should have Python permissions
    expect(allow).toContain('Bash(python *)');
  });

  it('combines permissions for multi-language projects', () => {
    const settings = buildSettings(
      makeSkeleton(['TypeScript', 'Python', 'Docker']),
      emptyRegistry,
    );
    const { allow } = getPermissions(settings);

    expect(allow).toContain('Bash(npm run *)');
    expect(allow).toContain('Bash(npx *)');
    expect(allow).toContain('Bash(python *)');
    expect(allow).toContain('Bash(pip *)');
    expect(allow).toContain('Bash(docker *)');
    expect(allow).toContain('Bash(docker compose *)');
  });

  it('falls back to npm/npx when no language-specific stack is recognized', () => {
    const settings = buildSettings(makeSkeleton(['COBOL', 'Mainframe']), emptyRegistry);
    const { allow } = getPermissions(settings);

    // Fallback should add npm/npx
    expect(allow).toContain('Bash(npm run *)');
    expect(allow).toContain('Bash(npx *)');
  });

  it('does not trigger fallback when at least one language matched', () => {
    const settings = buildSettings(makeSkeleton(['Rust']), emptyRegistry);
    const { allow } = getPermissions(settings);

    expect(allow).toContain('Bash(cargo *)');
    // Should NOT have fallback npm/npx since Rust matched
    expect(allow).not.toContain('Bash(npm run *)');
    expect(allow).not.toContain('Bash(npx *)');
  });

  it('is case-insensitive for tech stack matching', () => {
    const settings = buildSettings(makeSkeleton(['PYTHON', 'typescript']), emptyRegistry);
    const { allow } = getPermissions(settings);

    expect(allow).toContain('Bash(python *)');
    expect(allow).toContain('Bash(npm run *)');
  });

  it('always includes standard deny rules', () => {
    const settings = buildSettings(makeSkeleton(['Python']), emptyRegistry);
    const { deny } = getPermissions(settings);

    expect(deny).toContain('Bash(rm -rf *)');
    expect(deny).toContain('Bash(curl * | sh)');
    expect(deny).toContain('Bash(wget * | sh)');
    expect(deny).toContain('Read(./.env)');
    expect(deny).toContain('Read(./secrets/**)');
  });
});

// ---------------------------------------------------------------------------
// Tests: Hooks
// ---------------------------------------------------------------------------

describe('buildSettings() — hooks', () => {
  it('always includes PreToolUse destructive command blocker', () => {
    const settings = buildSettings(makeSkeleton(['Python']), emptyRegistry);
    const hooks = getHooks(settings);

    expect(hooks.PreToolUse).toBeDefined();
    expect(hooks.PreToolUse).toHaveLength(1);
    const hook = hooks.PreToolUse[0] as Record<string, unknown>;
    expect(hook.matcher).toBe('Bash');
  });

  it('always includes PostCompact context restore hook', () => {
    const settings = buildSettings(makeSkeleton(['Python']), emptyRegistry);
    const hooks = getHooks(settings);

    expect(hooks.PostCompact).toBeDefined();
    expect(hooks.PostCompact).toHaveLength(1);
  });

  it('adds prettier PostToolUse hook for TypeScript projects', () => {
    const settings = buildSettings(makeSkeleton(['TypeScript', 'React']), emptyRegistry);
    const hooks = getHooks(settings);

    expect(hooks.PostToolUse).toBeDefined();
    const prettierHook = (hooks.PostToolUse as Array<Record<string, unknown>>).find(
      (h) => {
        const innerHooks = h.hooks as Array<Record<string, string>>;
        return innerHooks?.some((ih) => ih.command?.includes('prettier'));
      },
    );
    expect(prettierHook).toBeDefined();
  });

  it('adds ruff formatter PostToolUse hook for Python projects', () => {
    const settings = buildSettings(makeSkeleton(['Python', 'FastAPI']), emptyRegistry);
    const hooks = getHooks(settings);

    expect(hooks.PostToolUse).toBeDefined();
    const ruffHook = (hooks.PostToolUse as Array<Record<string, unknown>>).find(
      (h) => {
        const innerHooks = h.hooks as Array<Record<string, string>>;
        return innerHooks?.some((ih) => ih.command?.includes('ruff'));
      },
    );
    expect(ruffHook).toBeDefined();
  });

  it('does not add prettier hook for non-JS projects', () => {
    const settings = buildSettings(makeSkeleton(['Rust']), emptyRegistry);
    const hooks = getHooks(settings);

    // PostToolUse should either not exist or not contain prettier
    if (hooks.PostToolUse) {
      const prettierHook = (hooks.PostToolUse as Array<Record<string, unknown>>).find(
        (h) => {
          const innerHooks = h.hooks as Array<Record<string, string>>;
          return innerHooks?.some((ih) => ih.command?.includes('prettier'));
        },
      );
      expect(prettierHook).toBeUndefined();
    }
  });

  it('does not add ruff hook for non-Python projects', () => {
    const settings = buildSettings(makeSkeleton(['TypeScript']), emptyRegistry);
    const hooks = getHooks(settings);

    if (hooks.PostToolUse) {
      const ruffHook = (hooks.PostToolUse as Array<Record<string, unknown>>).find(
        (h) => {
          const innerHooks = h.hooks as Array<Record<string, string>>;
          return innerHooks?.some((ih) => ih.command?.includes('ruff'));
        },
      );
      expect(ruffHook).toBeUndefined();
    }
  });

  it('includes both prettier and ruff hooks for TS+Python projects', () => {
    const settings = buildSettings(
      makeSkeleton(['TypeScript', 'Python']),
      emptyRegistry,
    );
    const hooks = getHooks(settings);

    expect(hooks.PostToolUse).toBeDefined();
    const postToolUse = hooks.PostToolUse as Array<Record<string, unknown>>;

    const prettierHook = postToolUse.find((h) => {
      const innerHooks = h.hooks as Array<Record<string, string>>;
      return innerHooks?.some((ih) => ih.command?.includes('prettier'));
    });
    const ruffHook = postToolUse.find((h) => {
      const innerHooks = h.hooks as Array<Record<string, string>>;
      return innerHooks?.some((ih) => ih.command?.includes('ruff'));
    });

    expect(prettierHook).toBeDefined();
    expect(ruffHook).toBeDefined();
  });

  it('ruff hook only triggers on .py files', () => {
    const settings = buildSettings(makeSkeleton(['Python']), emptyRegistry);
    const hooks = getHooks(settings);

    const postToolUse = hooks.PostToolUse as Array<Record<string, unknown>>;
    const ruffHook = postToolUse.find((h) => {
      const innerHooks = h.hooks as Array<Record<string, string>>;
      return innerHooks?.some((ih) => ih.command?.includes('ruff'));
    });

    expect(ruffHook).toBeDefined();
    const innerHooks = ruffHook!.hooks as Array<Record<string, string>>;
    const ruffCommand = innerHooks[0].command;
    expect(ruffCommand).toContain('*.py');
    expect(ruffCommand).toContain('ruff format');
  });
});
