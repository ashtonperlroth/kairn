import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { ui } from '../ui.js';
import { createEvolveWorkspace, writeTasksFile } from '../evolve/init.js';
import { snapshotBaseline } from '../evolve/baseline.js';
import { runTask } from '../evolve/runner.js';
import { EVAL_TEMPLATES, selectTemplatesForWorkflow } from '../evolve/templates.js';
import type { EvolveConfig, Task, EvalTemplate } from '../evolve/types.js';

const DEFAULT_CONFIG: EvolveConfig = {
  model: 'claude-sonnet-4-6',
  proposerModel: 'claude-opus-4-6',
  scorer: 'pass-fail',
  maxIterations: 5,
  parallelTasks: 1,
};

export const evolveCommand = new Command('evolve')
  .description('Evolve your agent environment through automated optimization');

// --- kairn evolve init ---
evolveCommand
  .command('init')
  .description('Initialize an evolution workspace with auto-generated tasks')
  .option('--workflow <type>', 'Workflow type for template selection', 'feature-development')
  .action(async (options: { workflow: string }) => {
    try {
      const projectRoot = process.cwd();

      console.log(ui.section('Evolve Init'));

      // Check for .claude/ directory
      const claudeDir = path.join(projectRoot, '.claude');
      try {
        await fs.access(claudeDir);
      } catch {
        console.log(ui.error('No .claude/ directory found. Run kairn describe first.'));
        process.exit(1);
      }

      // Read CLAUDE.md for context
      let claudeMd = '';
      try {
        claudeMd = await fs.readFile(path.join(claudeDir, 'CLAUDE.md'), 'utf-8');
      } catch {
        // CLAUDE.md is optional
      }

      // Create workspace
      const workspace = await createEvolveWorkspace(projectRoot, DEFAULT_CONFIG);
      console.log(ui.success('Created .kairn-evolve/ workspace'));

      // Select templates based on workflow
      const templateIds = selectTemplatesForWorkflow(options.workflow);
      console.log(ui.info(`Selected ${templateIds.length} eval templates for "${options.workflow}"`));

      // Generate tasks from templates
      const tasks: Task[] = templateIds.map((templateId, index) => {
        const template = EVAL_TEMPLATES[templateId];
        return {
          id: `${templateId}-${index + 1}`,
          template: templateId,
          description: `${template.description} (project-specific task — edit in tasks.yaml)`,
          setup: 'npm install',
          expected_outcome: 'Task completed successfully',
          scoring: 'pass-fail' as const,
          timeout: 300,
        };
      });

      // Write tasks file
      await writeTasksFile(workspace, tasks);
      console.log(ui.success(`Generated ${tasks.length} tasks in tasks.yaml`));

      console.log('');
      console.log(chalk.dim('  Next steps:'));
      console.log(chalk.dim('    1. Review .kairn-evolve/tasks.yaml'));
      console.log(chalk.dim('    2. Run: kairn evolve baseline'));
      console.log(chalk.dim('    3. Run: kairn evolve run'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(ui.error(msg));
      process.exit(1);
    }
  });

// --- kairn evolve baseline ---
evolveCommand
  .command('baseline')
  .description('Snapshot current .claude/ directory as baseline')
  .action(async () => {
    try {
      const projectRoot = process.cwd();
      const workspace = path.join(projectRoot, '.kairn-evolve');

      console.log(ui.section('Evolve Baseline'));

      // Verify workspace exists
      try {
        await fs.access(workspace);
      } catch {
        console.log(ui.error('No .kairn-evolve/ directory found. Run kairn evolve init first.'));
        process.exit(1);
      }

      // Snapshot baseline
      await snapshotBaseline(projectRoot, workspace);

      // Count files copied
      const baselineDir = path.join(workspace, 'baseline');
      const fileCount = await countFiles(baselineDir);
      console.log(ui.success(`Baseline snapshot created (${fileCount} files)`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(ui.error(msg));
      process.exit(1);
    }
  });

// --- kairn evolve run ---
evolveCommand
  .command('run')
  .description('Run tasks against the current harness')
  .option('--task <id>', 'Run a specific task by ID')
  .action(async (options: { task?: string }) => {
    try {
      const projectRoot = process.cwd();
      const workspace = path.join(projectRoot, '.kairn-evolve');

      console.log(ui.section('Evolve Run'));

      // Verify workspace exists
      try {
        await fs.access(workspace);
      } catch {
        console.log(ui.error('No .kairn-evolve/ directory found. Run kairn evolve init first.'));
        process.exit(1);
      }

      // Read tasks.yaml (simple parser — real YAML parsing deferred to v2.1)
      const tasksPath = path.join(workspace, 'tasks.yaml');
      let tasksContent: string;
      try {
        tasksContent = await fs.readFile(tasksPath, 'utf-8');
      } catch {
        console.log(ui.error('No tasks.yaml found. Run kairn evolve init first.'));
        process.exit(1);
      }

      // Parse task IDs from YAML
      const taskIds = parseTaskIds(tasksContent);

      if (taskIds.length === 0) {
        console.log(ui.error('No tasks found in tasks.yaml'));
        process.exit(1);
      }

      // Filter to specific task if requested
      const idsToRun = options.task
        ? taskIds.filter(id => id === options.task)
        : taskIds;

      if (idsToRun.length === 0) {
        console.log(ui.error(`Task "${options.task}" not found in tasks.yaml`));
        process.exit(1);
      }

      console.log(ui.info(`Running ${idsToRun.length} task(s)...`));

      const harnessPath = path.join(projectRoot, '.claude');

      for (const taskId of idsToRun) {
        const traceDir = path.join(workspace, 'traces', '0', taskId);
        const task: Task = {
          id: taskId,
          template: 'add-feature' as EvalTemplate,
          description: `Task ${taskId}`,
          setup: '',
          expected_outcome: '',
          scoring: 'pass-fail',
          timeout: 300,
        };

        const score = await runTask(task, harnessPath, traceDir, task.description);
        const status = score.pass ? chalk.green('PASS') : chalk.red('FAIL');
        console.log(`    ${status}  ${taskId}${score.details ? chalk.dim(` — ${score.details}`) : ''}`);
      }

      console.log('');
      console.log(ui.info('Traces written to .kairn-evolve/traces/0/'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(ui.error(msg));
      process.exit(1);
    }
  });

/**
 * Count files recursively in a directory.
 */
async function countFiles(dir: string): Promise<number> {
  let count = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += await countFiles(path.join(dir, entry.name));
      } else {
        count++;
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return count;
}

/**
 * Parse task IDs from tasks.yaml content.
 */
function parseTaskIds(yaml: string): string[] {
  const ids: string[] = [];
  for (const line of yaml.split('\n')) {
    const match = line.match(/^\s+-\s+id:\s+(.+)$/);
    if (match) {
      ids.push(match[1].trim());
    }
  }
  return ids;
}
