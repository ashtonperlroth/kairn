import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { snapshotBaseline, copyDir, loadHarnessSnapshot } from '../baseline.js';

describe('copyDir', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join('/tmp', `kairn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('copies files from src to dest', async () => {
    const src = path.join(tempDir, 'src');
    const dest = path.join(tempDir, 'dest');
    await fs.mkdir(src);
    await fs.writeFile(path.join(src, 'file.txt'), 'hello');

    await copyDir(src, dest);

    const content = await fs.readFile(path.join(dest, 'file.txt'), 'utf-8');
    expect(content).toBe('hello');
  });

  it('creates dest directory if it does not exist', async () => {
    const src = path.join(tempDir, 'src');
    const dest = path.join(tempDir, 'nested', 'deep', 'dest');
    await fs.mkdir(src);
    await fs.writeFile(path.join(src, 'a.txt'), 'data');

    await copyDir(src, dest);

    const stat = await fs.stat(dest);
    expect(stat.isDirectory()).toBe(true);
  });

  it('copies nested subdirectories recursively', async () => {
    const src = path.join(tempDir, 'src');
    await fs.mkdir(path.join(src, 'sub'), { recursive: true });
    await fs.writeFile(path.join(src, 'root.txt'), 'root');
    await fs.writeFile(path.join(src, 'sub', 'nested.txt'), 'nested');

    const dest = path.join(tempDir, 'dest');
    await copyDir(src, dest);

    const rootContent = await fs.readFile(path.join(dest, 'root.txt'), 'utf-8');
    const nestedContent = await fs.readFile(path.join(dest, 'sub', 'nested.txt'), 'utf-8');
    expect(rootContent).toBe('root');
    expect(nestedContent).toBe('nested');
  });
});

describe('snapshotBaseline', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join('/tmp', `kairn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('copies .claude/ to baseline/', async () => {
    const projectRoot = path.join(tempDir, 'project');
    const claudeDir = path.join(projectRoot, '.claude');
    const workspacePath = path.join(tempDir, 'workspace');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'CLAUDE.md'), '# Project');

    await snapshotBaseline(projectRoot, workspacePath);

    const content = await fs.readFile(
      path.join(workspacePath, 'baseline', 'CLAUDE.md'),
      'utf-8',
    );
    expect(content).toBe('# Project');
  });

  it('copies .claude/ to iterations/0/harness/', async () => {
    const projectRoot = path.join(tempDir, 'project');
    const claudeDir = path.join(projectRoot, '.claude');
    const workspacePath = path.join(tempDir, 'workspace');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'CLAUDE.md'), '# Harness');

    await snapshotBaseline(projectRoot, workspacePath);

    const content = await fs.readFile(
      path.join(workspacePath, 'iterations', '0', 'harness', 'CLAUDE.md'),
      'utf-8',
    );
    expect(content).toBe('# Harness');
  });

  it('copies .mcp.json when present in project root', async () => {
    const projectRoot = path.join(tempDir, 'project');
    const claudeDir = path.join(projectRoot, '.claude');
    const workspacePath = path.join(tempDir, 'workspace');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'CLAUDE.md'), '# Project');
    await fs.writeFile(
      path.join(projectRoot, '.mcp.json'),
      '{"mcpServers":{"test":{}}}',
    );

    await snapshotBaseline(projectRoot, workspacePath);

    const baselineMcp = await fs.readFile(
      path.join(workspacePath, 'baseline', '.mcp.json'),
      'utf-8',
    );
    expect(baselineMcp).toBe('{"mcpServers":{"test":{}}}');

    const iter0Mcp = await fs.readFile(
      path.join(workspacePath, 'iterations', '0', 'harness', '.mcp.json'),
      'utf-8',
    );
    expect(iter0Mcp).toBe('{"mcpServers":{"test":{}}}');
  });

  it('works without .mcp.json (backward compat)', async () => {
    const projectRoot = path.join(tempDir, 'project');
    const claudeDir = path.join(projectRoot, '.claude');
    const workspacePath = path.join(tempDir, 'workspace');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'CLAUDE.md'), '# Project');

    // Should not throw when .mcp.json is absent
    await snapshotBaseline(projectRoot, workspacePath);

    const content = await fs.readFile(
      path.join(workspacePath, 'baseline', 'CLAUDE.md'),
      'utf-8',
    );
    expect(content).toBe('# Project');

    // .mcp.json should not exist in baseline
    await expect(
      fs.access(path.join(workspacePath, 'baseline', '.mcp.json')),
    ).rejects.toThrow();
  });

  it('throws if .claude/ does not exist', async () => {
    const projectRoot = path.join(tempDir, 'no-claude-project');
    const workspacePath = path.join(tempDir, 'workspace');
    await fs.mkdir(projectRoot, { recursive: true });

    await expect(snapshotBaseline(projectRoot, workspacePath)).rejects.toThrow(
      '.claude/ directory not found',
    );
  });
});

describe('loadHarnessSnapshot', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join('/tmp', `kairn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns HarnessSnapshot with path and iteration', async () => {
    const harnessDir = path.join(tempDir, 'harness');
    await fs.mkdir(harnessDir);

    const snapshot = await loadHarnessSnapshot(harnessDir, 0);

    expect(snapshot.path).toBe(harnessDir);
    expect(snapshot.iteration).toBe(0);
  });

  it('returns correct iteration number', async () => {
    const harnessDir = path.join(tempDir, 'harness');
    await fs.mkdir(harnessDir);

    const snapshot = await loadHarnessSnapshot(harnessDir, 3);

    expect(snapshot.iteration).toBe(3);
  });

  it('throws if harness directory does not exist', async () => {
    const harnessDir = path.join(tempDir, 'nonexistent');

    await expect(loadHarnessSnapshot(harnessDir, 0)).rejects.toThrow(
      'Harness directory not found',
    );
  });
});
