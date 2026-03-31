import type { Task, Score } from './types.js';

/**
 * Pass/fail scorer: check if expected outcomes are met.
 */
export async function passFailScorer(
  task: Task,
  workspacePath: string,
  stdout: string,
  stderr: string,
): Promise<Score> {
  const passed = !stderr.includes('error') && !stderr.includes('failed');

  return {
    pass: passed,
    score: passed ? 100 : 0,
    details: passed ? 'All checks passed' : 'Verification failed',
  };
}

/**
 * LLM-as-judge scorer: ask LLM to evaluate outcome.
 */
export async function llmJudgeScorer(
  task: Task,
  workspacePath: string,
  stdout: string,
  stderr: string,
): Promise<Score> {
  // Stub: LLM evaluation pending v2.1
  return {
    pass: false,
    score: 50,
    reasoning: 'LLM scoring not yet implemented',
  };
}

/**
 * Select scorer based on task config.
 */
export async function scoreTask(
  task: Task,
  workspacePath: string,
  stdout: string,
  stderr: string,
): Promise<Score> {
  if (task.scoring === 'pass-fail') {
    return passFailScorer(task, workspacePath, stdout, stderr);
  } else if (task.scoring === 'llm-judge') {
    return llmJudgeScorer(task, workspacePath, stdout, stderr);
  }
  return passFailScorer(task, workspacePath, stdout, stderr);
}
