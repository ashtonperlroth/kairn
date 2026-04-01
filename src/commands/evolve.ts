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
import { writeScore, loadIterationLog } from '../evolve/trace.js';
import { evolve } from '../evolve/loop.js';
import { generateMarkdownReport, generateJsonReport } from '../evolve/report.js';
import { generateDiff } from '../evolve/mutator.js';
import { applyEvolution } from '../evolve/apply.js';
import { loadConfig } from '../config.js';
import type { EvolveConfig, Task, TasksFile, TaskResult, LoopProgressEvent } from '../evolve/types.js';

const DEFAULT_CONFIG: EvolveConfig = {
  model: 'claude-sonnet-4-6',
  proposerModel: 'claude-opus-4-6',
  scorer: 'pass-fail',
  maxIterations: 5,
  parallelTasks: 1,
  runsPerTask: 1,
};

/**
 * Load EvolveConfig from a workspace's config.yaml.
 * Falls back to DEFAULT_CONFIG for any missing fields.
 */
export async function loadEvolveConfigFromWorkspace(workspacePath: string): Promise<EvolveConfig> {
  try {
    const configStr = await fs.readFile(path.join(workspacePath, 'config.yaml'), 'utf-8');
    const parsed = yamlParse(configStr) as Record<string, unknown>;
    return {
      model: (parsed.model as string) ?? DEFAULT_CONFIG.model,
      proposerModel: (parsed.proposer_model as string) ?? DEFAULT_CONFIG.proposerModel,
      scorer: (parsed.scorer as EvolveConfig['scorer']) ?? DEFAULT_CONFIG.scorer,
      maxIterations: (parsed.max_iterations as number) ?? DEFAULT_CONFIG.maxIterations,
      parallelTasks: (parsed.parallel_tasks as number) ?? DEFAULT_CONFIG.parallelTasks,
      runsPerTask: (parsed.runs_per_task as number) ?? DEFAULT_CONFIG.runsPerTask,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

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
  .option('--iterations <n>', 'Number of evolution iterations', '5')
  .option('--runs <n>', 'Run each task N times for variance measurement', '1')
  .action(async (options: { task?: string; iterations?: string; runs?: string }) => {
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

      const tasksPath = path.join(workspace, 'tasks.yaml');
      let tasksContent: string;
      try {
        tasksContent = await fs.readFile(tasksPath, 'utf-8');
      } catch {
        console.log(ui.error('No tasks.yaml found. Run kairn evolve init first.'));
        process.exit(1);
      }

      const parsed = yamlParse(tasksContent) as TasksFile;
      if (!parsed?.tasks || parsed.tasks.length === 0) {
        console.log(ui.error('No tasks found in tasks.yaml'));
        process.exit(1);
      }

      if (options.task) {
        const tasksToRun = parsed.tasks.filter(t => t.id === options.task);

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
      } else {
        const kairnConfig = await loadConfig();
        if (!kairnConfig) {
          console.log(ui.error('No config found. Run kairn init first.'));
          process.exit(1);
        }

        const evolveConfig = await loadEvolveConfigFromWorkspace(workspace);
        const iterations = parseInt(options.iterations ?? '5', 10);
        if (isNaN(iterations) || iterations < 1) {
          console.log(ui.error('--iterations must be a positive integer'));
          process.exit(1);
        }
        evolveConfig.maxIterations = iterations;

        const runs = parseInt(options.runs ?? '1', 10);
        if (isNaN(runs) || runs < 1) {
          console.log(ui.error('--runs must be a positive integer'));
          process.exit(1);
        }
        evolveConfig.runsPerTask = runs;

        // Verify baseline exists
        try {
          await fs.access(path.join(workspace, 'iterations', '0', 'harness'));
        } catch {
          console.log(ui.error('No baseline harness found. Run kairn evolve baseline first.'));
          process.exit(1);
        }

        const result = await evolve(workspace, parsed.tasks, kairnConfig, evolveConfig, (event: LoopProgressEvent) => {
          switch (event.type) {
            case 'iteration-start':
              console.log(ui.section(`Iteration ${event.iteration}`));
              break;
            case 'iteration-scored': {
              const scoreColor = event.score !== undefined && event.score >= 100
                ? chalk.green
                : event.score !== undefined && event.score >= 60
                  ? chalk.yellow
                  : chalk.red;
              console.log(`  Score: ${scoreColor((event.score?.toFixed(1) ?? '0') + '%')}`);
              break;
            }
            case 'rollback':
              console.log(chalk.yellow(`  Warning: ${event.message ?? 'Regression detected'}`));
              break;
            case 'proposing':
              console.log(chalk.dim('  Proposer analyzing traces...'));
              break;
            case 'mutations-applied':
              console.log(chalk.dim(`  Applied ${event.mutationCount ?? 0} mutation(s)`));
              break;
            case 'perfect-score':
              console.log(chalk.green('  Perfect score. Stopping.'));
              break;
            case 'proposer-error':
              console.log(chalk.yellow(`  Warning: ${event.message ?? 'Proposer failed'}`));
              break;
            case 'task-start':
              console.log(chalk.dim(`    Running: ${event.taskId ?? 'unknown'}...`));
              break;
            case 'task-run':
              console.log(chalk.dim(`      ${event.message ?? ''}`));
              break;
            case 'task-scored': {
              const taskScore = event.score ?? 0;
              const taskStatus = taskScore >= 100 ? chalk.green('PASS') : taskScore >= 60 ? chalk.yellow('PARTIAL') : chalk.red('FAIL');
              console.log(`    ${taskStatus}  ${event.taskId ?? 'unknown'} ${chalk.dim(`(${taskScore.toFixed(0)}%)`)}`);
              break;
            }
            case 'complete':
              break; // Summary printed below
          }
        });

        // Print summary
        console.log(ui.section('Evolution Summary'));
        console.log(`  Iterations:    ${result.iterations.length}`);
        console.log(`  Baseline:      ${result.baselineScore.toFixed(1)}%`);
        console.log(`  Best:          ${chalk.green(result.bestScore.toFixed(1) + '%')} (iteration ${result.bestIteration})`);
        const improvement = result.bestScore - result.baselineScore;
        if (improvement > 0) {
          console.log(`  Improvement:   ${chalk.green('+' + improvement.toFixed(1) + ' points')}`);
        } else {
          console.log(`  Improvement:   ${improvement.toFixed(1)} points`);
        }
        console.log('');

        // Iteration table
        const showVariance = runs > 1;
        console.log(showVariance
          ? '  Iter  Score        Mutations  Status'
          : '  Iter  Score     Mutations  Status');
        for (const iter of result.iterations) {
          // Compute average stddev across tasks for this iteration
          let scoreDisplay: string;
          if (showVariance) {
            const taskScores = Object.values(iter.taskResults);
            const stddevs = taskScores
              .map(s => s.variance?.stddev)
              .filter((v): v is number => v !== undefined);
            const avgStddev = stddevs.length > 0
              ? stddevs.reduce((a, b) => a + b, 0) / stddevs.length
              : 0;
            scoreDisplay = `${iter.score.toFixed(1).padStart(6)}% ±${avgStddev.toFixed(1)}`;
          } else {
            scoreDisplay = iter.score.toFixed(1).padStart(6) + '%';
          }
          const mutations = iter.proposal?.mutations.length ?? 0;
          const mutStr = mutations > 0 ? mutations.toString() : '-';
          let status = 'evaluated';
          if (iter.iteration === 0) status = 'baseline';
          else if (!iter.proposal && !iter.diffPatch) status = 'rollback';
          else if (iter.score >= 100) status = 'perfect';
          else if (iter.iteration === result.bestIteration) status = 'best';
          console.log(`  ${iter.iteration.toString().padStart(4)}  ${scoreDisplay}  ${mutStr.padStart(9)}  ${status}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(ui.error(msg));
      process.exit(1);
    }
  });

// --- kairn evolve apply ---
evolveCommand
  .command('apply')
  .description('Apply the best evolved harness to your project')
  .option('--iter <n>', 'Apply a specific iteration instead of the best')
  .option('--force', 'Apply even if git working tree is dirty')
  .option('--no-commit', 'Skip automatic git commit after applying')
  .action(async (options: { iter?: string; force?: boolean; commit?: boolean }) => {
    try {
      const projectRoot = process.cwd();
      const workspace = path.join(projectRoot, '.kairn-evolve');

      console.log(ui.section('Evolve Apply'));

      // Verify workspace exists
      try {
        await fs.access(workspace);
      } catch {
        console.log(ui.error('No .kairn-evolve/ directory found. Run kairn evolve init first.'));
        process.exit(1);
      }

      // Parse --iter option
      let targetIteration: number | undefined;
      if (options.iter) {
        targetIteration = parseInt(options.iter, 10);
        if (isNaN(targetIteration)) {
          console.log(ui.error('--iter must be a number'));
          process.exit(1);
        }
      }

      const result = await applyEvolution(workspace, projectRoot, targetIteration);

      // Show diff preview
      if (result.diffPreview) {
        console.log(ui.section('Changes'));
        for (const line of result.diffPreview.split('\n')) {
          if (line.startsWith('---') || line.startsWith('+++')) {
            console.log(chalk.bold(line));
          } else if (line.startsWith('+')) {
            console.log(chalk.green(line));
          } else if (line.startsWith('-')) {
            console.log(chalk.red(line));
          } else {
            console.log(line);
          }
        }
      }

      console.log('');
      console.log(ui.success(
        `Applied iteration ${result.iteration} harness (${result.filesChanged.length} files)`,
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(ui.error(msg));
      process.exit(1);
    }
  });

// --- kairn evolve report ---
evolveCommand
  .command('report')
  .description('Generate a summary report of the evolution run')
  .option('--json', 'Output machine-readable JSON instead of Markdown')
  .action(async (options: { json?: boolean }) => {
    try {
      const projectRoot = process.cwd();
      const workspace = path.join(projectRoot, '.kairn-evolve');

      // Verify workspace exists
      try {
        await fs.access(workspace);
      } catch {
        console.log(ui.error('No .kairn-evolve/ directory found. Run kairn evolve init first.'));
        process.exit(1);
      }

      if (options.json) {
        const report = await generateJsonReport(workspace);
        console.log(JSON.stringify(report, null, 2));
      } else {
        const markdown = await generateMarkdownReport(workspace);
        console.log(markdown);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(ui.error(msg));
      process.exit(1);
    }
  });

// --- kairn evolve diff ---
evolveCommand
  .command('diff <iter1> <iter2>')
  .description('Show harness changes between two iterations')
  .action(async (iter1Str: string, iter2Str: string) => {
    try {
      const projectRoot = process.cwd();
      const workspace = path.join(projectRoot, '.kairn-evolve');

      const iter1 = parseInt(iter1Str, 10);
      const iter2 = parseInt(iter2Str, 10);

      if (isNaN(iter1) || isNaN(iter2)) {
        console.log(ui.error('Both arguments must be integers (iteration numbers)'));
        process.exit(1);
      }

      // Verify both iteration harness directories exist
      const harness1 = path.join(workspace, 'iterations', iter1.toString(), 'harness');
      const harness2 = path.join(workspace, 'iterations', iter2.toString(), 'harness');

      try {
        await fs.access(harness1);
      } catch {
        console.log(ui.error(`Iteration ${iter1} harness not found at ${harness1}`));
        process.exit(1);
      }
      try {
        await fs.access(harness2);
      } catch {
        console.log(ui.error(`Iteration ${iter2} harness not found at ${harness2}`));
        process.exit(1);
      }

      console.log(ui.section(`Diff: Iteration ${iter1} → ${iter2}`));

      // Generate and display colored diff
      const diffPatch = await generateDiff(harness1, harness2);

      if (!diffPatch) {
        console.log(chalk.dim('  No harness changes between these iterations.'));
      } else {
        for (const line of diffPatch.split('\n')) {
          if (line.startsWith('---') || line.startsWith('+++')) {
            console.log(chalk.bold(line));
          } else if (line.startsWith('+')) {
            console.log(chalk.green(line));
          } else if (line.startsWith('-')) {
            console.log(chalk.red(line));
          } else {
            console.log(line);
          }
        }
      }

      // Per-task score comparison
      const [log1, log2] = await Promise.all([
        loadIterationLog(workspace, iter1),
        loadIterationLog(workspace, iter2),
      ]);

      if (log1 && log2) {
        console.log('');
        console.log(ui.section('Score Comparison'));
        console.log('');
        console.log('  Task                          Iter ' + iter1 + '    Iter ' + iter2 + '    Delta');

        const allTaskIds = new Set([
          ...Object.keys(log1.taskResults),
          ...Object.keys(log2.taskResults),
        ]);

        for (const taskId of [...allTaskIds].sort()) {
          const s1 = log1.taskResults[taskId];
          const s2 = log2.taskResults[taskId];
          const score1 = s1 ? (s1.score ?? (s1.pass ? 100 : 0)) : 0;
          const score2 = s2 ? (s2.score ?? (s2.pass ? 100 : 0)) : 0;
          const delta = score2 - score1;
          const deltaStr = delta > 0
            ? chalk.green(`+${delta.toFixed(0)}`)
            : delta < 0
              ? chalk.red(delta.toFixed(0).toString())
              : chalk.dim('0');
          const name = taskId.padEnd(30);
          console.log(`  ${name}  ${score1.toFixed(0).padStart(5)}%    ${score2.toFixed(0).padStart(5)}%    ${deltaStr}`);
        }
      }
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
