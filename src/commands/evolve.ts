import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import { parse as yamlParse } from 'yaml';
import { confirm, input, select } from '@inquirer/prompts';
import { ui } from '../ui.js';
import { autoGenerateTasks, createEvolveWorkspace, writeTasksFile, buildProjectProfile } from '../evolve/init.js';
import { generateTasksFromTemplates, EVAL_TEMPLATES, selectTemplatesForWorkflow } from '../evolve/templates.js';
import { snapshotBaseline } from '../evolve/baseline.js';
import { runTask } from '../evolve/runner.js';
import { loadIterationLog } from '../evolve/trace.js';
import { evolve } from '../evolve/loop.js';
import { generateMarkdownReport, generateJsonReport } from '../evolve/report.js';
import { generateDiff } from '../evolve/mutator.js';
import { applyEvolution } from '../evolve/apply.js';
import { loadConfig } from '../config.js';
import type { EvolveConfig, Task, TasksFile, TaskResult, LoopProgressEvent } from '../evolve/types.js';

const DEFAULT_CONFIG: EvolveConfig = {
  model: 'claude-sonnet-4-6',
  proposerModel: 'claude-sonnet-4-6',
  scorer: 'pass-fail',
  maxIterations: 5,
  parallelTasks: 1,
  runsPerTask: 1,
  maxMutationsPerIteration: 3,
  pruneThreshold: 95,
  maxTaskDrop: 20,
  usePrincipal: false,
  evalSampleSize: 0,
  samplingStrategy: 'thompson',
  klLambda: 0.1,
  pbtBranches: 3,
  architectEvery: 3,
  schedule: 'explore-exploit',
  architectModel: 'claude-sonnet-4-6',
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
      maxMutationsPerIteration: (parsed.max_mutations_per_iteration as number) ?? DEFAULT_CONFIG.maxMutationsPerIteration,
      pruneThreshold: (parsed.prune_threshold as number) ?? DEFAULT_CONFIG.pruneThreshold,
      maxTaskDrop: (parsed.max_task_drop as number) ?? DEFAULT_CONFIG.maxTaskDrop,
      usePrincipal: (parsed.use_principal as boolean) ?? DEFAULT_CONFIG.usePrincipal,
      evalSampleSize: (parsed.eval_sample_size as number) ?? DEFAULT_CONFIG.evalSampleSize,
      samplingStrategy: (parsed.sampling_strategy as EvolveConfig['samplingStrategy']) ?? DEFAULT_CONFIG.samplingStrategy,
      klLambda: (parsed.kl_lambda as number) ?? DEFAULT_CONFIG.klLambda,
      pbtBranches: (parsed.pbt_branches as number) ?? DEFAULT_CONFIG.pbtBranches,
      architectEvery: (parsed.architect_every as number) ?? DEFAULT_CONFIG.architectEvery,
      schedule: (parsed.schedule as EvolveConfig['schedule']) ?? DEFAULT_CONFIG.schedule,
      architectModel: (parsed.architect_model as string) ?? DEFAULT_CONFIG.architectModel,
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

      // Auto-generate tasks via LLM (with 90s timeout)
      const spinner = ora('Generating project-specific eval tasks...').start();
      let tasks: Task[];
      try {
        const taskGenPromise = autoGenerateTasks(projectRoot, options.workflow);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Task generation timed out after 90s. Check your API key with `kairn init`.')), 90_000)
        );
        tasks = await Promise.race([taskGenPromise, timeoutPromise]);
        spinner.succeed(`Generated ${tasks.length} eval tasks`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        spinner.fail(`LLM task generation failed: ${errMsg}`);
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
  .option('--parallel <n>', 'Run up to N tasks concurrently', '1')
  .option('--max-mutations <n>', 'Max mutations per iteration', '3')
  .option('--prune-threshold <n>', 'Skip tasks scoring above this on middle iterations', '95')
  .option('--max-task-drop <n>', 'Roll back if any task drops more than N points', '20')
  .option('--principal', 'Run Principal Proposer as final iteration')
  .option('--eval-sample <n>', 'Sample N tasks per middle iteration (0 = all)', '0')
  .option('--sampling <strategy>', 'Task sampling strategy: thompson or uniform', 'thompson')
  .option('--kl-lambda <n>', 'KL regularization strength (0 = disabled)', '0.1')
  .option('--architect-every <n>', 'Run architect proposer every N iterations (default: 3)')
  .option('--schedule <type>', 'Architect schedule: explore-exploit, constant, or adaptive (default: explore-exploit)')
  .option('--architect-model <model>', 'Model for architect proposer (defaults to proposer model)')
  .option('-i, --interactive', 'Configure evolution settings interactively')
  .action(async (options: { task?: string; iterations?: string; runs?: string; parallel?: string; maxMutations?: string; pruneThreshold?: string; maxTaskDrop?: string; principal?: boolean; evalSample?: string; sampling?: string; klLambda?: string; architectEvery?: string; schedule?: string; architectModel?: string; interactive?: boolean }) => {
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

          const result = await runTask(task, harnessPath, traceDir, 0, { config });

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

        // Show interactive menu by default unless flags were explicitly passed
        const hasExplicitFlags = options.iterations !== '5' || options.runs !== '1' ||
          options.parallel !== '1' || options.maxMutations !== '3' ||
          options.pruneThreshold !== '95' || options.maxTaskDrop !== '20' ||
          options.principal || options.evalSample !== '0' ||
          options.sampling !== 'thompson' || options.klLambda !== '0.1' ||
          options.architectEvery !== undefined || options.schedule !== undefined ||
          options.architectModel !== undefined;

        if (!hasExplicitFlags) {
          // Interactive configuration menu
          console.log(chalk.dim('  Configure evolution settings:\n'));

          const preset = await select({
            message: 'Evolution preset',
            choices: [
              { name: 'Quick (3 iterations, 1 run, no extras)', value: 'quick' },
              { name: 'Standard (5 iterations, 1 run, parallel)', value: 'standard' },
              { name: 'Rigorous (5 iterations, 3 runs, parallel, principal)', value: 'rigorous' },
              { name: 'Custom (configure each setting)', value: 'custom' },
            ],
          });

          if (preset === 'quick') {
            evolveConfig.maxIterations = 3;
            evolveConfig.runsPerTask = 1;
            evolveConfig.parallelTasks = 3;
          } else if (preset === 'standard') {
            evolveConfig.maxIterations = 5;
            evolveConfig.runsPerTask = 1;
            evolveConfig.parallelTasks = 5;
          } else if (preset === 'rigorous') {
            evolveConfig.maxIterations = 5;
            evolveConfig.runsPerTask = 3;
            evolveConfig.parallelTasks = 5;
            evolveConfig.usePrincipal = true;
          } else {
            evolveConfig.maxIterations = parseInt(
              await input({ message: 'Iterations', default: '5' }), 10) || 5;
            evolveConfig.runsPerTask = parseInt(
              await input({ message: 'Runs per task (variance)', default: '1' }), 10) || 1;
            evolveConfig.parallelTasks = parseInt(
              await input({ message: 'Parallel tasks', default: '3' }), 10) || 3;
            evolveConfig.maxMutationsPerIteration = parseInt(
              await input({ message: 'Max mutations per iteration', default: '3' }), 10) || 3;
            evolveConfig.pruneThreshold = parseInt(
              await input({ message: 'Prune threshold (%)', default: '95' }), 10) || 95;
            evolveConfig.maxTaskDrop = parseInt(
              await input({ message: 'Max task drop (rollback guard)', default: '20' }), 10) || 20;
            evolveConfig.usePrincipal = await confirm({
              message: 'Run Principal Proposer at end?', default: false,
            });
            evolveConfig.evalSampleSize = parseInt(
              await input({ message: 'Eval sample size (0 = all)', default: '0' }), 10) || 0;
          }

          console.log('');
          console.log(chalk.dim(`  Iterations: ${evolveConfig.maxIterations}, Runs: ${evolveConfig.runsPerTask}, Parallel: ${evolveConfig.parallelTasks}`));
          console.log(chalk.dim(`  Mutations: ${evolveConfig.maxMutationsPerIteration}, Prune: ${evolveConfig.pruneThreshold}%, Guard: ${evolveConfig.maxTaskDrop}pt`));
          if (evolveConfig.usePrincipal) console.log(chalk.dim('  Principal Proposer: enabled'));
          if (evolveConfig.evalSampleSize > 0) console.log(chalk.dim(`  Eval sampling: ${evolveConfig.evalSampleSize} tasks/iter (${evolveConfig.samplingStrategy})`));
          if (evolveConfig.klLambda > 0) console.log(chalk.dim(`  KL regularization: λ=${evolveConfig.klLambda}`));
          console.log('');
        } else {
          // Flag-based configuration
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

          const parallel = parseInt(options.parallel ?? '1', 10);
          if (isNaN(parallel) || parallel < 1) {
            console.log(ui.error('--parallel must be a positive integer'));
            process.exit(1);
          }
          evolveConfig.parallelTasks = parallel;

          const maxMutations = parseInt(options.maxMutations ?? '3', 10);
          if (isNaN(maxMutations) || maxMutations < 1) {
            console.log(ui.error('--max-mutations must be a positive integer'));
            process.exit(1);
          }
          evolveConfig.maxMutationsPerIteration = maxMutations;

          const pruneThreshold = parseInt(options.pruneThreshold ?? '95', 10);
          if (isNaN(pruneThreshold) || pruneThreshold < 0 || pruneThreshold > 100) {
            console.log(ui.error('--prune-threshold must be 0-100'));
            process.exit(1);
          }
          evolveConfig.pruneThreshold = pruneThreshold;

          const maxTaskDrop = parseInt(options.maxTaskDrop ?? '20', 10);
          if (isNaN(maxTaskDrop) || maxTaskDrop < 1) {
            console.log(ui.error('--max-task-drop must be a positive integer'));
            process.exit(1);
          }
          evolveConfig.maxTaskDrop = maxTaskDrop;

          if (options.principal) {
            evolveConfig.usePrincipal = true;
          }

          const evalSample = parseInt(options.evalSample ?? '0', 10);
          if (isNaN(evalSample) || evalSample < 0) {
            console.log(ui.error('--eval-sample must be a non-negative integer'));
            process.exit(1);
          }
          evolveConfig.evalSampleSize = evalSample;

          const sampling = options.sampling ?? 'thompson';
          if (sampling !== 'thompson' && sampling !== 'uniform') {
            console.log(ui.error('--sampling must be "thompson" or "uniform"'));
            process.exit(1);
          }
          evolveConfig.samplingStrategy = sampling;

          const klLambda = parseFloat(options.klLambda ?? '0.1');
          if (isNaN(klLambda) || klLambda < 0) {
            console.log(ui.error('--kl-lambda must be a non-negative number'));
            process.exit(1);
          }
          evolveConfig.klLambda = klLambda;

          if (options.architectEvery) {
            const architectEvery = parseInt(options.architectEvery, 10);
            if (isNaN(architectEvery) || architectEvery < 1) {
              console.log(ui.error('--architect-every must be a positive integer'));
              process.exit(1);
            }
            evolveConfig.architectEvery = architectEvery;
          }

          if (options.schedule) {
            const validSchedules = ['explore-exploit', 'constant', 'adaptive'] as const;
            if (!validSchedules.includes(options.schedule as typeof validSchedules[number])) {
              console.log(chalk.red(`  Invalid schedule: ${options.schedule}. Must be one of: ${validSchedules.join(', ')}`));
              process.exit(1);
            }
            evolveConfig.schedule = options.schedule as typeof evolveConfig.schedule;
          }

          if (options.architectModel) {
            evolveConfig.architectModel = options.architectModel;
          }
        }

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
            case 'task-skipped':
              console.log(chalk.dim(`    SKIP  ${event.taskId ?? 'unknown'} (above prune threshold last iteration)`));
              break;
            case 'task-regression':
              console.log(chalk.yellow(`    DROP  ${event.taskId ?? 'unknown'} ${event.message ?? ''}`));
              break;
            case 'task-scored': {
              const taskScore = event.score ?? 0;
              const taskStatus = taskScore >= 100 ? chalk.green('PASS') : taskScore >= 60 ? chalk.yellow('PARTIAL') : chalk.red('FAIL');
              console.log(`    ${taskStatus}  ${event.taskId ?? 'unknown'} ${chalk.dim(`(${taskScore.toFixed(0)}%)`)}`);
              break;
            }
            case 'architect-start':
              console.log(chalk.magenta('  Architect proposer analyzing structure...'));
              break;
            case 'architect-staging':
              console.log(chalk.dim('  Staging: evaluating architect proposal on full task suite...'));
              break;
            case 'architect-accepted':
              console.log(chalk.green(`  Architect proposal ACCEPTED (${event.score?.toFixed(1)}%)`));
              break;
            case 'architect-rejected':
              console.log(chalk.yellow(`  Architect proposal REJECTED (${event.score?.toFixed(1)}% < best)`));
              break;
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
        const showVariance = evolveConfig.runsPerTask > 1;
        console.log(showVariance
          ? '  Iter  Score        Mutations  Mode       Status'
          : '  Iter  Score     Mutations  Mode       Status');
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
          const mode = (iter.source ?? 'reactive').padEnd(9);
          let status = 'evaluated';
          if (iter.iteration === 0) status = 'baseline';
          else if (!iter.proposal && !iter.diffPatch) status = 'rollback';
          else if (iter.score >= 100) status = 'perfect';
          else if (iter.iteration === result.bestIteration) status = 'best';
          console.log(`  ${iter.iteration.toString().padStart(4)}  ${scoreDisplay}  ${mutStr.padStart(9)}  ${mode}  ${status}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(ui.error(msg));
      process.exit(1);
    }
  });

// --- kairn evolve pbt ---
evolveCommand
  .command('pbt')
  .description('Run Population-Based Training with parallel evolution branches')
  .option('--branches <n>', 'Number of parallel branches', '3')
  .option('--iterations <n>', 'Iterations per branch', '5')
  .option('--parallel <n>', 'Tasks per branch concurrently', '2')
  .option('--sampling <strategy>', 'Task sampling strategy: thompson or uniform', 'thompson')
  .option('--kl-lambda <n>', 'KL regularization strength (0 = disabled)', '0.1')
  .option('--eval-sample <n>', 'Sample N tasks per middle iteration (0 = all)', '5')
  .action(async (options: { branches?: string; iterations?: string; parallel?: string; sampling?: string; klLambda?: string; evalSample?: string }) => {
    try {
      const projectRoot = process.cwd();
      const workspace = path.join(projectRoot, '.kairn-evolve');

      console.log(ui.section('Evolve PBT'));

      // Verify workspace exists
      try {
        await fs.access(workspace);
      } catch {
        console.log(ui.error('No .kairn-evolve/ directory found. Run kairn evolve init first.'));
        process.exit(1);
      }

      // Verify baseline exists
      try {
        await fs.access(path.join(workspace, 'iterations', '0', 'harness'));
      } catch {
        console.log(ui.error('No baseline harness found. Run kairn evolve baseline first.'));
        process.exit(1);
      }

      const kairnConfig = await loadConfig();
      if (!kairnConfig) {
        console.log(ui.error('No config found. Run kairn init first.'));
        process.exit(1);
      }

      const evolveConfig = await loadEvolveConfigFromWorkspace(workspace);

      // Parse options
      const numBranches = parseInt(options.branches ?? '3', 10);
      evolveConfig.maxIterations = parseInt(options.iterations ?? '5', 10);
      evolveConfig.parallelTasks = parseInt(options.parallel ?? '2', 10);
      evolveConfig.evalSampleSize = parseInt(options.evalSample ?? '5', 10);
      evolveConfig.klLambda = parseFloat(options.klLambda ?? '0.1');
      const sampling = options.sampling ?? 'thompson';
      if (sampling === 'thompson' || sampling === 'uniform') {
        evolveConfig.samplingStrategy = sampling;
      }

      // Load tasks
      const tasksPath = path.join(workspace, 'tasks.yaml');
      const tasksContent = await fs.readFile(tasksPath, 'utf-8');
      const parsed = yamlParse(tasksContent) as TasksFile;
      if (!parsed?.tasks || parsed.tasks.length === 0) {
        console.log(ui.error('No tasks found in tasks.yaml'));
        process.exit(1);
      }

      console.log(chalk.dim(`  Branches: ${numBranches}, Iterations: ${evolveConfig.maxIterations}, Parallel: ${evolveConfig.parallelTasks}`));
      console.log(chalk.dim(`  Sampling: ${evolveConfig.samplingStrategy}, KL Lambda: ${evolveConfig.klLambda}`));
      console.log('');

      const { runPopulation } = await import('../evolve/population.js');

      const result = await runPopulation(
        workspace,
        parsed.tasks,
        kairnConfig,
        evolveConfig,
        numBranches,
        (event) => {
          const branchPrefix = event.branchId !== undefined ? chalk.dim(`[branch ${event.branchId}] `) : '';
          switch (event.type) {
            case 'iteration-start':
              console.log(`${branchPrefix}${ui.section(`Iteration ${event.iteration}`)}`);
              break;
            case 'iteration-scored': {
              const scoreColor = event.score !== undefined && event.score >= 100
                ? chalk.green
                : event.score !== undefined && event.score >= 60
                  ? chalk.yellow
                  : chalk.red;
              console.log(`${branchPrefix}  Score: ${scoreColor((event.score?.toFixed(1) ?? '0') + '%')}`);
              break;
            }
            case 'complete':
              break;
            default:
              if (event.message) {
                console.log(`${branchPrefix}  ${chalk.dim(event.message)}`);
              }
              break;
          }
        },
      );

      // Print PBT summary
      console.log(ui.section('PBT Results'));
      for (const branch of result.branches) {
        const marker = branch.branchId === result.bestBranch ? chalk.green(' <- BEST') : '';
        console.log(`  Branch ${branch.branchId}:  ${branch.result.bestScore.toFixed(1)}%  (${branch.result.iterations.length} iterations)${marker}`);
      }
      if (result.synthesizedResult) {
        const synthMarker = result.synthesizedResult.bestScore > result.bestScore ? chalk.green(' <- BEST') : '';
        console.log(`  ${'─'.repeat(40)}`);
        console.log(`  Meta-Principal: ${result.synthesizedResult.bestScore.toFixed(1)}%${synthMarker}`);
      }
      console.log('');
      console.log(ui.success(`Best: Branch ${result.bestBranch} with ${result.bestScore.toFixed(1)}%`));
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
  .option('--pbt', 'Apply best PBT result (branch winner or synthesis)')
  .option('--force', 'Apply even if git working tree is dirty')
  .option('--no-commit', 'Skip automatic git commit after applying')
  .action(async (options: { iter?: string; pbt?: boolean; force?: boolean; commit?: boolean }) => {
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

      const result = await applyEvolution(workspace, projectRoot, targetIteration, options.pbt);

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

// --- kairn evolve research ---
evolveCommand
  .command('research')
  .description('Run cross-repo research to discover convergent evolution patterns')
  .requiredOption('--repos <urls>', 'GitHub repo URLs (comma-separated)')
  .option('--iterations <n>', 'Iterations per repo', '10')
  .option('--threshold <n>', 'Convergence threshold (0.0-1.0)', '0.5')
  .option('--output <path>', 'Write research report to file')
  .action(async (options: { repos: string; iterations?: string; threshold?: string; output?: string }) => {
    try {
      const config = await loadConfig();
      if (!config) {
        console.log(chalk.red('  No config found. Run `kairn init` first.'));
        process.exit(1);
      }

      const repos = options.repos.split(',').map(r => r.trim());
      const iterationsPerRepo = parseInt(options.iterations ?? '10', 10);
      const convergenceThreshold = parseFloat(options.threshold ?? '0.5');

      if (isNaN(iterationsPerRepo) || iterationsPerRepo < 1) {
        console.log(ui.error('--iterations must be a positive integer'));
        process.exit(1);
      }
      if (isNaN(convergenceThreshold) || convergenceThreshold < 0 || convergenceThreshold > 1) {
        console.log(ui.error('--threshold must be between 0.0 and 1.0'));
        process.exit(1);
      }

      console.log(chalk.cyan(`\n  Starting research across ${repos.length} repositories\n`));

      const { runResearch, formatResearchReport } = await import('../evolve/research.js');

      const researchConfig = {
        repos,
        iterationsPerRepo,
        convergenceThreshold,
        outputPath: options.output,
      };

      const evolveConfig = { ...DEFAULT_CONFIG };

      const report = await runResearch(
        researchConfig,
        config,
        evolveConfig,
        (event) => {
          switch (event.type) {
            case 'repo-start':
              console.log(chalk.cyan(`  [${(event.repoIndex ?? 0) + 1}/${event.totalRepos}] ${event.message}`));
              break;
            case 'repo-complete':
              console.log(chalk.dim(`  [${(event.repoIndex ?? 0) + 1}/${event.totalRepos}] ${event.message}`));
              break;
            case 'convergence-analysis':
              console.log(chalk.magenta(`\n  ${event.message}`));
              break;
            case 'research-complete':
              console.log(chalk.green(`\n  ${event.message}`));
              break;
          }
        },
      );

      const reportText = formatResearchReport(report);
      console.log('\n' + reportText);

      if (options.output) {
        await fs.writeFile(options.output, reportText, 'utf-8');
        console.log(chalk.green(`\n  Report saved to ${options.output}`));
      }

      console.log(chalk.cyan(`\n  Summary: ${report.universal.length} universal, ${Object.values(report.languageSpecific).flat().length} language-specific, ${report.failed.length} failed patterns\n`));
    } catch (err) {
      console.log(chalk.red(`\n  Research failed: ${err instanceof Error ? err.message : String(err)}\n`));
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
