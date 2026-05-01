import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { evaluateAll } from '../runner.js';
import type { Task } from '../types.js';
import type { KairnConfig } from '../../types.js';

describe('evaluateAll scoring workspace semantics', () => {
  let tempDir: string;
  let fakeBinDir: string;
  let origPath: string | undefined;

  beforeEach(async () => {
    tempDir = path.join(
      '/tmp',
      `kairn-runner-scoring-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fakeBinDir = path.join(tempDir, 'bin');
    await fs.mkdir(fakeBinDir, { recursive: true });

    origPath = process.env['PATH'];
    process.env['PATH'] = `${fakeBinDir}:${origPath}`;
  });

  afterEach(async () => {
    process.env['PATH'] = origPath;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createHarness(): Promise<string> {
    const harnessPath = path.join(tempDir, 'harness');
    await fs.mkdir(harnessPath, { recursive: true });
    await fs.writeFile(path.join(harnessPath, 'CLAUDE.md'), '# Test harness');
    return harnessPath;
  }

  async function createWorkspace(): Promise<string> {
    const workspacePath = path.join(tempDir, 'workspace');
    await fs.mkdir(path.join(workspacePath, 'traces', '0'), { recursive: true });
    return workspacePath;
  }

  async function writeFakeClaude(script: string): Promise<void> {
    const fakeScript = path.join(fakeBinDir, 'claude');
    await fs.writeFile(fakeScript, script);
    await fs.chmod(fakeScript, 0o755);
  }

  function makeConfig(): KairnConfig {
    return {
      provider: 'anthropic',
      api_key: 'test-key',
      model: 'claude-sonnet-4-6',
      default_runtime: 'claude-code',
      created_at: new Date().toISOString(),
    };
  }

  function makeTask(overrides: Partial<Task> = {}): Task {
    return {
      id: 'workspace-dependent-task',
      template: 'add-feature',
      description: 'Create output.txt',
      setup: '',
      expected_outcome: 'test -f output.txt',
      scoring: 'pass-fail',
      timeout: 30,
      ...overrides,
    };
  }

  it('runs pass/fail verification commands from the modified task workspace', async () => {
    await writeFakeClaude(
      [
        '#!/bin/bash',
        'cat >/dev/null',
        'echo "agent result" > "$PWD/output.txt"',
        'echo "created output.txt"',
      ].join('\n'),
    );

    const { results, aggregate } = await evaluateAll(
      [makeTask()],
      await createHarness(),
      await createWorkspace(),
      0,
      makeConfig(),
    );

    expect(results['workspace-dependent-task']?.pass).toBe(true);
    expect(aggregate).toBe(100);
  });

  it('fails pass/fail verification commands when the modified task workspace lacks the file', async () => {
    await writeFakeClaude(
      [
        '#!/bin/bash',
        'cat >/dev/null',
        'echo "no file created"',
      ].join('\n'),
    );

    const { results, aggregate } = await evaluateAll(
      [makeTask({ id: 'missing-output-task' })],
      await createHarness(),
      await createWorkspace(),
      0,
      makeConfig(),
    );

    expect(results['missing-output-task']?.pass).toBe(false);
    expect(aggregate).toBe(0);
  });
});
