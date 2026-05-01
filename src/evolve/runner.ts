import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { copyDir } from './baseline.js';
import { writeTrace } from './trace.js';
import { scoreTask } from './scorers.js';
import type { KairnConfig } from '../types.js';
import type { Task, TaskResult, Trace, Score, LoopProgressEvent } from './types.js';

const execAsync = promisify(exec);

/** Directories to skip when copying the project directory as fallback. */
const COPY_SKIP_DIRS = new Set(['.git', 'node_modules', '.kairn-evolve', '.claude']);

export interface RunTaskOptions {
  projectRoot?: string;
  config?: KairnConfig | null;
}

function normalizeRunTaskOptions(options?: string | RunTaskOptions): RunTaskOptions {
  if (typeof options === 'string') {
    return { projectRoot: options };
  }
  return options ?? {};
}

/**
 * Copy .mcp.json from the harness into the workspace root if present.
 */
async function deployMcpJson(harnessPath: string, workDir: string): Promise<void> {
  const src = path.join(harnessPath, '.mcp.json');
  await fs.copyFile(src, path.join(workDir, '.mcp.json')).catch(() => {});
}

/**
 * Create an isolated workspace with project files and a swapped harness.
 * Tries git worktree first for speed and proper isolation.
 * Falls back to copying the project directory if not in a git repo.
 */
async function createIsolatedWorkspace(
  projectRoot: string,
  harnessPath: string,
): Promise<{ workDir: string; isWorktree: boolean }> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Try git worktree first
  try {
    await execAsync('git rev-parse --is-inside-work-tree', {
      cwd: projectRoot,
      timeout: 5000,
    });
    const tmpDir = path.join(os.tmpdir(), `kairn-evolve-wt-${suffix}`);
    await execAsync(`git worktree add --detach "${tmpDir}" HEAD`, {
      cwd: projectRoot,
      timeout: 30_000,
    });
    // Replace .claude with iteration harness
    await fs.rm(path.join(tmpDir, '.claude'), { recursive: true, force: true });
    await copyDir(harnessPath, path.join(tmpDir, '.claude'));
    await deployMcpJson(harnessPath, tmpDir);
    return { workDir: tmpDir, isWorktree: true };
  } catch {
    // Not a git repo or worktree creation failed — fall back to copy
  }

  // Fallback: copy project directory (skip large/irrelevant dirs)
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `kairn-evolve-cp-`));
  await copyProjectDir(projectRoot, tmpDir);
  await fs.rm(path.join(tmpDir, '.claude'), { recursive: true, force: true });
  await copyDir(harnessPath, path.join(tmpDir, '.claude'));
  await deployMcpJson(harnessPath, tmpDir);
  return { workDir: tmpDir, isWorktree: false };
}

/**
 * Copy project directory to dest, skipping .git, node_modules, .kairn-evolve, .claude.
 */
