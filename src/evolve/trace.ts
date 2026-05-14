import fs from 'fs/promises';
import path from 'path';
import type { Trace, Score, IterationLog, Proposal } from './types.js';
import { aggregateTelemetry, unavailableTelemetry } from './cost.js';

export type TracePhase =
  | 'evaluation'
  | 'architect-staging'
  | 'canary'
  | 'rerun';

export interface TraceNamespace {
  phase: TracePhase;
  harnessId: string;
  attemptId?: string;
}

export interface LoadIterationTracesOptions {
  phase?: TracePhase;
  harnessId?: string;
  attemptId?: string;
}

function sanitizeTraceSegment(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new Error(`Invalid trace path segment: ${value}`);
  }
  return sanitized;
}

export function buildTraceDir(
  workspacePath: string,
  iteration: number,
  taskId: string,
  namespace: TraceNamespace,
): string {
  const segments = [
    workspacePath,
    'traces',
    iteration.toString(),
    sanitizeTraceSegment(namespace.phase),
    sanitizeTraceSegment(namespace.harnessId),
  ];

  if (namespace.attemptId) {
    segments.push(sanitizeTraceSegment(namespace.attemptId));
  }

  segments.push(sanitizeTraceSegment(taskId));
  return path.join(...segments);
}

function iterationFromTraceDir(traceDir: string): number {
  const parts = traceDir.split(path.sep);
  const tracesIndex = parts.lastIndexOf('traces');
  if (tracesIndex >= 0 && parts[tracesIndex + 1]) {
    const parsed = parseInt(parts[tracesIndex + 1], 10);
    if (!isNaN(parsed)) return parsed;
  }

  const parentDir = path.basename(path.dirname(traceDir));
  return parseInt(parentDir, 10) || 0;
}

async function hasTracePayload(traceDir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(traceDir, 'stdout.log'));
    return stat.isFile();
  } catch {
    return false;
  }
}

function traceDirMatchesOptions(
  tracesDir: string,
  traceDir: string,
  options: LoadIterationTracesOptions,
): boolean {
  if (!options.phase && !options.harnessId && !options.attemptId) return true;

  const relativeParts = path.relative(tracesDir, traceDir).split(path.sep);
  const [phase, harnessId, maybeAttemptId] = relativeParts;

  if (options.phase && phase !== options.phase) return false;
  if (options.harnessId && harnessId !== options.harnessId) return false;
  if (options.attemptId && maybeAttemptId !== options.attemptId) return false;

  return true;
}

async function collectTraceDirs(
  dir: string,
  tracesDir: string,
  options: LoadIterationTracesOptions,
  result: string[],
): Promise<void> {
  if (await hasTracePayload(dir)) {
    if (traceDirMatchesOptions(tracesDir, dir, options)) {
      result.push(dir);
    }
    return;
  }

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      await collectTraceDirs(path.join(dir, entry.name), tracesDir, options, result);
    }
  }
}

/**
 * Load a trace from filesystem.
 * Parses tool_calls.jsonl (one JSON object per line) and extracts
 * the iteration number from the trace namespace path.
 */
