import { execCommand } from './exec.js';
import { callLLM } from '../llm.js';
import type { KairnConfig } from '../types.js';
import type { Task, Score } from './types.js';

/** Pattern to identify lines that look like shell commands. */
const COMMAND_PATTERN =
  /^(npm |npx |node |python |make |cargo |go |git |test |ls |cat |grep |curl )/;

/** Shell metacharacters that could enable command injection. */
const SHELL_METACHAR_PATTERN = /[;|&`$()<>]/;

/** System prompt for LLM-as-judge scoring. */
export const JUDGE_SYSTEM_PROMPT = `You are an eval judge for Claude Code agent tasks. Given a task description, expected outcome, and actual execution results, determine if the task was completed successfully.

Return ONLY valid JSON with this structure:
{
  "pass": true/false,
  "score": 0-100,
  "reasoning": "Brief explanation of your judgment"
}`;

/** System prompt for rubric criterion scoring. */
export const RUBRIC_SYSTEM_PROMPT = `You are an eval judge scoring a specific criterion. Given the task, the criterion to evaluate, and the execution results, score the criterion.

Return ONLY valid JSON:
{
  "score": 0.0-1.0,
  "reasoning": "Brief explanation"
}`;

// ── Deterministic criterion scoring heuristics ──

/** Evidence keywords for "Ran {command}" pattern, keyed by command keyword. */
const RAN_COMMAND_EVIDENCE: Array<{ keywords: string[]; evidence: string[] }> = [
  { keywords: ['npm run build', 'build', 'tsup'], evidence: ['build success', 'tsup', 'built in', 'build completed'] },
  { keywords: ['tsc', 'typecheck'], evidence: ['tsc', 'typecheck'] },
  { keywords: ['npm run lint', 'eslint', 'lint'], evidence: ['lint', 'eslint'] },
  { keywords: ['npm test', 'vitest', 'test'], evidence: ['vitest', 'test files', 'tests passed', 'passed (', 'tests '] },
];

/** Patterns for "Zero/No {pattern}" — items to search for absence. */
const ABSENCE_PATTERNS: Array<{ keywords: string[]; search: string[] }> = [
  { keywords: ['.then()', '.catch()'], search: ['.then(', '.catch('] },
  { keywords: ['readfilesync', 'writefilesync'], search: ['readfilesync', 'writefilesync'] },
  { keywords: ['sync'], search: ['sync'] },
];

/** Patterns for "Uses {pattern}" — keyword in criterion text mapped to output search terms. */
const PRESENCE_PATTERNS: Array<{ keyword: string; search: string[] }> = [
  { keyword: 'chalk.green', search: ['chalk.green'] },
  { keyword: 'chalk.yellow', search: ['chalk.yellow'] },
  { keyword: 'chalk.red', search: ['chalk.red'] },
  { keyword: 'chalk.cyan', search: ['chalk.cyan'] },
  { keyword: 'fs.promises', search: ['fs.promises', 'fs/promises'] },
  { keyword: 'fs/promises', search: ['fs.promises', 'fs/promises'] },
  { keyword: 'async/await', search: ['async ', 'await '] },
  { keyword: '@inquirer/prompts', search: ['@inquirer/prompts'] },
];

/** Patterns for "Calls {function}" — items to search for presence. */
const CALL_PATTERNS: string[] = [
  'process.exit(1)',
  'process.exit',
];

/**
 * Attempt to score a rubric criterion deterministically using stdout/stderr
 * pattern matching. Returns null if the criterion cannot be scored this way
 * (falls back to LLM).
 */
export function scoreCriterionDeterministic(
  criterionText: string,
  stdout: string,
  stderr: string,
): { score: number; reasoning: string } | null {
  const combined = `${stdout}\n${stderr}`.toLowerCase();
  const criterionLower = criterionText.toLowerCase().trim();

  // Pattern 1: "Ran {command}" — check if command was executed
  if (/^ran\b/i.test(criterionText.trim())) {
    for (const entry of RAN_COMMAND_EVIDENCE) {
      // Check if the criterion text mentions any of this entry's command keywords
      const matchesKeyword = entry.keywords.some((kw) =>
        criterionLower.includes(kw.toLowerCase()),
      );
      if (matchesKeyword) {
        const found = entry.evidence.some((ev) => combined.includes(ev.toLowerCase()));
        if (found) {
          const matchedEvidence = entry.evidence.find((ev) =>
            combined.includes(ev.toLowerCase()),
          );
          return {
            score: 1.0,
            reasoning: `Deterministic: found evidence of '${matchedEvidence}' in output`,
          };
        }
        return {
          score: 0.0,
          reasoning: `Deterministic: no evidence of '${entry.keywords[0]}' found`,
        };
      }
    }
    // "Ran" prefix matched but no known command pattern — fall through to null
    return null;
  }

  // Pattern 2: "Zero/No {pattern}" — check absence
  if (/^(zero|no)\b/i.test(criterionText.trim())) {
    for (const entry of ABSENCE_PATTERNS) {
      const matchesKeyword = entry.keywords.some((kw) =>
        criterionLower.includes(kw.toLowerCase()),
      );
      if (matchesKeyword) {
        const found = entry.search.some((pat) => combined.includes(pat.toLowerCase()));
        if (found) {
          const matchedPattern = entry.search.find((pat) =>
            combined.includes(pat.toLowerCase()),
          );
          return {
            score: 0.0,
            reasoning: `Deterministic: found '${matchedPattern}' which should be absent`,
          };
        }
        return {
          score: 1.0,
          reasoning: `Deterministic: no prohibited pattern found in output`,
        };
      }
    }
    // "Zero/No" prefix matched but no known pattern — fall through to null
    return null;
  }

  // Pattern 3: "Uses {specific pattern}" — check presence
  if (/^uses?\b/i.test(criterionText.trim())) {
    for (const entry of PRESENCE_PATTERNS) {
      if (criterionLower.includes(entry.keyword.toLowerCase())) {
        const found = entry.search.some((s) => combined.includes(s.toLowerCase()));
        if (found) {
          return {
            score: 1.0,
            reasoning: `Deterministic: found '${entry.keyword}' in output`,
          };
        }
        return {
          score: 0.0,
          reasoning: `Deterministic: '${entry.keyword}' not found in output`,
        };
      }
    }
    // "Uses" prefix matched but no known pattern — fall through to null
    return null;
  }

  // Pattern 4: "Calls {function}" — check presence
  if (/^calls?\b/i.test(criterionText.trim())) {
    for (const pattern of CALL_PATTERNS) {
      if (criterionLower.includes(pattern.toLowerCase())) {
        const found = combined.includes(pattern.toLowerCase());
        if (found) {
          return {
            score: 1.0,
            reasoning: `Deterministic: found '${pattern}' in output`,
          };
        }
        return {
          score: 0.0,
          reasoning: `Deterministic: '${pattern}' not found in output`,
        };
      }
    }
    // "Calls" prefix matched but no known pattern — fall through to null
    return null;
  }

  // No pattern matched — fall back to LLM
  return null;
}

/**
 * Pass/fail scorer: execute verification commands from expected_outcome,
 * falling back to stderr analysis when no commands are found.
 */
export async function passFailScorer(
  task: Task,
  workspacePath: string,
  stdout: string,
  stderr: string,
): Promise<Score> {
  const outcomes = Array.isArray(task.expected_outcome)
    ? task.expected_outcome
    : task.expected_outcome.split('\n');

  // Look for lines that look like shell commands
  const commands = outcomes
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter((line) => COMMAND_PATTERN.test(line));

  if (commands.length > 0) {
    // Execute verification commands — reject commands with shell metacharacters
    // to prevent injection from LLM-generated expected_outcome strings
    const failures: string[] = [];
    for (const cmd of commands) {
      if (SHELL_METACHAR_PATTERN.test(cmd)) {
        failures.push(`Rejected unsafe command (shell metacharacters): ${cmd}`);
        continue;
      }
      try {
        await execCommand(cmd, workspacePath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`Command failed: ${cmd}\n${msg}`);
      }
    }

    const passed = failures.length === 0;
    return {
      pass: passed,
      score: passed ? 100 : 0,
      details: passed
        ? `All ${commands.length} verification commands passed`
        : failures.join('\n'),
    };
  }

  // Fallback: check stderr for error indicators
  // Strip lines from setup (prefixed with [setup]) — these are not Claude's errors
  const filteredStderr = stderr
    .split('\n')
    .filter(line => !line.startsWith('[setup]'))
    .join('\n');
  const hasErrors =
    filteredStderr.toLowerCase().includes('error') ||
    filteredStderr.toLowerCase().includes('failed') ||
    filteredStderr.toLowerCase().includes('exception');
  const passed = !hasErrors;

  return {
    pass: passed,
    score: passed ? 100 : 0,
    details: passed ? 'No errors detected in output' : 'Errors found in stderr',
  };
}

/**
 * LLM-as-judge scorer: ask an LLM to evaluate whether the task outcome
 * matches the expected result.
 */
export async function llmJudgeScorer(
  task: Task,
  workspacePath: string,
  stdout: string,
  stderr: string,
  config: KairnConfig,
): Promise<Score> {
  const expectedOutcome = Array.isArray(task.expected_outcome)
    ? task.expected_outcome.join('\n')
    : task.expected_outcome;

  const userMessage = [
    '## Task',
    task.description,
    '',
    '## Expected Outcome',
    expectedOutcome,
    '',
    '## Actual stdout (last 2000 chars)',
    stdout.slice(-2000),
    '',
    '## Actual stderr (last 1000 chars)',
    stderr.slice(-1000),
  ].join('\n');

  try {
    const response = await callLLM(config, userMessage, {
      systemPrompt: JUDGE_SYSTEM_PROMPT,
      maxTokens: 1024,
      cacheControl: true,
    });

    // Parse JSON response, stripping markdown code fences if present
    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { pass: false, score: 0, reasoning: 'Judge returned invalid JSON' };
    }
    const result = JSON.parse(jsonMatch[0]) as {
      pass: boolean;
      score: number;
      reasoning: string;
    };
    return {
      pass: result.pass,
      score: result.score,
      reasoning: result.reasoning,
    };
  } catch (err) {
    return {
      pass: false,
      score: 0,
      reasoning: `LLM judge error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Rubric scorer: evaluate multiple weighted criteria via LLM,
 * producing a weighted aggregate score.
 *
 * Falls back to passFailScorer when no rubric criteria are defined.
 */
export async function rubricScorer(
  task: Task,
  workspacePath: string,
  stdout: string,
  stderr: string,
  config: KairnConfig,
): Promise<Score> {
  if (!task.rubric || task.rubric.length === 0) {
    return passFailScorer(task, workspacePath, stdout, stderr);
  }

  const breakdown: Array<{ criterion: string; score: number; weight: number }> =
    [];
  let weightedSum = 0;

  for (const criterion of task.rubric) {
    // Try deterministic scoring first to avoid unnecessary LLM calls
    const deterministicResult = scoreCriterionDeterministic(
      criterion.criterion,
      stdout,
      stderr,
    );

    if (deterministicResult !== null) {
      breakdown.push({
        criterion: criterion.criterion,
        score: deterministicResult.score,
        weight: criterion.weight,
      });
      weightedSum += deterministicResult.score * criterion.weight;
      continue; // Skip LLM call
    }

    // Fall through to LLM scoring
    const userMessage = [
      '## Task',
      task.description,
      '',
      '## Criterion to Evaluate',
      `"${criterion.criterion}" (weight: ${criterion.weight})`,
      '',
      '## Actual stdout (last 2000 chars)',
      stdout.slice(-2000),
      '',
      '## Actual stderr (last 500 chars)',
      stderr.slice(-500),
    ].join('\n');

    try {
      const response = await callLLM(config, userMessage, {
        systemPrompt: RUBRIC_SYSTEM_PROMPT,
        maxTokens: 512,
        cacheControl: true,
      });

      let cleaned = response.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '');
      }
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as {
          score: number;
          reasoning: string;
        };
        const clampedScore = Math.max(0, Math.min(1, result.score));
        breakdown.push({
          criterion: criterion.criterion,
          score: clampedScore,
          weight: criterion.weight,
        });
        weightedSum += clampedScore * criterion.weight;
      } else {
        breakdown.push({
          criterion: criterion.criterion,
          score: 0,
          weight: criterion.weight,
        });
      }
    } catch {
      breakdown.push({
        criterion: criterion.criterion,
        score: 0,
        weight: criterion.weight,
      });
    }
  }

  const totalWeight = task.rubric.reduce((sum, c) => sum + c.weight, 0);
  const totalScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0;
  return {
    pass: totalScore >= 60,
    score: totalScore,
    reasoning: `Rubric score: ${totalScore}%`,
    breakdown,
  };
}

