import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { applyMutations, generateDiff } from '../mutator.js';
import type { Mutation } from '../types.js';

describe('applyMutations', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join('/tmp', `kairn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('copies current harness to nextIterationDir/harness/', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(path.join(currentHarness, 'CLAUDE.md'), '# Original');

    const result = await applyMutations(currentHarness, nextIter, []);

    expect(result.newHarnessPath).toBe(path.join(nextIter, 'harness'));
    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );
    expect(content).toBe('# Original');
  });

  it('applies replace mutation when oldText is found', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(
      path.join(currentHarness, 'CLAUDE.md'),
      '# Project\n\nUse basic prompts.',
    );

    const mutations: Mutation[] = [
      {
        file: 'CLAUDE.md',
        action: 'replace',
        oldText: 'Use basic prompts.',
        newText: 'Use advanced chain-of-thought prompts.',
        rationale: 'Improve prompt quality',
      },
    ];

    const result = await applyMutations(currentHarness, nextIter, mutations);
    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );

    expect(content).toContain('Use advanced chain-of-thought prompts.');
    expect(content).not.toContain('Use basic prompts.');
  });

  it('skips replace mutation when oldText is not found', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(path.join(currentHarness, 'CLAUDE.md'), '# Project');

    const mutations: Mutation[] = [
      {
        file: 'CLAUDE.md',
        action: 'replace',
        oldText: 'text that does not exist',
        newText: 'replacement',
        rationale: 'Should be skipped',
      },
    ];

    const result = await applyMutations(currentHarness, nextIter, mutations);
    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );

    // File should be unchanged
    expect(content).toBe('# Project');
  });

  it('skips replace mutation when oldText is missing', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(path.join(currentHarness, 'CLAUDE.md'), '# Project');

    const mutations: Mutation[] = [
      {
        file: 'CLAUDE.md',
        action: 'replace',
        newText: 'replacement',
        rationale: 'No oldText provided',
      },
    ];

    const result = await applyMutations(currentHarness, nextIter, mutations);
    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );

    expect(content).toBe('# Project');
  });

  it('applies add_section mutation to existing file', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(path.join(currentHarness, 'CLAUDE.md'), '# Project');

    const mutations: Mutation[] = [
      {
        file: 'CLAUDE.md',
        action: 'add_section',
        newText: '## New Section\n\nAdded content.',
        rationale: 'Add a new section',
      },
    ];

    const result = await applyMutations(currentHarness, nextIter, mutations);
    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );

    expect(content).toContain('# Project');
    expect(content).toContain('## New Section');
    expect(content).toContain('Added content.');
  });

  it('creates file for add_section when file does not exist', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(path.join(currentHarness, 'placeholder.txt'), '');

    const mutations: Mutation[] = [
      {
        file: 'rules/new-rule.md',
        action: 'add_section',
        newText: '# New Rule\n\nAlways test first.',
        rationale: 'Add testing rule',
      },
    ];

    const result = await applyMutations(currentHarness, nextIter, mutations);
    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'rules', 'new-rule.md'),
      'utf-8',
    );

    expect(content).toBe('# New Rule\n\nAlways test first.');
  });

  it('applies create_file mutation', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(path.join(currentHarness, 'CLAUDE.md'), '# Project');

    const mutations: Mutation[] = [
      {
        file: 'commands/build.md',
        action: 'create_file',
        newText: '# Build\n\nnpm run build',
        rationale: 'Add build command',
      },
    ];

    const result = await applyMutations(currentHarness, nextIter, mutations);
    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'commands', 'build.md'),
      'utf-8',
    );

    expect(content).toBe('# Build\n\nnpm run build');
  });

  it('rejects mutations with path traversal', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(path.join(currentHarness, 'CLAUDE.md'), '# Project');

    const mutations: Mutation[] = [
      {
        file: '../../../etc/passwd',
        action: 'create_file',
        newText: 'malicious content',
        rationale: 'path traversal attack',
      },
    ];

    const result = await applyMutations(currentHarness, nextIter, mutations);

    // The file should NOT have been created outside harness
    const harnessFiles = await fs.readdir(result.newHarnessPath);
    expect(harnessFiles).toEqual(['CLAUDE.md']);
  });

  it('applies multiple mutations in order', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(
      path.join(currentHarness, 'CLAUDE.md'),
      '# Project\n\nold instructions',
    );

    const mutations: Mutation[] = [
      {
        file: 'CLAUDE.md',
        action: 'replace',
        oldText: 'old instructions',
        newText: 'new instructions',
        rationale: 'Update instructions',
      },
      {
        file: 'CLAUDE.md',
        action: 'add_section',
        newText: '## Footer\n\nEnd of file.',
        rationale: 'Add footer',
      },
      {
        file: 'rules/style.md',
        action: 'create_file',
        newText: '# Style\n\nUse TypeScript.',
        rationale: 'Add style rule',
      },
    ];

    const result = await applyMutations(currentHarness, nextIter, mutations);

    const claudeContent = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );
    expect(claudeContent).toContain('new instructions');
    expect(claudeContent).toContain('## Footer');

    const styleContent = await fs.readFile(
      path.join(result.newHarnessPath, 'rules', 'style.md'),
      'utf-8',
    );
    expect(styleContent).toBe('# Style\n\nUse TypeScript.');
  });

  it('returns a diff patch string reflecting changes', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(path.join(currentHarness, 'CLAUDE.md'), '# Original');

    const mutations: Mutation[] = [
      {
        file: 'CLAUDE.md',
        action: 'replace',
        oldText: '# Original',
        newText: '# Modified',
        rationale: 'Change title',
      },
    ];

    const result = await applyMutations(currentHarness, nextIter, mutations);

    expect(result.diffPatch).toContain('--- a/CLAUDE.md');
    expect(result.diffPatch).toContain('+++ b/CLAUDE.md');
    expect(result.diffPatch).toContain('-# Original');
    expect(result.diffPatch).toContain('+# Modified');
  });

  it('applies delete_section mutation removing matching text', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(
      path.join(currentHarness, 'CLAUDE.md'),
      '# Project\n\n## Bloated Section\n\nRemove this.\n\n## Keep This\n\nStay.',
    );

    const mutations: Mutation[] = [
      {
        file: 'CLAUDE.md',
        action: 'delete_section',
        oldText: '\n\n## Bloated Section\n\nRemove this.',
        newText: '',
        rationale: 'Remove bloat',
      },
    ];

    const result = await applyMutations(currentHarness, nextIter, mutations);
    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );

    expect(content).not.toContain('Bloated Section');
    expect(content).not.toContain('Remove this.');
    expect(content).toContain('## Keep This');
    expect(content).toContain('Stay.');
  });

  it('skips delete_section when oldText is not found', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(path.join(currentHarness, 'CLAUDE.md'), '# Project\n\nKeep everything.');

    const mutations: Mutation[] = [
      {
        file: 'CLAUDE.md',
        action: 'delete_section',
        oldText: 'text that does not exist',
        newText: '',
        rationale: 'Should be skipped',
      },
    ];

    const result = await applyMutations(currentHarness, nextIter, mutations);
    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );

    expect(content).toBe('# Project\n\nKeep everything.');
  });

  it('skips delete_section when file does not exist', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(path.join(currentHarness, 'CLAUDE.md'), '# Project');

    const mutations: Mutation[] = [
      {
        file: 'nonexistent.md',
        action: 'delete_section',
        oldText: 'some text',
        newText: '',
        rationale: 'File missing',
      },
    ];

    const result = await applyMutations(currentHarness, nextIter, mutations);
    // Should not throw, harness should be intact
    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );
    expect(content).toBe('# Project');
  });

  it('applies delete_file mutation removing the target file', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(path.join(currentHarness, 'rules'), { recursive: true });
    await fs.writeFile(path.join(currentHarness, 'CLAUDE.md'), '# Project');
    await fs.writeFile(path.join(currentHarness, 'rules', 'obsolete.md'), '# Obsolete');

    const mutations: Mutation[] = [
      {
        file: 'rules/obsolete.md',
        action: 'delete_file',
        newText: '',
        rationale: 'Remove obsolete rule',
      },
    ];

    const result = await applyMutations(currentHarness, nextIter, mutations);

    // CLAUDE.md should still exist
    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );
    expect(content).toBe('# Project');

    // obsolete.md should be gone
    await expect(
      fs.access(path.join(result.newHarnessPath, 'rules', 'obsolete.md')),
    ).rejects.toThrow();
  });

  it('skips delete_file when file does not exist', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(path.join(currentHarness, 'CLAUDE.md'), '# Project');

    const mutations: Mutation[] = [
      {
        file: 'nonexistent.md',
        action: 'delete_file',
        newText: '',
        rationale: 'Already gone',
      },
    ];

    // Should not throw
    const result = await applyMutations(currentHarness, nextIter, mutations);
    const content = await fs.readFile(
      path.join(result.newHarnessPath, 'CLAUDE.md'),
      'utf-8',
    );
    expect(content).toBe('# Project');
  });

  it('returns empty diff patch when no mutations applied', async () => {
    const currentHarness = path.join(tempDir, 'current');
    const nextIter = path.join(tempDir, 'iter1');
    await fs.mkdir(currentHarness, { recursive: true });
    await fs.writeFile(path.join(currentHarness, 'CLAUDE.md'), '# Project');

    const result = await applyMutations(currentHarness, nextIter, []);

    expect(result.diffPatch).toBe('');
  });
});

describe('generateDiff', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join('/tmp', `kairn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty string for identical directories', async () => {
    const dirA = path.join(tempDir, 'a');
    const dirB = path.join(tempDir, 'b');
    await fs.mkdir(dirA);
    await fs.mkdir(dirB);
    await fs.writeFile(path.join(dirA, 'file.txt'), 'same');
    await fs.writeFile(path.join(dirB, 'file.txt'), 'same');

    const diff = await generateDiff(dirA, dirB);
    expect(diff).toBe('');
  });

  it('detects modified files', async () => {
    const dirA = path.join(tempDir, 'a');
    const dirB = path.join(tempDir, 'b');
    await fs.mkdir(dirA);
    await fs.mkdir(dirB);
    await fs.writeFile(path.join(dirA, 'file.txt'), 'old content');
    await fs.writeFile(path.join(dirB, 'file.txt'), 'new content');

    const diff = await generateDiff(dirA, dirB);

    expect(diff).toContain('--- a/file.txt');
    expect(diff).toContain('+++ b/file.txt');
    expect(diff).toContain('-old content');
    expect(diff).toContain('+new content');
  });

  it('detects new files in the new directory', async () => {
    const dirA = path.join(tempDir, 'a');
    const dirB = path.join(tempDir, 'b');
    await fs.mkdir(dirA);
    await fs.mkdir(dirB);
    await fs.writeFile(path.join(dirB, 'new-file.txt'), 'new content');

    const diff = await generateDiff(dirA, dirB);

    expect(diff).toContain('--- a/new-file.txt');
    expect(diff).toContain('+++ b/new-file.txt');
    expect(diff).toContain('+new content');
  });

  it('detects deleted files', async () => {
    const dirA = path.join(tempDir, 'a');
    const dirB = path.join(tempDir, 'b');
    await fs.mkdir(dirA);
    await fs.mkdir(dirB);
    await fs.writeFile(path.join(dirA, 'deleted.txt'), 'will be gone');

    const diff = await generateDiff(dirA, dirB);

    expect(diff).toContain('--- a/deleted.txt');
    expect(diff).toContain('+++ b/deleted.txt');
    expect(diff).toContain('-will be gone');
  });

  it('handles nested directory structures', async () => {
    const dirA = path.join(tempDir, 'a');
    const dirB = path.join(tempDir, 'b');
    await fs.mkdir(path.join(dirA, 'sub'), { recursive: true });
    await fs.mkdir(path.join(dirB, 'sub'), { recursive: true });
    await fs.writeFile(path.join(dirA, 'sub', 'nested.txt'), 'old');
    await fs.writeFile(path.join(dirB, 'sub', 'nested.txt'), 'new');

    const diff = await generateDiff(dirA, dirB);

    expect(diff).toContain('--- a/sub/nested.txt');
    expect(diff).toContain('+++ b/sub/nested.txt');
  });

  it('handles empty directories gracefully', async () => {
    const dirA = path.join(tempDir, 'a');
    const dirB = path.join(tempDir, 'b');
    await fs.mkdir(dirA);
    await fs.mkdir(dirB);

    const diff = await generateDiff(dirA, dirB);
    expect(diff).toBe('');
  });
});
