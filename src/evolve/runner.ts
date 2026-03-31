import fs from 'fs/promises';
import path from 'path';
import type { Task, Trace, Score } from './types.js';

/**
 * Run a single task against a harness in an isolated workspace.
 * Captures stdout, stderr, files changed, and scores the result.
 */
export async function runTask(
  task: Task,
  harnessPath: string,
  traceDir: string,
  taskDescription: string,
): Promise<Score> {
  // Create trace directory
  await fs.mkdir(traceDir, { recursive: true });

  // Stub implementation that captures basic output
  // Full implementation will invoke Claude Code agent in v2.1
  const trace: Trace = {
    taskId: task.id,
    iteration: 0,
    stdout: '(task execution pending)',
    stderr: '',
    toolCalls: [],
    filesChanged: {},
    score: { pass: false, details: 'Not yet implemented' },
    timing: {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    },
  };

  // Write trace files
  await fs.writeFile(path.join(traceDir, 'stdout.log'), trace.stdout, 'utf-8');
  await fs.writeFile(path.join(traceDir, 'stderr.log'), trace.stderr, 'utf-8');
  await fs.writeFile(path.join(traceDir, 'tool_calls.jsonl'), '', 'utf-8');
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

  return trace.score;
}