async function copyProjectDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  let entries;
  try {
    entries = await fs.readdir(src, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (COPY_SKIP_DIRS.has(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Clean up an isolated workspace.
 */
async function cleanupIsolatedWorkspace(
  workDir: string,
  isWorktree: boolean,
  projectRoot: string,
): Promise<void> {
  if (isWorktree) {
    try {
      await execAsync(`git worktree remove "${workDir}" --force`, {
        cwd: projectRoot,
        timeout: 10_000,
      });
    } catch {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      await execAsync('git worktree prune', {
        cwd: projectRoot,
        timeout: 5000,
      }).catch(() => {});
    }
  } else {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Run a single task against a harness in an isolated workspace.
 *
 * 1. Creates isolated workspace (git worktree or project copy)
 * 2. Swaps .claude/ with the iteration's harness
 * 3. Runs task.setup commands
 * 4. Spawns `claude` CLI with --print flag
 * 5. Captures stdout, stderr, files changed
 * 6. Scores the task while the modified workspace still exists
 * 7. Writes all trace files
 * 8. Cleans up workspace
 *
 * @param projectRoot - Root directory of the project (contains package.json, src/, etc.)
 */
export async function runTask(
  task: Task,
  harnessPath: string,
  traceDir: string,
  iteration: number,
  options?: string | RunTaskOptions,
): Promise<TaskResult> {
  await fs.mkdir(traceDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const { projectRoot, config } = normalizeRunTaskOptions(options);
  const root = projectRoot ?? process.cwd();
  const { workDir, isWorktree } = await createIsolatedWorkspace(root, harnessPath);

  try {
    // Run setup commands if any
    // Trust boundary: setup commands come from tasks.yaml which is user-reviewed
    // before execution. The user is the trust anchor for these commands.
    let setupStderr = '';
    if (task.setup.trim()) {
      try {
        await execAsync(task.setup, { cwd: workDir, timeout: 60_000 });
      } catch (err) {
        setupStderr =
          err instanceof Error ? err.message : String(err);
      }
    }

    // Snapshot file list before execution for diffing
    const filesBefore = await snapshotFileList(workDir);

    // Spawn claude CLI
    const spawnResult = await spawnClaude(task.description, workDir, task.timeout);

    // Diff files to detect changes
    const filesAfter = await snapshotFileList(workDir);
    const filesChanged = diffFileLists(filesBefore, filesAfter);

    // Parse tool calls from JSON output (if available)
    const toolCalls = parseToolCalls(spawnResult.stdout);

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;

    // Build trace
    const combinedStderr = setupStderr
      ? `[setup] ${setupStderr}\n${spawnResult.stderr}`
      : spawnResult.stderr;

    const score = config
      ? await scoreTask(task, workDir, spawnResult.stdout, combinedStderr, config)
      : { pass: false, details: 'Pending scoring' };

    const trace: Trace = {
      taskId: task.id,
      iteration,
      stdout: spawnResult.stdout,
      stderr: combinedStderr,
      toolCalls,
      filesChanged,
      score,
      timing: { startedAt, completedAt, durationMs },
    };

    // Write trace files after scoring so score.json is final before cleanup.
    await writeTrace(traceDir, trace);

    return {
      taskId: task.id,
      score,
      traceDir,
    };
  } finally {
    await cleanupIsolatedWorkspace(workDir, isWorktree, root);
  }
}

/**
 * Spawn the claude CLI with --print flag and capture output.
 */
export async function spawnClaude(
  instruction: string,
  cwd: string,
  timeoutSec: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const args = ['--print', '--output-format', 'text', '--max-turns', '50', '--dangerously-skip-permissions'];
    const child = spawn('claude', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutSec * 1000,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Send the instruction via stdin
    child.stdin.write(instruction);
    child.stdin.end();

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on('error', (err) => {
      resolve({
        stdout,
        stderr: stderr + `\nSpawn error: ${err.message}`,
        exitCode: 1,
      });
    });
  });
}

/**
 * Snapshot all file paths + mtimes in a directory recursively.
 * Used for before/after diffing to detect file changes.
 */
export async function snapshotFileList(
  dir: string,
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(dir, fullPath);

      // Skip .claude directory (that's the harness, not task output)
      if (relativePath.startsWith('.claude')) continue;
      // Skip node_modules
      if (relativePath.startsWith('node_modules')) continue;
      // Skip .git
      if (relativePath.startsWith('.git')) continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        try {
          const stat = await fs.stat(fullPath);
          result[relativePath] = stat.mtimeMs;
        } catch {
          // File might have been deleted between readdir and stat
        }
      }
    }
  }

  await walk(dir);
  return result;
}

/**
 * Compare before/after file snapshots to determine what changed.
 */
export function diffFileLists(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, 'created' | 'modified' | 'deleted'> {
  const changes: Record<string, 'created' | 'modified' | 'deleted'> = {};

  // Check for new and modified files
  for (const [file, mtime] of Object.entries(after)) {
    if (!(file in before)) {
      changes[file] = 'created';
    } else if (before[file] !== mtime) {
      changes[file] = 'modified';
    }
  }

  // Check for deleted files
  for (const file of Object.keys(before)) {
    if (!(file in after)) {
      changes[file] = 'deleted';
    }
  }

  return changes;
}

/**
 * Try to parse tool calls from claude output.
 * Looks for JSON lines containing tool_use type or tool_name field.
 * Falls back to empty array if output is plain text.
 */
export function parseToolCalls(stdout: string): unknown[] {
  try {
    const lines = stdout.split('\n').filter((l) => l.trim());
    const toolCalls: unknown[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.type === 'tool_use' || obj.tool_name) {
          toolCalls.push(obj);
        }
      } catch {
        // Not JSON, skip
      }
    }
    return toolCalls;
  } catch {
    return [];
  }
}

/**
 * Run async tasks with a concurrency limit.
 * Returns results in the same order as the input tasks array.
 */
export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const executing = new Set<Promise<void>>();
  const errors: unknown[] = [];
  const effectiveLimit = Math.max(1, limit);

  for (let i = 0; i < tasks.length; i++) {
    const p = tasks[i]().then(
      (result) => { results[i] = result; },
      (err) => { errors.push(err); },
    );
    const tracked = p.then(() => { executing.delete(tracked); });
    executing.add(tracked);
    if (executing.size >= effectiveLimit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);

  if (errors.length > 0) {
    throw errors[0];
  }

  return results;
}

/**
 * Compute population standard deviation for a list of numbers.
 *
 * Uses population stddev (divide by N) rather than sample stddev (divide by N-1).
 * For typical run counts (3-5), this slightly underestimates variance compared
 * to sample stddev, but is consistent with reporting the observed spread of
 * the actual runs performed rather than estimating the population parameter.
 */
function computeStddev(values: number[], mean: number): number {
  if (values.length <= 1) return 0;
  const sumSqDiffs = values.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  return Math.sqrt(sumSqDiffs / values.length);
}

/**
 * Run all tasks against a harness and return aggregated results.
 *
 * Each task is run sequentially via `runTask`, scored (optionally via
 * `scoreTask` when a `KairnConfig` is provided), and its score written
 * to the trace directory.
 *
 * The aggregate score is the arithmetic mean of all task scores.
 * For scores that have a numeric `score` field, that value is used directly.
 * For pass/fail scores without a numeric value, `pass=true` counts as 100
 * and `pass=false` counts as 0.
 */
export async function evaluateAll(
  tasks: Task[],
  harnessPath: string,
  workspacePath: string,
  iteration: number,
  config: KairnConfig | null,
  onProgress?: (event: LoopProgressEvent) => void,
  runsPerTask: number = 1,
  parallelTasks: number = 1,
): Promise<{ results: Record<string, Score>; aggregate: number }> {
  const results: Record<string, Score> = {};
  const projectRoot = path.resolve(workspacePath, '..');
  const effectiveRuns = Math.max(1, runsPerTask);
  const concurrency = Math.max(1, parallelTasks);

  const evaluateTask = async (task: Task): Promise<{ id: string; score: Score }> => {
    onProgress?.({ type: 'task-start', iteration, taskId: task.id });

    let finalScore: Score;

    if (effectiveRuns > 1 && config) {
      const runScores: number[] = [];
      let passCount = 0;

      for (let run = 0; run < effectiveRuns; run++) {
        const traceDir = path.join(
          workspacePath,
          'traces',
          iteration.toString(),
          `${task.id}_run${run}`,
        );

        onProgress?.({
          type: 'task-run',
          iteration,
          taskId: task.id,
          message: `Run ${run + 1}/${effectiveRuns} of ${task.id}`,
        });

        const { score } = await runTask(
          task,
          harnessPath,
          traceDir,
          iteration,
          { projectRoot, config },
        );

        runScores.push(score.score ?? (score.pass ? 100 : 0));
        if (score.pass) passCount++;
      }

      const mean = runScores.reduce((a, b) => a + b, 0) / runScores.length;
      const stddev = computeStddev(runScores, mean);

      finalScore = {
        pass: passCount > effectiveRuns / 2,
        score: mean,
        details: `Mean of ${effectiveRuns} runs`,
        variance: {
          runs: effectiveRuns,
          scores: runScores,
          mean,
          stddev,
        },
      };
    } else {
      const traceDir = path.join(
        workspacePath,
        'traces',
        iteration.toString(),
        task.id,
      );

      const taskResult = await runTask(
        task,
        harnessPath,
        traceDir,
        iteration,
        { projectRoot, config },
      );

      finalScore = taskResult.score;
    }

    onProgress?.({
      type: 'task-scored',
      iteration,
      taskId: task.id,
      score: finalScore.score ?? (finalScore.pass ? 100 : 0),
    });

    return { id: task.id, score: finalScore };
  };

  const taskResults = await runWithConcurrency(
    tasks.map((task) => () => evaluateTask(task)),
    concurrency,
  );

  for (const { id, score } of taskResults) {
    results[id] = score;
  }

  const scores = Object.values(results);
  const total = scores.reduce(
    (sum, s) => sum + (s.score ?? (s.pass ? 100 : 0)),
    0,
  );
  const aggregate = scores.length > 0 ? total / scores.length : 0;

  return { results, aggregate };
}
