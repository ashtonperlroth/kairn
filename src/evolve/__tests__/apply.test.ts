import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { applyEvolution } from '../apply.js';

describe('applyEvolution', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(
      '/tmp',
      `kairn-apply-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper: create a minimal workspace with iteration harnesses and score files.
   */
  async function createWorkspace(
    iterations: Array<{ iter: number; score: number; claudeMd: string }>,
  ): Promise<{ workspace: string; projectRoot: string }> {
    const projectRoot = path.join(tempDir, 'project');
    const workspace = path.join(tempDir, 'project', '.kairn-evolve');

    // Create project with a .claude/ directory
    await fs.mkdir(path.join(projectRoot, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.claude', 'CLAUDE.md'),
      '# Original harness',
    );

    // Create workspace with iteration harnesses and scores
    for (const { iter, score, claudeMd } of iterations) {
      const iterDir = path.join(workspace, 'iterations', iter.toString());
      const harnessDir = path.join(iterDir, 'harness');
      await fs.mkdir(harnessDir, { recursive: true });
      await fs.writeFile(path.join(harnessDir, 'CLAUDE.md'), claudeMd);

      // Write scores.json so loadIterationLog can find the score
      await fs.writeFile(
        path.join(iterDir, 'scores.json'),
        JSON.stringify({ score, taskResults: {} }),
      );
      await fs.writeFile(path.join(iterDir, 'proposer_reasoning.md'), '');
      await fs.writeFile(path.join(iterDir, 'mutation_diff.patch'), '');
    }

    return { workspace, projectRoot };
  }

  it('applies the best iteration when no targetIteration is specified', async () => {
    const { workspace, projectRoot } = await createWorkspace([
      { iter: 0, score: 60, claudeMd: '# Baseline' },
      { iter: 1, score: 90, claudeMd: '# Best iteration' },
      { iter: 2, score: 70, claudeMd: '# Regression' },
    ]);

    const result = await applyEvolution(workspace, projectRoot);

    expect(result.iteration).toBe(1);
    expect(result.filesChanged).toContain('CLAUDE.md');

    // Verify the project's .claude/CLAUDE.md was overwritten with best harness
    const content = await fs.readFile(
      path.join(projectRoot, '.claude', 'CLAUDE.md'),
      'utf-8',
    );
    expect(content).toBe('# Best iteration');
  });

  it('applies a specific iteration when targetIteration is provided', async () => {
    const { workspace, projectRoot } = await createWorkspace([
      { iter: 0, score: 60, claudeMd: '# Baseline' },
      { iter: 1, score: 90, claudeMd: '# Best iteration' },
      { iter: 2, score: 70, claudeMd: '# Iteration 2' },
    ]);

    const result = await applyEvolution(workspace, projectRoot, 2);

    expect(result.iteration).toBe(2);

    const content = await fs.readFile(
      path.join(projectRoot, '.claude', 'CLAUDE.md'),
      'utf-8',
    );
    expect(content).toBe('# Iteration 2');
  });

  it('generates a diff preview between current .claude/ and target harness', async () => {
    const { workspace, projectRoot } = await createWorkspace([
      { iter: 0, score: 80, claudeMd: '# Evolved harness\n\n## New section' },
    ]);

    const result = await applyEvolution(workspace, projectRoot, 0);

    // Diff should show old content removed and new content added
    expect(result.diffPreview).toContain('--- a/CLAUDE.md');
    expect(result.diffPreview).toContain('+++ b/CLAUDE.md');
    expect(result.diffPreview).toContain('-# Original harness');
    expect(result.diffPreview).toContain('+# Evolved harness');
  });

  it('throws when the requested iteration does not exist', async () => {
    const { workspace, projectRoot } = await createWorkspace([
      { iter: 0, score: 60, claudeMd: '# Baseline' },
    ]);

    await expect(
      applyEvolution(workspace, projectRoot, 99),
    ).rejects.toThrow(/iteration 99/i);
  });

  it('throws when no iterations exist in the workspace', async () => {
    const projectRoot = path.join(tempDir, 'empty-project');
    const workspace = path.join(projectRoot, '.kairn-evolve');
    await fs.mkdir(path.join(projectRoot, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.claude', 'CLAUDE.md'),
      '# Original',
    );
    await fs.mkdir(workspace, { recursive: true });

    await expect(
      applyEvolution(workspace, projectRoot),
    ).rejects.toThrow(/no iterations/i);
  });

  it('handles harnesses with nested directories (commands/, rules/)', async () => {
    const projectRoot = path.join(tempDir, 'nested-project');
    const workspace = path.join(projectRoot, '.kairn-evolve');

    // Create project with nested .claude/
    await fs.mkdir(path.join(projectRoot, '.claude', 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.claude', 'CLAUDE.md'),
      '# Original',
    );
    await fs.writeFile(
      path.join(projectRoot, '.claude', 'commands', 'build.md'),
      '# Old build',
    );

    // Create iteration with nested harness
    const iterDir = path.join(workspace, 'iterations', '0');
    const harnessDir = path.join(iterDir, 'harness');
    await fs.mkdir(path.join(harnessDir, 'commands'), { recursive: true });
    await fs.mkdir(path.join(harnessDir, 'rules'), { recursive: true });
    await fs.writeFile(path.join(harnessDir, 'CLAUDE.md'), '# Evolved');
    await fs.writeFile(
      path.join(harnessDir, 'commands', 'build.md'),
      '# New build',
    );
    await fs.writeFile(
      path.join(harnessDir, 'rules', 'security.md'),
      '# Security',
    );

    // Write scores
    await fs.writeFile(
      path.join(iterDir, 'scores.json'),
      JSON.stringify({ score: 80, taskResults: {} }),
    );
    await fs.writeFile(path.join(iterDir, 'proposer_reasoning.md'), '');
    await fs.writeFile(path.join(iterDir, 'mutation_diff.patch'), '');

    const result = await applyEvolution(workspace, projectRoot, 0);

    expect(result.filesChanged).toContain('CLAUDE.md');
    expect(result.filesChanged).toContain(path.join('commands', 'build.md'));
    expect(result.filesChanged).toContain(path.join('rules', 'security.md'));

    // Verify nested files were copied
    const buildContent = await fs.readFile(
      path.join(projectRoot, '.claude', 'commands', 'build.md'),
      'utf-8',
    );
    expect(buildContent).toBe('# New build');

    const securityContent = await fs.readFile(
      path.join(projectRoot, '.claude', 'rules', 'security.md'),
      'utf-8',
    );
    expect(securityContent).toBe('# Security');
  });
});
