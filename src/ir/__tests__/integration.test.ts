/**
 * Integration tests for the full IR pipeline: parse -> translate -> mutate -> render -> verify.
 *
 * These tests use REAL file I/O — no mocks. They verify that the IR-based
 * mutation pipeline in `applyMutations` produces correct output for various
 * mutation types and that `generateDiff` works with the IR-based approach.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { applyMutations, generateDiff } from '../../evolve/mutator.js';
import type { Mutation } from '../../evolve/types.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = path.join(
    '/tmp',
    `kairn-ir-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

/**
 * Helper to create a harness directory with the given file map.
 */
async function createHarness(
  basePath: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(basePath, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }
}

describe('IR-based mutation pipeline', () => {
  it('applies replace mutation via IR pipeline and produces valid output', async () => {
    const harnessDir = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');

    await createHarness(harnessDir, {
      'CLAUDE.md': '# My Project\n\n## Purpose\n\nBuild amazing things.\n\n## Conventions\n\nUse TypeScript strict mode.',
    });

    const mutations: Mutation[] = [
      {
        file: 'CLAUDE.md',
        action: 'replace',
        oldText: 'Use TypeScript strict mode.',
        newText: 'Use TypeScript strict mode with no-any rule.',
        rationale: 'Enforce stricter typing',
      },
    ];

    const result = await applyMutations(harnessDir, nextIter, mutations);

    expect(result.newHarnessPath).toBe(path.join(nextIter, 'harness'));

    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );

    expect(content).toContain('Use TypeScript strict mode with no-any rule.');
    expect(content).not.toContain('Use TypeScript strict mode.\n');
    expect(content).toContain('# My Project');
    expect(content).toContain('## Purpose');
    expect(result.diffPatch.length).toBeGreaterThan(0);
  });

  it('applies add_section mutation via IR pipeline', async () => {
    const harnessDir = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');

    await createHarness(harnessDir, {
      'CLAUDE.md': '# My Project\n\n## Purpose\n\nBuild things.',
    });

    const mutations: Mutation[] = [
      {
        file: 'CLAUDE.md',
        action: 'add_section',
        newText: '## Verification\n\nAlways run tests before committing.',
        rationale: 'Add verification step',
      },
    ];

    const result = await applyMutations(harnessDir, nextIter, mutations);

    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );

    expect(content).toContain('## Verification');
    expect(content).toContain('Always run tests before committing.');
    expect(content).toContain('# My Project');
    expect(content).toContain('## Purpose');
  });

  it('applies create_file mutation for command via IR pipeline', async () => {
    const harnessDir = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');

    await createHarness(harnessDir, {
      'CLAUDE.md': '# My Project\n\n## Purpose\n\nBuild things.',
    });

    const mutations: Mutation[] = [
      {
        file: 'commands/build.md',
        action: 'create_file',
        newText: 'Run npm run build to compile the project.',
        rationale: 'Add build command',
      },
    ];

    const result = await applyMutations(harnessDir, nextIter, mutations);

    const commandContent = await fs.readFile(
      path.join(result.newHarnessPath, 'commands', 'build.md'),
      'utf-8',
    );

    expect(commandContent).toContain('Run npm run build to compile the project.');
  });

  it('applies create_file mutation for rule via IR pipeline', async () => {
    const harnessDir = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');

    await createHarness(harnessDir, {
      'CLAUDE.md': '# My Project\n\n## Purpose\n\nBuild things.',
    });

    const mutations: Mutation[] = [
      {
        file: 'rules/security.md',
        action: 'create_file',
        newText: 'Never use dynamic code execution with untrusted input.',
        rationale: 'Add security rule',
      },
    ];

    const result = await applyMutations(harnessDir, nextIter, mutations);

    const ruleContent = await fs.readFile(
      path.join(result.newHarnessPath, 'rules', 'security.md'),
      'utf-8',
    );

    expect(ruleContent).toContain('Never use dynamic code execution with untrusted input.');
  });

  it('applies delete_file mutation via IR pipeline', async () => {
    const harnessDir = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');

    await createHarness(harnessDir, {
      'CLAUDE.md': '# My Project\n\n## Purpose\n\nBuild things.',
      'rules/obsolete.md': 'This rule is outdated.',
    });

    const mutations: Mutation[] = [
      {
        file: 'rules/obsolete.md',
        action: 'delete_file',
        newText: '',
        rationale: 'Remove obsolete rule',
      },
    ];

    const result = await applyMutations(harnessDir, nextIter, mutations);

    // CLAUDE.md should still exist
    const claudeContent = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );
    expect(claudeContent).toContain('# My Project');

    // The obsolete rule should be gone
    await expect(
      fs.access(path.join(result.newHarnessPath, 'rules', 'obsolete.md')),
    ).rejects.toThrow();
  });

  it('applies multiple mutations of different types in one pass', async () => {
    const harnessDir = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');

    await createHarness(harnessDir, {
      'CLAUDE.md': '# My Project\n\n## Purpose\n\nBuild amazing things.\n\n## Conventions\n\nUse TypeScript.',
      'rules/old.md': 'Old rule content.',
    });

    const mutations: Mutation[] = [
      {
        file: 'CLAUDE.md',
        action: 'replace',
        oldText: 'Use TypeScript.',
        newText: 'Use TypeScript strict mode.',
        rationale: 'Stricter typing',
      },
      {
        file: 'CLAUDE.md',
        action: 'add_section',
        newText: '## Git\n\nUse conventional commits.',
        rationale: 'Add git convention',
      },
      {
        file: 'commands/test.md',
        action: 'create_file',
        newText: 'Run vitest to execute tests.',
        rationale: 'Add test command',
      },
      {
        file: 'rules/old.md',
        action: 'delete_file',
        newText: '',
        rationale: 'Remove old rule',
      },
    ];

    const result = await applyMutations(harnessDir, nextIter, mutations);

    const claudeContent = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );
    expect(claudeContent).toContain('Use TypeScript strict mode.');
    expect(claudeContent).toContain('## Git');
    expect(claudeContent).toContain('Use conventional commits.');

    const testCmd = await fs.readFile(
      path.join(result.newHarnessPath, 'commands', 'test.md'),
      'utf-8',
    );
    expect(testCmd).toContain('Run vitest to execute tests.');

    await expect(
      fs.access(path.join(result.newHarnessPath, 'rules', 'old.md')),
    ).rejects.toThrow();
  });

  it('IR-based generateDiff produces readable output', async () => {
    const dirA = path.join(tempDir, 'before');
    const dirB = path.join(tempDir, 'after');

    await createHarness(dirA, {
      'CLAUDE.md': '# Project\n\n## Purpose\n\nOld purpose.',
    });
    await createHarness(dirB, {
      'CLAUDE.md': '# Project\n\n## Purpose\n\nNew purpose.\n\n## Added\n\nNew section.',
    });

    const diff = await generateDiff(dirA, dirB);

    // Should contain some indication that CLAUDE.md changed
    expect(diff.length).toBeGreaterThan(0);
    // The diff format may be IR-based (structural) or legacy (line-based)
    // Either way, it should be non-empty for changed content
    expect(typeof diff).toBe('string');
  });

  it('handles raw_text mutations that cannot be translated to IR', async () => {
    const harnessDir = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');

    await createHarness(harnessDir, {
      'CLAUDE.md': '# My Project\n\n## Purpose\n\nBuild things.',
      'custom/special.txt': 'Some special file content.',
    });

    const mutations: Mutation[] = [
      {
        file: 'custom/special.txt',
        action: 'replace',
        oldText: 'Some special file content.',
        newText: 'Updated special file content.',
        rationale: 'Update custom file',
      },
    ];

    const result = await applyMutations(harnessDir, nextIter, mutations);

    // The custom file should have been updated via raw_text fallback
    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'custom', 'special.txt'),
      'utf-8',
    );
    expect(content).toContain('Updated special file content.');
  });

  it('skips failed IR mutations silently and continues with the rest', async () => {
    const harnessDir = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');

    await createHarness(harnessDir, {
      'CLAUDE.md': '# My Project\n\n## Purpose\n\nBuild things.',
    });

    const mutations: Mutation[] = [
      // This mutation targets text that does not exist - should be skipped
      {
        file: 'CLAUDE.md',
        action: 'replace',
        oldText: 'text that does not exist anywhere in the file',
        newText: 'replacement',
        rationale: 'Should be skipped',
      },
      // This mutation is valid and should succeed
      {
        file: 'CLAUDE.md',
        action: 'add_section',
        newText: '## Verification\n\nRun tests.',
        rationale: 'This should work',
      },
    ];

    const result = await applyMutations(harnessDir, nextIter, mutations);

    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );

    // The failed replace should not have corrupted anything
    expect(content).toContain('Build things.');
    // The successful add_section should have been applied
    expect(content).toContain('## Verification');
    expect(content).toContain('Run tests.');
  });

  it('preserves existing commands and rules through IR round-trip', async () => {
    const harnessDir = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');

    await createHarness(harnessDir, {
      'CLAUDE.md': '# My Project\n\n## Purpose\n\nBuild things.',
      'commands/build.md': 'Run npm run build.',
      'commands/test.md': 'Run npm test.',
      'rules/security.md': 'No dynamic code execution.',
      'rules/style.md': 'Use TypeScript.',
    });

    // Apply a single CLAUDE.md mutation - all other files should survive
    const mutations: Mutation[] = [
      {
        file: 'CLAUDE.md',
        action: 'add_section',
        newText: '## Debugging\n\nUse node --inspect.',
        rationale: 'Add debugging section',
      },
    ];

    const result = await applyMutations(harnessDir, nextIter, mutations);

    // Verify all original files are present
    const buildContent = await fs.readFile(
      path.join(result.newHarnessPath, 'commands', 'build.md'),
      'utf-8',
    );
    expect(buildContent).toContain('Run npm run build.');

    const testContent = await fs.readFile(
      path.join(result.newHarnessPath, 'commands', 'test.md'),
      'utf-8',
    );
    expect(testContent).toContain('Run npm test.');

    const securityContent = await fs.readFile(
      path.join(result.newHarnessPath, 'rules', 'security.md'),
      'utf-8',
    );
    expect(securityContent).toContain('No dynamic code execution.');

    const styleContent = await fs.readFile(
      path.join(result.newHarnessPath, 'rules', 'style.md'),
      'utf-8',
    );
    expect(styleContent).toContain('Use TypeScript.');
  });
});
