import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  measureComplexity,
  measureComplexityFromIR,
  computeComplexityCost,
  applyKLPenalty,
  computeDiffRatio,
} from '../regularization.js';
import {
  createEmptyIR,
  createSection,
  createCommandNode,
  createRuleNode,
  createAgentNode,
} from '../../ir/types.js';
import type { HarnessIR } from '../../ir/types.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = path.join('/tmp', `kairn-reg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function createHarness(basePath: string, files: Record<string, string>): Promise<void> {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(basePath, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }
}

describe('measureComplexity', () => {
  it('counts lines, files, sections, rules, commands correctly', async () => {
    const harnessPath = path.join(tempDir, 'harness');
    await createHarness(harnessPath, {
      'CLAUDE.md': '# Title\n\n## Section 1\nContent\n\n## Section 2\nMore content\n',
      'rules/rule1.md': 'Rule 1\n',
      'rules/rule2.md': 'Rule 2\n',
      'commands/dev.md': 'Dev command\nLine 2\n',
    });

    const metrics = await measureComplexity(harnessPath);

    expect(metrics.totalFiles).toBe(4);
    expect(metrics.totalSections).toBe(2);
    expect(metrics.totalRules).toBe(2);
    expect(metrics.totalCommands).toBe(1);
    expect(metrics.totalLines).toBeGreaterThan(0);
  });

  it('handles empty harness directory', async () => {
    const harnessPath = path.join(tempDir, 'empty-harness');
    await fs.mkdir(harnessPath, { recursive: true });

    const metrics = await measureComplexity(harnessPath);

    expect(metrics.totalFiles).toBe(0);
    expect(metrics.totalLines).toBe(0);
    expect(metrics.totalSections).toBe(0);
  });

  it('handles nonexistent directory gracefully', async () => {
    const metrics = await measureComplexity(path.join(tempDir, 'does-not-exist'));

    expect(metrics.totalFiles).toBe(0);
    expect(metrics.totalLines).toBe(0);
  });
});

describe('computeComplexityCost', () => {
  it('returns 0 when current equals baseline', () => {
    const metrics = {
      totalLines: 100,
      totalFiles: 5,
      totalSections: 3,
      totalRules: 2,
      totalCommands: 1,
      diffFromBaseline: 0,
    };

    expect(computeComplexityCost(metrics, metrics)).toBe(0);
  });

  it('increases with added lines', () => {
    const baseline = {
      totalLines: 100, totalFiles: 5, totalSections: 3,
      totalRules: 2, totalCommands: 1, diffFromBaseline: 0,
    };
    const current = {
      ...baseline,
      totalLines: 150, // 50% more lines
    };

    const cost = computeComplexityCost(current, baseline);
    expect(cost).toBeGreaterThan(0);
  });

  it('increases with added files', () => {
    const baseline = {
      totalLines: 100, totalFiles: 5, totalSections: 3,
      totalRules: 2, totalCommands: 1, diffFromBaseline: 0,
    };
    const current = {
      ...baseline,
      totalFiles: 8, // 3 more files
    };

    const cost = computeComplexityCost(current, baseline);
    expect(cost).toBeGreaterThan(0);
  });

  it('returns negative cost when harness shrinks (complexity bonus)', () => {
    const baseline = {
      totalLines: 100, totalFiles: 5, totalSections: 3,
      totalRules: 2, totalCommands: 1, diffFromBaseline: 0,
    };
    const current = {
      ...baseline,
      totalLines: 70,  // removed 30 lines
      totalFiles: 3,   // removed 2 files
    };

    const cost = computeComplexityCost(current, baseline);
    expect(cost).toBeLessThan(0);
  });
});

describe('applyKLPenalty', () => {
  it('reduces score proportional to lambda * cost', () => {
    const penalized = applyKLPenalty(80, 0.5, 0.1);
    // 80 - 0.1 * 0.5 * 100 = 80 - 5 = 75
    expect(penalized).toBe(75);
  });

  it('with lambda=0 returns raw score (disabled)', () => {
    expect(applyKLPenalty(80, 999, 0)).toBe(80);
  });

  it('with zero complexity cost returns raw score', () => {
    expect(applyKLPenalty(80, 0, 0.1)).toBe(80);
  });

  it('can produce scores below zero for extreme bloat', () => {
    const penalized = applyKLPenalty(50, 2.0, 0.5);
    // 50 - 0.5 * 2.0 * 100 = 50 - 100 = -50
    expect(penalized).toBe(-50);
  });

  it('gives bonus for negative complexity cost (simplification)', () => {
    const penalized = applyKLPenalty(80, -0.2, 0.1);
    // 80 - 0.1 * (-0.2) * 100 = 80 + 2 = 82
    expect(penalized).toBe(82);
  });
});

