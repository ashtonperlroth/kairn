import { describe, it, expect } from 'vitest';
import type { HarnessIR } from '../../ir/types.js';
import {
  createEmptyIR,
  createSection,
  createCommandNode,
  createRuleNode,
  createAgentNode,
} from '../../ir/types.js';

// ─── Helper: build a fully populated mock IR ────────────────────────────────

function makeFullIR(): HarnessIR {
  return {
    meta: {
      name: 'kairn',
      purpose: 'Agent environment compiler',
      techStack: {
        language: 'TypeScript',
        framework: 'Commander.js',
        buildTool: 'tsup',
        testRunner: 'vitest',
        packageManager: 'npm',
      },
      autonomyLevel: 2,
    },
    sections: [
      createSection('purpose', 'Purpose', 'Build agent envs', 0),
      createSection('tech-stack', 'Tech Stack', 'TypeScript, tsup, vitest', 1),
      createSection('architecture', 'Architecture', 'src/ layout', 2),
      createSection('commands', 'Commands', 'build, test, dev', 3),
      createSection('conventions', 'Conventions', 'async/await, chalk', 4),
      createSection('verification', 'Verification', 'npm run build', 5),
    ],
    commands: [
      createCommandNode('build', 'npm run build', 'Build the project'),
      createCommandNode('test', 'npm test', 'Run tests'),
      createCommandNode('develop', 'npm run dev', 'Start dev mode'),
      createCommandNode('sprint', 'Define acceptance criteria', 'Sprint planning'),
    ],
    rules: [
      { name: 'security', paths: ['**/*'], content: 'Security rules' },
      { name: 'docker-practices', paths: ['Dockerfile*'], content: 'Docker rules' },
    ],
    agents: [
      createAgentNode('architect', 'Plan architecture', 'claude-opus-4-6'),
      createAgentNode('implementer', 'Write code', 'claude-sonnet-4-6'),
      createAgentNode('reviewer', 'Review code'),
    ],
    skills: [
      { name: 'debugging', content: 'How to debug' },
    ],
    docs: [
      { name: 'api-guide', content: 'API documentation' },
    ],
    hooks: [
      { name: 'pre-commit', content: 'lint check', type: 'command' },
      { name: 'prompt-guard', content: 'safety check', type: 'prompt' },
    ],
    settings: {
      statusLine: { command: 'git status --short' },
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo check' }],
          },
        ],
        PostToolUse: [
          {
            matcher: 'Write',
            hooks: [{ type: 'command', command: 'echo done' }],
          },
        ],
        SessionStart: [
          {
            matcher: '',
            hooks: [{ type: 'prompt', prompt: 'Read CLAUDE.md' }],
          },
        ],
      },
      denyPatterns: ['rm -rf', 'curl|sh', 'wget|sh', '.env', 'no-secret-logging'],
      raw: { customSetting: true },
    },
    mcpServers: [
      { id: 'context7', command: 'npx', args: ['-y', '@context7/mcp'] },
      { id: 'sequential-thinking', command: 'npx', args: ['-y', '@sequential/mcp'], env: { KEY: 'val' } },
    ],
    intents: [
      { commandName: 'build', patterns: ['build*', 'compile*'], priority: 1 },
    ],
  };
}

// ─── buildIRSummary ─────────────────────────────────────────────────────────

