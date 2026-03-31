import fs from 'fs/promises';
import path from 'path';
import type { Trace } from './types.js';

/**
 * Load a trace from filesystem.
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
  const scoreStr = await fs.readFile(
    path.join(traceDir, 'score.json'),
    'utf-8',
  ).catch(() => '{"pass": false}');

  return {
    taskId: path.basename(traceDir),
    iteration: 0,
    stdout,
    stderr,
    toolCalls: [],
    filesChanged: JSON.parse(filesChangedStr) as Record<string, 'created' | 'modified' | 'deleted'>,
    score: JSON.parse(scoreStr) as Trace['score'],
    timing: JSON.parse(timingStr) as Trace['timing'],
  };
}

/**
 * Load all traces for an iteration.
 */
export async function loadIterationTraces(
  workspacePath: string,
  iteration: number,
): Promise<Trace[]> {
  const tracesDir = path.join(workspacePath, 'traces', iteration.toString());
  const traces: Trace[] = [];

  try {
    const taskDirs = await fs.readdir(tracesDir);
    for (const taskId of taskDirs) {
      const trace = await loadTrace(path.join(tracesDir, taskId));
      traces.push(trace);
    }
  } catch {
    // Directory doesn't exist yet
  }

  return traces;
}

/**
 * Write a trace to filesystem.
 */
export async function writeTrace(traceDir: string, trace: Trace): Promise<void> {
  await fs.mkdir(traceDir, { recursive: true });
  await fs.writeFile(path.join(traceDir, 'stdout.log'), trace.stdout, 'utf-8');
  await fs.writeFile(path.join(traceDir, 'stderr.log'), trace.stderr, 'utf-8');
  await fs.writeFile(path.join(traceDir, 'score.json'), JSON.stringify(trace.score, null, 2), 'utf-8');
}