describe('measureComplexityFromIR', () => {
  it('measures complexity from empty IR', () => {
    const ir = createEmptyIR();
    const metrics = measureComplexityFromIR(ir);

    expect(metrics.totalSections).toBe(0);
    expect(metrics.totalRules).toBe(0);
    expect(metrics.totalCommands).toBe(0);
    expect(metrics.totalFiles).toBe(0);
    expect(metrics.totalLines).toBe(0);
    expect(metrics.diffFromBaseline).toBe(0);
  });

  it('measures complexity from IR with sections, commands, and rules', () => {
    const ir = createEmptyIR();
    ir.sections = [
      createSection('purpose', '## Purpose', 'Build things\nLine 2', 0),
      createSection('conventions', '## Conventions', 'Use TypeScript\nStrict mode\nLine 3', 1),
    ];
    ir.commands = [
      createCommandNode('build', 'npm run build'),
      createCommandNode('test', 'npm test\nLine 2'),
    ];
    ir.rules = [
      createRuleNode('security', 'No dynamic code execution.'),
    ];

    const metrics = measureComplexityFromIR(ir);

    expect(metrics.totalSections).toBe(2);
    expect(metrics.totalCommands).toBe(2);
    expect(metrics.totalRules).toBe(1);
    expect(metrics.totalFiles).toBeGreaterThan(0);
    expect(metrics.totalLines).toBeGreaterThan(0);
    expect(metrics.diffFromBaseline).toBe(0);
  });

  it('counts agents, skills, docs, and hooks in totalFiles', () => {
    const ir = createEmptyIR();
    ir.agents = [createAgentNode('researcher', 'Research things.')];
    ir.skills = [{ name: 'tdd', content: 'Test-driven development.' }];
    ir.docs = [{ name: 'api', content: 'API docs.' }];
    ir.hooks = [{ name: 'pre-check', content: 'check()', type: 'command' }];

    const metrics = measureComplexityFromIR(ir);

    // 1 agent + 1 skill + 1 doc + 1 hook = 4 files
    expect(metrics.totalFiles).toBe(4);
  });

  it('counts settings and mcp servers as files when present', () => {
    const ir = createEmptyIR();
    ir.settings = {
      ...ir.settings,
      statusLine: { command: 'git status' },
    };
    ir.mcpServers = [{ id: 'test-server', command: 'npx', args: ['test'] }];

    const metrics = measureComplexityFromIR(ir);

    // 1 settings + 1 mcp = 2 files
    expect(metrics.totalFiles).toBe(2);
  });

  it('counts totalLines across all content nodes', () => {
    const ir = createEmptyIR();
    ir.sections = [
      createSection('purpose', '## Purpose', 'Line 1\nLine 2\nLine 3', 0),
    ];
    ir.commands = [
      createCommandNode('build', 'Line A\nLine B'),
    ];
    ir.rules = [
      createRuleNode('style', 'Single line'),
    ];

    const metrics = measureComplexityFromIR(ir);

    // Sections: 3 lines, Commands: 2 lines, Rules: 1 line = 6 lines
    expect(metrics.totalLines).toBe(6);
  });
});

describe('computeDiffRatio', () => {
  it('returns 0 for identical directories', async () => {
    const dir1 = path.join(tempDir, 'a');
    const dir2 = path.join(tempDir, 'b');
    await createHarness(dir1, { 'file.md': 'hello world' });
    await createHarness(dir2, { 'file.md': 'hello world' });

    const ratio = await computeDiffRatio(dir1, dir2);
    expect(ratio).toBe(0);
  });

  it('returns > 0 for different content', async () => {
    const dir1 = path.join(tempDir, 'a');
    const dir2 = path.join(tempDir, 'b');
    await createHarness(dir1, { 'file.md': 'hello world' });
    await createHarness(dir2, { 'file.md': 'goodbye world' });

    const ratio = await computeDiffRatio(dir1, dir2);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it('returns high ratio for completely different content', async () => {
    const dir1 = path.join(tempDir, 'a');
    const dir2 = path.join(tempDir, 'b');
    await createHarness(dir1, { 'file.md': 'aaaa' });
    await createHarness(dir2, { 'file.md': 'zzzz' });

    const ratio = await computeDiffRatio(dir1, dir2);
    expect(ratio).toBeGreaterThan(0.5);
  });

  it('handles files present in only one directory', async () => {
    const dir1 = path.join(tempDir, 'a');
    const dir2 = path.join(tempDir, 'b');
    await createHarness(dir1, { 'file.md': 'content', 'extra.md': 'bonus' });
    await createHarness(dir2, { 'file.md': 'content' });

    const ratio = await computeDiffRatio(dir1, dir2);
    expect(ratio).toBeGreaterThan(0);
  });
});