describe('buildIRSummary', () => {
  it('returns a string containing all major IR categories for a full IR', async () => {
    const { buildIRSummary } = await import('../proposer.js');
    const ir = makeFullIR();

    const summary = buildIRSummary(ir);

    // Must contain the header
    expect(summary).toContain('Harness Structure (IR)');

    // Must list sections with count and names
    expect(summary).toContain('Sections (6)');
    expect(summary).toContain('purpose');
    expect(summary).toContain('verification');

    // Must list commands with count and names
    expect(summary).toContain('Commands (4)');
    expect(summary).toContain('build');
    expect(summary).toContain('test');
    expect(summary).toContain('develop');
    expect(summary).toContain('sprint');

    // Must list rules with count, names, and glob patterns
    expect(summary).toContain('Rules (2)');
    expect(summary).toContain('security');
    expect(summary).toContain('**/*');
    expect(summary).toContain('docker-practices');
    expect(summary).toContain('Dockerfile*');

    // Must list agents with count and names
    expect(summary).toContain('Agents (3)');
    expect(summary).toContain('architect');
    expect(summary).toContain('implementer');
    expect(summary).toContain('reviewer');

    // Must list MCP servers with count and names
    expect(summary).toContain('MCP Servers (2)');
    expect(summary).toContain('context7');
    expect(summary).toContain('sequential-thinking');

    // Must include settings summary
    expect(summary).toContain('Settings');
    expect(summary).toContain('statusLine');
    expect(summary).toContain('denyPatterns');
  });

  it('includes skills count when skills are present', async () => {
    const { buildIRSummary } = await import('../proposer.js');
    const ir = makeFullIR();

    const summary = buildIRSummary(ir);

    expect(summary).toContain('Skills (1)');
    expect(summary).toContain('debugging');
  });

  it('includes docs count when docs are present', async () => {
    const { buildIRSummary } = await import('../proposer.js');
    const ir = makeFullIR();

    const summary = buildIRSummary(ir);

    expect(summary).toContain('Docs (1)');
    expect(summary).toContain('api-guide');
  });

  it('includes hooks count when hooks are present', async () => {
    const { buildIRSummary } = await import('../proposer.js');
    const ir = makeFullIR();

    const summary = buildIRSummary(ir);

    expect(summary).toContain('Hooks (2)');
    expect(summary).toContain('pre-commit');
    expect(summary).toContain('prompt-guard');
  });

  it('handles a minimal/empty IR gracefully', async () => {
    const { buildIRSummary } = await import('../proposer.js');
    const ir = createEmptyIR();

    const summary = buildIRSummary(ir);

    // Should still have the header
    expect(summary).toContain('Harness Structure (IR)');

    // Should show zero counts or "none"
    expect(summary).toContain('Sections (0)');
    expect(summary).toContain('Commands (0)');
    expect(summary).toContain('Rules (0)');
    expect(summary).toContain('Agents (0)');
    expect(summary).toContain('MCP Servers (0)');

    // Should not crash, should be a valid string
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
  });

  it('omits optional categories when they are empty', async () => {
    const { buildIRSummary } = await import('../proposer.js');
    const ir = createEmptyIR();

    const summary = buildIRSummary(ir);

    // Skills, Docs, Hooks should not appear when empty
    expect(summary).not.toContain('Skills');
    expect(summary).not.toContain('Docs');
    expect(summary).not.toContain('Hooks');
  });

  it('produces output under 2000 characters', async () => {
    const { buildIRSummary } = await import('../proposer.js');
    const ir = makeFullIR();

    const summary = buildIRSummary(ir);

    expect(summary.length).toBeLessThan(2000);
  });

  it('includes meta information (name, language, framework)', async () => {
    const { buildIRSummary } = await import('../proposer.js');
    const ir = makeFullIR();

    const summary = buildIRSummary(ir);

    expect(summary).toContain('kairn');
    expect(summary).toContain('TypeScript');
  });

  it('handles rules without paths gracefully', async () => {
    const { buildIRSummary } = await import('../proposer.js');
    const ir = createEmptyIR();
    ir.rules = [
      { name: 'general', content: 'General rules' },
    ];

    const summary = buildIRSummary(ir);

    expect(summary).toContain('Rules (1)');
    expect(summary).toContain('general');
    // Should not crash even without paths
  });

  it('handles settings with no statusLine or denyPatterns', async () => {
    const { buildIRSummary } = await import('../proposer.js');
    const ir = createEmptyIR();
    // createEmptyIR() has empty hooks and no statusLine/denyPatterns

    const summary = buildIRSummary(ir);

    expect(summary).toContain('Settings');
    // Should not crash
    expect(typeof summary).toBe('string');
  });

  it('includes hooks count in settings line', async () => {
    const { buildIRSummary } = await import('../proposer.js');
    const ir = makeFullIR();

    const summary = buildIRSummary(ir);

    // Settings line should mention hooks count
    expect(summary).toMatch(/hooks=3/);
  });

  it('includes deny patterns count in settings line', async () => {
    const { buildIRSummary } = await import('../proposer.js');
    const ir = makeFullIR();

    const summary = buildIRSummary(ir);

    expect(summary).toMatch(/denyPatterns=5/);
  });

  it('is a pure function (same input produces same output)', async () => {
    const { buildIRSummary } = await import('../proposer.js');
    const ir = makeFullIR();

    const summary1 = buildIRSummary(ir);
    const summary2 = buildIRSummary(ir);

    expect(summary1).toBe(summary2);
  });
});