export async function loadTrace(traceDir: string): Promise<Trace> {
  const stdout = await fs.readFile(path.join(traceDir, 'stdout.log'), 'utf-8').catch(() => '');
  const stderr = await fs.readFile(path.join(traceDir, 'stderr.log'), 'utf-8').catch(() => '');
  const filesChangedStr = await fs.readFile(
    path.join(traceDir, 'files_changed.json'),
    'utf-8',
  ).catch(() => '{}');
  const timingStr = await fs.readFile(
    path.join(traceDir, 'timing.json'),
    'utf-8',
  ).catch(() => '{}');
  const telemetryStr = await fs.readFile(
    path.join(traceDir, 'telemetry.json'),
    'utf-8',
  ).catch(() => '');
  const scoreStr = await fs.readFile(
    path.join(traceDir, 'score.json'),
    'utf-8',
  ).catch(() => '{"pass": false}');

  // Parse tool_calls.jsonl — one JSON object per line
  const toolCallsStr = await fs.readFile(
    path.join(traceDir, 'tool_calls.jsonl'),
    'utf-8',
  ).catch(() => '');
  const toolCalls = toolCallsStr
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as unknown);

  const iteration = iterationFromTraceDir(traceDir);
  const timing = JSON.parse(timingStr) as Trace['timing'];
  const telemetry = telemetryStr
    ? JSON.parse(telemetryStr) as NonNullable<Trace['telemetry']>
    : unavailableTelemetry(
      'task-execution',
      'unknown',
      timing.durationMs ?? 0,
      'Trace was written before telemetry fields existed',
    );

  return {
    taskId: path.basename(traceDir),
    iteration,
    telemetry,
    usage: telemetry.usage,
    cost: telemetry.cost,
    model: telemetry.model,
    phase: telemetry.phase,
    durationMs: telemetry.durationMs,
    stdout,
    stderr,
    toolCalls,
    filesChanged: JSON.parse(filesChangedStr) as Record<string, 'created' | 'modified' | 'deleted'>,
    score: JSON.parse(scoreStr) as Trace['score'],
    timing,
  };
}

/**
 * Load all traces for an iteration.
 */
export async function loadIterationTraces(
  workspacePath: string,
  iteration: number,
  options: LoadIterationTracesOptions = {},
): Promise<Trace[]> {
  const tracesDir = path.join(workspacePath, 'traces', iteration.toString());
  const traces: Trace[] = [];

  const traceDirs: string[] = [];
  await collectTraceDirs(tracesDir, tracesDir, options, traceDirs);

  for (const traceDir of traceDirs.sort()) {
    try {
      const trace = await loadTrace(traceDir);
      traces.push(trace);
    } catch {
      // Skip malformed trace directories so report generation can continue.
    }
  }

  return traces;
}

/**
 * Write all trace files to the given directory.
 * Writes stdout.log, stderr.log, tool_calls.jsonl, files_changed.json,
 * timing.json, and score.json.
 */
export async function writeTrace(traceDir: string, trace: Trace): Promise<void> {
  await fs.mkdir(traceDir, { recursive: true });
  await fs.writeFile(path.join(traceDir, 'stdout.log'), trace.stdout, 'utf-8');
  await fs.writeFile(path.join(traceDir, 'stderr.log'), trace.stderr, 'utf-8');

  // Write tool_calls.jsonl — one JSON object per line
  const toolCallsLines = trace.toolCalls
    .map(tc => JSON.stringify(tc))
    .join('\n');
  await fs.writeFile(path.join(traceDir, 'tool_calls.jsonl'), toolCallsLines, 'utf-8');

  await fs.writeFile(
    path.join(traceDir, 'files_changed.json'),
    JSON.stringify(trace.filesChanged, null, 2),
    'utf-8',
  );
  await fs.writeFile(
    path.join(traceDir, 'timing.json'),
    JSON.stringify(trace.timing, null, 2),
    'utf-8',
  );
  await fs.writeFile(
    path.join(traceDir, 'telemetry.json'),
    JSON.stringify(
      trace.telemetry ?? unavailableTelemetry(
        'task-execution',
        'unknown',
        trace.timing.durationMs,
        'Trace telemetry was not provided by caller',
      ),
      null,
      2,
    ),
    'utf-8',
  );
  await fs.writeFile(
    path.join(traceDir, 'score.json'),
    JSON.stringify(trace.score, null, 2),
    'utf-8',
  );
}

/**
 * Write or overwrite only the score.json file in an existing trace directory.
 * Used to update the score after scoring runs separately from trace capture.
 */
export async function writeScore(traceDir: string, score: Score): Promise<void> {
  await fs.writeFile(
    path.join(traceDir, 'score.json'),
    JSON.stringify(score, null, 2),
    'utf-8',
  );
}

