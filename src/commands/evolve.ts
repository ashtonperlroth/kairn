import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import { parse as yamlParse } from 'yaml';
import { confirm, select } from '@inquirer/prompts';
import { ui } from '../ui.js';
import { autoGenerateTasks, createEvolveWorkspace, writeTasksFile, buildProjectProfile } from '../evolve/init.js';
import { generateTasksFromTemplates, EVAL_TEMPLATES, selectTemplatesForWorkflow } from '../evolve/templates.js';
import { snapshotBaseline } from '../evolve/baseline.js';
import { runTask } from '../evolve/runner.js';
import { scoreTask } from '../evolve/scorers.js';
import { writeScore } from '../evolve/trace.js';
import { loadConfig } from '../config.js';
import type { EvolveConfig, Task, TasksFile, TaskResult } from '../evolve/types.js';

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

      // Create workspace
      const workspace = await createEvolveWorkspace(projectRoot, DEFAULT_CONFIG);
      console.log(ui.success('Created .kairn-evolve/ workspace'));

      // Auto-generate tasks via LLM
      const spinner = ora('Generating project-specific eval tasks...').start();
      let tasks: Task[];
      try {
        tasks = await autoGenerateTasks(projectRoot, options.workflow);
        spinner.succeed(`Generated ${tasks.length} eval tasks`);
      } catch {
        spinner.fail('LLM task generation failed');
        // Fallback to template-based placeholder tasks
        const templateIds = selectTemplatesForWorkflow(options.workflow);
        tasks = templateIds.map((templateId, index) => ({
          id: `${templateId}-${index + 1}`,
          template: templateId,
          description: `${EVAL_TEMPLATES[templateId].description} (project-specific task — edit in tasks.yaml)`,
          setup: 'npm install',
          expected_outcome: 'Task completed successfully',
          scoring: 'pass-fail' as const,
          timeout: 300,
        }));
        console.log(ui.info(`Fell back to ${tasks.length} template placeholders`));
      }

      // Display generated tasks
      for (const task of tasks) {
        console.log(chalk.cyan(`  ${task.id}`) + chalk.dim(` (${task.template}) — ${task.description.slice(0, 80)}`));
      }

      // Interactive "add another eval?" loop
      let addMore = true;
      while (addMore) {
        try {
          addMore = await confirm({ message: 'Add another eval task?', default: false });
        } catch {
          addMore = false; // Handle non-interactive (piped) mode
        }
        if (addMore) {
          const templateId = await select({
            message: 'Select eval template:',
            choices: Object.values(EVAL_TEMPLATES).map(t => ({
              name: `${t.name} — ${t.description}`,
              value: t.id,
            })),
          });

          const addSpinner = ora('Generating task...').start();
          try {
            const config = await loadConfig();
            if (config) {
              let claudeMd = '';
              try { claudeMd = await fs.readFile(path.join(claudeDir, 'CLAUDE.md'), 'utf-8'); } catch { /* optional */ }
              const profile = await buildProjectProfile(projectRoot);
              const newTasks = await generateTasksFromTemplates(claudeMd, profile, [templateId], config);
              tasks.push(...newTasks);
              addSpinner.succeed(`Added ${newTasks.length} task(s)`);
            } else {
              addSpinner.fail('No config found');
            }
          } catch {
            addSpinner.fail('Failed to generate task');
          }
        }
      }

      // Write tasks file
      await writeTasksFile(workspace, tasks);
      console.log(ui.success(`Wrote ${tasks.length} tasks to tasks.yaml`));

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

      // Parse tasks.yaml with yaml package
      const tasksPath = path.join(workspace, 'tasks.yaml');
      let tasksContent: string;
      try {
        tasksContent = await fs.readFile(tasksPath, 'utf-8');
      } catch {
        console.log(ui.error('No tasks.yaml found. Run kairn evolve init first.'));
        process.exit(1);
      }

      const parsed = yamlParse(tasksContent!) as TasksFile;
      if (!parsed?.tasks || parsed.tasks.length === 0) {
        console.log(ui.error('No tasks found in tasks.yaml'));
        process.exit(1);
      }

      // Filter tasks
      const tasksToRun = options.task
        ? parsed.tasks.filter(t => t.id === options.task)
        : parsed.tasks;

      if (tasksToRun.length === 0) {
        console.log(ui.error(`Task "${options.task}" not found in tasks.yaml`));
        process.exit(1);
      }

      console.log(ui.info(`Running ${tasksToRun.length} task(s)...`));
      console.log('');

      const config = await loadConfig();
      const harnessPath = path.join(projectRoot, '.claude');
      const results: TaskResult[] = [];

      for (const task of tasksToRun) {
        const traceDir = path.join(workspace, 'traces', '0', task.id);
        const spinner = ora(`Running: ${task.id}`).start();

        const result = await runTask(task, harnessPath, traceDir, 0);

        // Score the result
        if (config) {
          const stdout = await fs.readFile(path.join(traceDir, 'stdout.log'), 'utf-8').catch(() => '');
          const stderr = await fs.readFile(path.join(traceDir, 'stderr.log'), 'utf-8').catch(() => '');
          const score = await scoreTask(task, traceDir, stdout, stderr, config);
          result.score = score;
          await writeScore(traceDir, score);
        }

        results.push(result);

        const status = result.score.pass ? chalk.green('PASS') : chalk.red('FAIL');
        const scoreStr = result.score.score !== undefined ? chalk.dim(` (${result.score.score}%)`) : '';
        spinner.stop();
        console.log(`  ${status}  ${task.id}${scoreStr}${result.score.details ? chalk.dim(` — ${result.score.details}`) : ''}`);
      }

      // Summary
      const passed = results.filter(r => r.score.pass).length;
      console.log('');
      console.log(ui.info(`Results: ${passed}/${results.length} passed`));
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
