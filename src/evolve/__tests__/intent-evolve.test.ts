import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { snapshotBaseline } from '../baseline.js';
import { EVAL_TEMPLATES, selectTemplatesForWorkflow } from '../templates.js';
import type { EvalTemplate } from '../types.js';

describe('evolve integration with intent routing', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairn-intent-evolve-'));
    // Create a mock .claude/ directory with hooks
    const claudeDir = path.join(tmpDir, 'project', '.claude');
    await fs.mkdir(path.join(claudeDir, 'hooks'), { recursive: true });
    await fs.mkdir(path.join(claudeDir, 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(claudeDir, 'CLAUDE.md'),
      '# Test Project\n## Purpose\nTest',
    );
    await fs.writeFile(
      path.join(claudeDir, 'hooks', 'intent-router.mjs'),
      '// intent router script',
    );
    await fs.writeFile(
      path.join(claudeDir, 'hooks', 'intent-learner.mjs'),
      '// intent learner script',
    );
    await fs.writeFile(
      path.join(claudeDir, 'hooks', 'intent-log.jsonl'),
      '',
    );
    await fs.writeFile(
      path.join(claudeDir, 'commands', 'deploy.md'),
      '# Deploy\nDeploy to prod.',
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('baseline snapshot includes hooks', () => {
    it('snapshots .claude/hooks/ directory', async () => {
      const projectRoot = path.join(tmpDir, 'project');
      const workspacePath = path.join(tmpDir, 'workspace');
      await fs.mkdir(workspacePath, { recursive: true });

      await snapshotBaseline(projectRoot, workspacePath);

      // Check baseline has hooks
      const baselineRouter = path.join(workspacePath, 'baseline', 'hooks', 'intent-router.mjs');
      const content = await fs.readFile(baselineRouter, 'utf-8');
      expect(content).toBe('// intent router script');

      // Check iteration 0 also has hooks
      const iter0Router = path.join(workspacePath, 'iterations', '0', 'harness', 'hooks', 'intent-router.mjs');
      const iter0Content = await fs.readFile(iter0Router, 'utf-8');
      expect(iter0Content).toBe('// intent router script');
    });

    it('snapshots intent-learner.mjs', async () => {
      const projectRoot = path.join(tmpDir, 'project');
      const workspacePath = path.join(tmpDir, 'workspace');
      await fs.mkdir(workspacePath, { recursive: true });

      await snapshotBaseline(projectRoot, workspacePath);

      const baselineLearner = path.join(workspacePath, 'baseline', 'hooks', 'intent-learner.mjs');
      const content = await fs.readFile(baselineLearner, 'utf-8');
      expect(content).toBe('// intent learner script');
    });

    it('snapshots intent-log.jsonl', async () => {
      const projectRoot = path.join(tmpDir, 'project');
      const workspacePath = path.join(tmpDir, 'workspace');
      await fs.mkdir(workspacePath, { recursive: true });

      await snapshotBaseline(projectRoot, workspacePath);

      const baselineLog = path.join(workspacePath, 'baseline', 'hooks', 'intent-log.jsonl');
      const content = await fs.readFile(baselineLog, 'utf-8');
      expect(content).toBe('');
    });
  });

  describe('intent-routing eval template', () => {
    it('exists in EVAL_TEMPLATES', () => {
      expect(EVAL_TEMPLATES['intent-routing' as EvalTemplate]).toBeDefined();
    });

    it('has correct metadata', () => {
      const template = EVAL_TEMPLATES['intent-routing' as EvalTemplate];
      expect(template.name).toBe('Intent Routing');
      expect(template.description).toContain('intent');
    });

    it('is selected for feature-development workflows', () => {
      const templates = selectTemplatesForWorkflow('feature-development');
      expect(templates).toContain('intent-routing');
    });
  });
});
