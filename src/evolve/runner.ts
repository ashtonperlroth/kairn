import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { copyDir } from './baseline.js';
import { writeTrace } from './trace.js';
import { scoreTask } from './scorers.js';
import { aggregateTelemetry, estimateCost, estimateTelemetry } from './cost.js';
import type { KairnConfig } from '../types.js';
import type { Task, TaskResult, Trace, Score, LoopProgressEvent, SpawnResult } from './types.js';
import type { EvolveTelemetry } from './cost.js';

const execAsync = promisify(exec);

/** Directories to skip when copying the project directory as fallback. */
const COPY_SKIP_DIRS = new Set(['.git', 'node_modules', '.kairn-evolve', '.claude']);

export interface RunTaskOptions {
  projectRoot?: string;
  config?: KairnConfig | null;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
}

export interface SpawnClaudeOptions {
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  outputFormat?: 'text' | 'json' | 'stream-json';
}

interface ParsedClaudeOutput {
  text: string;
  toolCalls: unknown[];
  usage?: EvolveTelemetry['usage'];
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
  legacyModel = 'claude-code',
): Promise<TaskResult> {
  await fs.mkdir(traceDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const { projectRoot, config, maxTurns, maxBudgetUsd } = normalizeRunTaskOptions(options);
  const model = config?.model ?? (typeof options === 'object' ? options.model : undefined) ?? legacyModel;
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
    const spawnResult = await spawnClaude(task.description, workDir, task.timeout, {
      model,
      maxTurns,
      maxBudgetUsd,
    });

    // Diff files to detect changes
    const filesAfter = await snapshotFileList(workDir);
    const filesChanged = diffFileLists(filesBefore, filesAfter);

    const toolCalls = spawnResult.toolCalls;

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;
    const telemetry = spawnResult.usage
      ? telemetryFromActualUsage(model, durationMs, spawnResult.usage)
      : estimateTelemetry({
          phase: 'task-execution',
          model,
          durationMs,
          inputText: task.description,
          outputText: `${spawnResult.stdout}\n${spawnResult.stderr}`,
          source: 'claude-cli-text-estimate',
        });

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
      telemetry,
      usage: telemetry.usage,
      cost: telemetry.cost,
      model: telemetry.model,
      phase: telemetry.phase,
      durationMs,
    };

    // Write trace files after scoring so score.json is final before cleanup.
    await writeTrace(traceDir, trace);

    return {
      taskId: task.id,
      score,
      traceDir,
      telemetry,
      usage: telemetry.usage,
      cost: telemetry.cost,
      model: telemetry.model,
      phase: telemetry.phase,
      durationMs,
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
  options: SpawnClaudeOptions = {},
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const outputFormat = options.outputFormat ?? 'stream-json';
    const maxTurns = Number.isFinite(options.maxTurns) && options.maxTurns && options.maxTurns > 0
      ? Math.floor(options.maxTurns)
      : 50;
    const args = [
      '--print',
      '--output-format',
      outputFormat,
      '--max-turns',
      String(maxTurns),
    ];
    if (options.model?.trim()) {
      args.push('--model', options.model.trim());
    }
    if (Number.isFinite(options.maxBudgetUsd) && options.maxBudgetUsd && options.maxBudgetUsd > 0) {
      args.push('--max-budget-usd', formatBudgetUsd(options.maxBudgetUsd));
    }
    args.push('--dangerously-skip-permissions');

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
      const parsed = parseClaudeOutput(stdout);
      resolve({
        stdout: parsed.text,
        rawStdout: stdout,
        stderr,
        exitCode: code ?? 1,
        toolCalls: parsed.toolCalls,
        usage: parsed.usage,
      });
    });

    child.on('error', (err) => {
      const parsed = parseClaudeOutput(stdout);
      resolve({
        stdout: parsed.text,
        rawStdout: stdout,
        stderr: stderr + `\nSpawn error: ${err.message}`,
        exitCode: 1,
        toolCalls: parsed.toolCalls,
        usage: parsed.usage,
      });
    });
  });
}