/**
 * Classify why a task failed based on trace data.
 * Only called for non-passing scores.
 */
export function classifyFailure(
  score: Score,
  stdout: string,
  stderr: string,
): Score {
  if (score.pass) return score;

  const combined = `${stdout}\n${stderr}`.toLowerCase();
  const scoreValue = score.score ?? 0;

  let failureCategory: Score['failureCategory'] = 'unknown';
  let failureReason = '';

  // Setup/task errors: task definition is broken or ambiguous
  if (
    stderr.includes('[setup]') && stderr.includes('Error') ||
    combined.includes('command not found') ||
    combined.includes('no such file or directory')
  ) {
    failureCategory = 'task';
    failureReason = 'Task setup failed or references missing resources';
  }
  // Model errors: API failures, token limits, context overflow
  else if (
    combined.includes('token limit') ||
    combined.includes('context length') ||
    combined.includes('rate limit') ||
    combined.includes('api error') ||
    combined.includes('429') ||
    combined.includes('overloaded')
  ) {
    failureCategory = 'model';
    failureReason = 'Model API error, token limit, or rate limit';
  }
  // Repo errors: pre-existing build failures, dirty state
  else if (
    combined.includes('build failed') && combined.includes('before') ||
    combined.includes('merge conflict') ||
    combined.includes('git dirty') ||
    combined.includes('uncommitted changes')
  ) {
    failureCategory = 'repo';
    failureReason = 'Pre-existing repo issues (build failure, dirty state)';
  }
  // Harness errors: agent tried but got it wrong (partial score)
  else if (scoreValue >= 20 && scoreValue < 80) {
    failureCategory = 'harness';
    failureReason = 'Agent attempted the task but did not follow harness conventions';
  }

  return { ...score, failureCategory, failureReason };
}

export async function scoreTask(
  task: Task,
  workspacePath: string,
  stdout: string,
  stderr: string,
  config?: KairnConfig,
): Promise<Score> {
  let score: Score;
  if (task.scoring === 'pass-fail') {
    score = await passFailScorer(task, workspacePath, stdout, stderr);
  } else if (task.scoring === 'llm-judge' && config) {
    score = await llmJudgeScorer(task, workspacePath, stdout, stderr, config);
  } else if (task.scoring === 'rubric' && config) {
    score = await rubricScorer(task, workspacePath, stdout, stderr, config);
  } else {
    score = await passFailScorer(task, workspacePath, stdout, stderr);
  }

  if (!score.pass) {
    score = classifyFailure(score, stdout, stderr);
  }

  return score;
}