/**
 * Check whether a trace directory has been populated.
 * Returns true if stdout.log exists inside traceDir.
 */
export async function traceExists(traceDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(traceDir, 'stdout.log'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Write iteration log files to .kairn-evolve/iterations/{N}/.
 * Creates: scores.json, proposer_reasoning.md, mutation_diff.patch
 */
export async function writeIterationLog(
  workspacePath: string,
  log: IterationLog,
): Promise<void> {
  const iterDir = path.join(workspacePath, 'iterations', log.iteration.toString());
  await fs.mkdir(iterDir, { recursive: true });
  const telemetry = log.telemetry ?? unavailableTelemetry(
    'iteration',
    'unknown',
    0,
    'Iteration telemetry was not provided by caller',
  );
  log.telemetry = telemetry;
  log.usage = telemetry.usage;
  log.cost = telemetry.cost;
  log.model = telemetry.model;
  log.phase = telemetry.phase;
  log.durationMs = telemetry.durationMs;

  // Write scores (include source field for architect/reactive tracking)
  await fs.writeFile(
    path.join(iterDir, 'scores.json'),
    JSON.stringify({
      score: log.score,
      taskResults: log.taskResults,
      telemetry,
      usage: telemetry.usage,
      cost: telemetry.cost,
      model: telemetry.model,
      phase: telemetry.phase,
      durationMs: telemetry.durationMs,
      ...(log.source ? { source: log.source } : {}),
    }, null, 2),
    'utf-8',
  );

  // Write proposer reasoning
  await fs.writeFile(
    path.join(iterDir, 'proposer_reasoning.md'),
    log.proposal?.reasoning ?? 'Baseline evaluation (no proposal)',
    'utf-8',
  );

  // Write mutation diff
  await fs.writeFile(
    path.join(iterDir, 'mutation_diff.patch'),
    log.diffPatch ?? '',
    'utf-8',
  );
}

/**
 * Load an iteration log from .kairn-evolve/iterations/{N}/.
 * Returns null if the iteration directory doesn't exist.
 */
export async function loadIterationLog(
  workspacePath: string,
  iteration: number,
): Promise<IterationLog | null> {
  const iterDir = path.join(workspacePath, 'iterations', iteration.toString());

  try {
    await fs.access(iterDir);
  } catch {
    return null;
  }

  const scoresStr = await fs.readFile(path.join(iterDir, 'scores.json'), 'utf-8').catch(() => '{}');
  const reasoning = await fs.readFile(path.join(iterDir, 'proposer_reasoning.md'), 'utf-8').catch(() => '');
  const diffPatch = await fs.readFile(path.join(iterDir, 'mutation_diff.patch'), 'utf-8').catch(() => '');

  const scoresData = JSON.parse(scoresStr) as {
    score?: number;
    taskResults?: Record<string, Score>;
    telemetry?: IterationLog['telemetry'];
    usage?: IterationLog['usage'];
    cost?: IterationLog['cost'];
    model?: string;
    phase?: string;
    durationMs?: number;
    source?: 'reactive' | 'architect';
  };
  const telemetry = scoresData.telemetry ?? aggregateTelemetry(
    [],
    'iteration',
    scoresData.model ?? 'unknown',
  );

  const proposal: Proposal | null = reasoning
    ? { reasoning, mutations: [], expectedImpact: {} }
    : null;

  return {
    iteration,
    score: scoresData.score ?? 0,
    taskResults: scoresData.taskResults ?? {},
    telemetry,
    usage: scoresData.usage ?? telemetry.usage,
    cost: scoresData.cost ?? telemetry.cost,
    model: scoresData.model ?? telemetry.model,
    phase: scoresData.phase ?? telemetry.phase,
    durationMs: scoresData.durationMs ?? telemetry.durationMs,
    proposal,
    diffPatch: diffPatch || null,
    timestamp: '',
    ...(scoresData.source ? { source: scoresData.source } : {}),
  };
}