function formatBudgetUsd(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function telemetryFromActualUsage(
  model: string,
  durationMs: number,
  usage: EvolveTelemetry['usage'],
): EvolveTelemetry {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return {
    phase: 'task-execution',
    model,
    durationMs,
    usage,
    cost: {
      status: 'estimated',
      estimatedUSD: estimateCost(inputTokens, outputTokens, model),
      currency: 'USD',
      source: 'src/evolve/cost.ts',
      reason: 'Estimated from actual Claude Code token usage and configured model pricing',
    },
  };
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
 * Parse Claude Code structured output while preserving plain text fallback.
 * Supports both single JSON result output and stream-json/JSONL events.
 */
export function parseClaudeOutput(stdout: string): ParsedClaudeOutput {
  const parsed = parseJsonRecords(stdout);
  if (parsed.length === 0) {
    return { text: stdout, toolCalls: [] };
  }

  const toolCalls = parsed.flatMap((record) => collectToolCalls(record));
  const text = extractFinalText(parsed) ?? stdout;
  const usage = extractUsage(parsed);

  return usage ? { text, toolCalls, usage } : { text, toolCalls };
}

/**
 * Try to parse tool calls from claude output.
 * Falls back to empty array if output is plain text.
 */
export function parseToolCalls(stdout: string): unknown[] {
  return parseClaudeOutput(stdout).toolCalls;
}

function parseJsonRecords(stdout: string): unknown[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  try {
    return [JSON.parse(trimmed) as unknown];
  } catch {
    // Not a single JSON document; try newline-delimited JSON records.
  }

  const records: unknown[] = [];
  for (const line of stdout.split('\n')) {
    const candidate = line.trim();
    if (!candidate) continue;
    try {
      records.push(JSON.parse(candidate) as unknown);
    } catch {
      // Legacy text or log line mixed into JSONL output.
    }
  }
  return records;
}

function collectToolCalls(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectToolCalls(item));
  }
  if (!isRecord(value)) return [];

  const nested = Object.values(value).flatMap((item) => collectToolCalls(item));
  if (isToolCall(value)) {
    return [value, ...nested];
  }
  return nested;
}

function isToolCall(value: Record<string, unknown>): boolean {
  return (
    value['type'] === 'tool_use'
    || typeof value['tool_name'] === 'string'
    || (typeof value['name'] === 'string' && isRecord(value['input']))
  );
}

function extractFinalText(records: unknown[]): string | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const directResult = readStringPath(records[i], ['result']);
    if (directResult) return directResult;

    const directText = readStringPath(records[i], ['text'])
      ?? readStringPath(records[i], ['content']);
    if (directText) return directText;

    const messageText = extractMessageText(records[i]);
    if (messageText) return messageText;
  }

  const textBlocks = records
    .flatMap((record) => collectTextBlocks(record))
    .filter((text) => text.trim());
  return textBlocks.length > 0 ? textBlocks.join('\n') : undefined;
}

function extractMessageText(value: unknown): string | undefined {
  const messageContent = readPath(value, ['message', 'content']);
  if (!Array.isArray(messageContent)) return undefined;

  const text = messageContent
    .flatMap((item) => collectTextBlocks(item))
    .filter((line) => line.trim())
    .join('\n');
  return text || undefined;
}

function collectTextBlocks(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextBlocks(item));
  }
  if (!isRecord(value)) return [];

  if (value['type'] === 'text' && typeof value['text'] === 'string') {
    return [value['text']];
  }

  return Object.values(value).flatMap((item) => collectTextBlocks(item));
}

function extractUsage(records: unknown[]): EvolveTelemetry['usage'] | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const usage = usageFromRecord(readPath(records[i], ['usage']) ?? records[i]);
    if (usage) return usage;

    const messageUsage = usageFromRecord(readPath(records[i], ['message', 'usage']));
    if (messageUsage) return messageUsage;
  }
  return undefined;
}

function usageFromRecord(value: unknown): EvolveTelemetry['usage'] | undefined {
  if (!isRecord(value)) return undefined;

  const directInput = readNumber(value, 'input_tokens') ?? readNumber(value, 'inputTokens');
  const cacheCreation = readNumber(value, 'cache_creation_input_tokens') ?? 0;
  const cacheRead = readNumber(value, 'cache_read_input_tokens') ?? 0;
  const output = readNumber(value, 'output_tokens') ?? readNumber(value, 'outputTokens');

  if (directInput === undefined && output === undefined && cacheCreation === 0 && cacheRead === 0) {
    return undefined;
  }

  const inputTokens = (directInput ?? 0) + cacheCreation + cacheRead;
  const outputTokens = output ?? 0;
  return {
    status: 'actual',
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: 'claude-cli-json',
  };
}

function readPath(value: unknown, pathParts: string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function readStringPath(value: unknown, pathParts: string[]): string | undefined {
  const result = readPath(value, pathParts);
  return typeof result === 'string' && result.trim() ? result : undefined;
}

function readNumber(value: Record<string, unknown>, key: string): number | undefined {
  const raw = value[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
): Promise<{ results: Record<string, Score>; aggregate: number; telemetry?: EvolveTelemetry }> {
  const results: Record<string, Score> = {};
  const telemetryEntries: NonNullable<TaskResult['telemetry']>[] = [];
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

        const taskResult = await runTask(
          task,
          harnessPath,
          traceDir,
          iteration,
          { projectRoot, config },
        );
        if (taskResult.telemetry) telemetryEntries.push(taskResult.telemetry);
        const score = taskResult.score;

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
      if (taskResult.telemetry) telemetryEntries.push(taskResult.telemetry);

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

  return {
    results,
    aggregate,
    telemetry: aggregateTelemetry(telemetryEntries, 'iteration', config?.model ?? 'claude-code'),
  };
}
