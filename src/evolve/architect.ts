/**
 * Architect proposer — exploration-mode proposer for structural harness improvements.
 *
 * Unlike the reactive proposer (which diagnoses specific trace failures), the architect
 * proposes bold structural changes: new files, reorganized sections, missing capabilities.
 * It runs on a configurable schedule interleaved with the reactive proposer.
 */

import { callLLM } from '../llm.js';
import { readHarnessFiles, parseProposerResponse } from './proposer.js';
import { loadIterationTraces } from './trace.js';
import type { Task, Trace, IterationLog, ArchitectProposal } from './types.js';
import type { KairnConfig } from '../types.js';

export const ARCHITECT_SYSTEM_PROMPT = `You are an expert agent environment ARCHITECT. Your job is NOT to fix bugs —
the reactive proposer handles that. Your job is to REIMAGINE the harness structure
for maximum agent effectiveness.

## What You Have Access To
1. Current harness: The .claude/ directory files (CLAUDE.md, commands/, rules/, agents/)
2. Execution traces: For context, not root-cause diagnosis
3. Evolution history: What's been tried, what worked
4. Knowledge base: Patterns that worked in other projects (if available)

## Your Task
Step back from individual task failures. Ask:
- Is the overall harness ARCHITECTURE sound?
- Are there missing capabilities that no task exposed?
- Are there structural patterns from other projects that would help here?
- Should files be split, merged, reorganized, or replaced entirely?
- Are there hooks, rules, or agents that should exist but don't?

## Available Mutation Actions
1. **replace** — Replace old_text with new_text in a file
2. **add_section** — Append new content to a file (or create it)
3. **create_file** — Create a new file
4. **delete_section** — Remove specific text from a file
5. **delete_file** — Delete an entire file

## Output Format
Return a JSON object:
{
  "reasoning": "Your architectural analysis and rationale...",
  "mutations": [
    { "file": "...", "action": "...", "old_text": "...", "new_text": "...", "rationale": "..." }
  ],
  "expected_impact": { "task-id": "+N% — explanation" }
}

## Budget
You may propose up to 10 mutations (vs. reactive proposer's 3).
Structural changes require more mutations to be coherent.

## Rules
- You may create new files, delete files, and restructure significantly.
- You must preserve what's working — check scores before proposing removals.
- Each mutation needs a rationale, but it can be SPECULATIVE
  ("I believe X will improve Y because Z pattern works in similar projects").
- Bold changes are preferred over incremental tweaks. The reactive proposer handles tweaks.
- Never remove something that's working well for multiple tasks.
- Do NOT add over-specified rules or game eval criteria.
- Ask: "Would this structural change help across ALL tasks?"

Return ONLY valid JSON.`;

/** Maximum total characters for the architect user message. */
const MAX_CONTEXT_CHARS = 100_000;

/** Maximum characters of stdout to include per trace. */
const STDOUT_TRUNCATION_LIMIT = 1000;

/**
 * Truncate stdout, keeping the last `limit` characters with a truncation marker.
 */
function truncateStdout(stdout: string, limit: number): string {
  if (stdout.length <= limit) {
    return stdout;
  }
  return `[...truncated, showing last ${limit} chars...]\n${stdout.slice(-limit)}`;
}

/**
 * Build a summary of the evolution trajectory for the architect.
 *
 * Reports iteration count, score trend, best score, and total mutations tried.
 * Returns empty string when history is empty.
 */
export function buildEvolutionSummary(history: IterationLog[]): string {
  if (history.length === 0) return '';

  const scores = history.map(h => h.score);
  let trend: string;
  if (scores.length >= 2) {
    const first = scores[0];
    const last = scores[scores.length - 1];
    trend = last > first ? 'improving' : last < first ? 'declining' : 'flat';
  } else {
    trend = 'insufficient data';
  }

  const bestScore = Math.max(...scores);
  const bestIteration = scores.indexOf(bestScore);
  const totalMutations = history.reduce(
    (sum, h) => sum + (h.proposal?.mutations.length ?? 0),
    0,
  );

  return (
    `## Evolution Summary\n\n` +
    `- Iterations completed: ${history.length}\n` +
    `- Score trend: ${trend} (${scores[0].toFixed(1)} → ${scores[scores.length - 1].toFixed(1)})\n` +
    `- Best score: ${bestScore.toFixed(1)} (iteration ${bestIteration})\n` +
    `- Total mutations tried: ${totalMutations}\n`
  );
}

/**
 * Build a section listing tasks that are consistently passing.
 *
 * The architect must preserve what is working. This section highlights
 * which tasks to protect when proposing structural changes.
 * Returns empty string when history is empty.
 */
export function buildWhatsWorking(
  history: IterationLog[],
  _tasks: Task[],
): string {
  if (history.length === 0) return '';

  const latest = history[history.length - 1];
  const passing = Object.entries(latest.taskResults)
    .filter(([, s]) => s.pass)
    .map(([id]) => id);

  if (passing.length === 0) {
    return `## What's Working\n\n(No tasks consistently passing)\n`;
  }

  return (
    `## What's Working\n\n` +
    `Consistently passing tasks (do NOT break these):\n` +
    `${passing.map(id => `- ${id}`).join('\n')}\n`
  );
}

/**
 * Build the trace section for the architect, fitting within the given budget.
 *
 * Sorts traces worst-first and progressively reduces stdout limits to fit.
 */
function buildTraceSection(traces: Trace[], budget: number): string {
  if (traces.length === 0) return '## Execution Traces\n\n(No traces available)\n';

  const sortedTraces = [...traces].sort((a, b) => {
    const scoreA = a.score.score ?? (a.score.pass ? 100 : 0);
    const scoreB = b.score.score ?? (b.score.pass ? 100 : 0);
    return scoreA - scoreB;
  });

  let stdoutLimit = STDOUT_TRUNCATION_LIMIT;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts: string[] = ['## Execution Traces (sorted worst-first)\n'];
    for (const trace of sortedTraces) {
      const scoreNum = trace.score.score !== undefined
        ? trace.score.score
        : (trace.score.pass ? 100 : 0);
      const truncatedStdout = truncateStdout(trace.stdout, stdoutLimit);
      const filesChangedList = Object.entries(trace.filesChanged)
        .map(([f, action]) => `  - ${f}: ${action}`)
        .join('\n');

      parts.push(
        `### Trace: ${trace.taskId}\n` +
        `- Pass: ${trace.score.pass}\n` +
        `- Score: ${scoreNum}\n` +
        (trace.score.details ? `- Details: ${trace.score.details}\n` : '') +
        `- Duration: ${trace.timing.durationMs}ms\n` +
        `- Files changed:\n${filesChangedList || '  (none)'}\n` +
        `- Stdout (last ${stdoutLimit} chars):\n\`\`\`\n${truncatedStdout}\n\`\`\`\n`,
      );
    }
    const result = parts.join('\n');
    if (result.length <= budget) return result;
    stdoutLimit = Math.floor(stdoutLimit / 2);
  }

  // Final fallback: scores-only summary
  const summary = ['## Execution Traces (summary — stdout omitted to fit budget)\n'];
  for (const trace of sortedTraces) {
    const scoreNum = trace.score.score !== undefined
      ? trace.score.score
      : (trace.score.pass ? 100 : 0);
    summary.push(`- ${trace.taskId}: ${scoreNum} (pass=${trace.score.pass})\n`);
  }
  return summary.join('\n');
}

/**
 * Build the history section, fitting within the given character budget.
 * Drops oldest iterations first when it exceeds budget.
 */
function buildHistorySection(history: IterationLog[], budget: number): string {
  if (history.length === 0) return '## Iteration History\n\n(No previous iterations)\n';

  let entries = [...history];
  while (entries.length > 0) {
    const parts: string[] = ['## Iteration History\n'];
    if (entries.length < history.length) {
      parts.push(`(Showing ${entries.length}/${history.length} most recent iterations)\n`);
    }
    for (const log of entries) {
      const taskScores = Object.entries(log.taskResults)
        .map(([id, s]) => `  - ${id}: ${s.score !== undefined ? s.score : (s.pass ? 100 : 0)} (pass=${s.pass})`)
        .join('\n');

      parts.push(
        `### Iteration ${log.iteration} — Score: ${log.score}\n` +
        `- Task results:\n${taskScores}\n`,
      );

      if (log.proposal) {
        parts.push(
          `- Proposal reasoning: ${log.proposal.reasoning}\n` +
          `- Mutations: ${log.proposal.mutations.length} change(s)\n`,
        );
      }
    }
    const result = parts.join('\n');
    if (result.length <= budget) return result;
    entries = entries.slice(1);
  }

  return '## Iteration History\n\n(History omitted to fit context budget)\n';
}

/**
 * Build the user-facing prompt for the architect LLM call.
 *
 * Assembles current harness files, task definitions, evolution summary,
 * what's-working analysis, optional knowledge context, traces, and history
 * into a single context string with priority-based truncation.
 *
 * The architect uses a 50/50 trace/history budget split (vs. the reactive
 * proposer's 70/30) because structural analysis benefits more from history
 * context than individual trace details.
 */
export function buildArchitectUserMessage(
  harnessFiles: Record<string, string>,
  traces: Trace[],
  tasks: Task[],
  history: IterationLog[],
  knowledgeContext?: string,
): string {
  // Section 1: Current harness files (highest priority — never truncated)
  const harnessSection: string[] = ['## Current Harness Files\n'];
  const fileEntries = Object.entries(harnessFiles);
  if (fileEntries.length === 0) {
    harnessSection.push('(No harness files found)\n');
  } else {
    for (const [filePath, content] of fileEntries) {
      harnessSection.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\`\n`);
    }
  }

  // Section 2: Task definitions (description only — no rubrics/expected_outcome)
  const taskSection: string[] = ['## Task Definitions\n'];
  if (tasks.length === 0) {
    taskSection.push('(No tasks defined)\n');
  } else {
    for (const task of tasks) {
      taskSection.push(
        `### Task: ${task.id}\n` +
        `- Template: ${task.template}\n` +
        `- Description: ${task.description}\n`,
      );
    }
  }

  // Section 3: Evolution Summary (unique to architect)
  const summarySection = buildEvolutionSummary(history);

  // Section 4: What's Working (unique to architect)
  const workingSection = buildWhatsWorking(history, tasks);

  // Section 5: Knowledge Base (if provided)
  const knowledgeSection = knowledgeContext
    ? `## Knowledge Base (patterns from other projects)\n\n${knowledgeContext}\n`
    : '';

  const fixedContent =
    harnessSection.join('\n') + '\n' +
    taskSection.join('\n') + '\n' +
    summarySection +
    (summarySection ? '\n' : '') +
    workingSection +
    (workingSection ? '\n' : '') +
    knowledgeSection;

  const remainingBudget = MAX_CONTEXT_CHARS - fixedContent.length;

  if (remainingBudget <= 0) {
    return fixedContent + '\n\n[...traces and history omitted — context budget exceeded...]';
  }

  // Section 6: Traces (50% budget — architect uses 50/50 split, not 70/30)
  const traceBudget = Math.floor(remainingBudget * 0.5);
  const historyBudget = remainingBudget - traceBudget;

  // Section 7: History (50% budget)
  const traceSection = buildTraceSection(traces, traceBudget);
  const historySection = buildHistorySection(history, historyBudget);

  return fixedContent + '\n' + traceSection + '\n' + historySection;
}

/**
 * Run the architect proposer: read harness, load traces, call LLM, return an ArchitectProposal.
 *
 * The architect analyzes the overall harness structure, evolution trajectory, and
 * optionally cross-project knowledge to propose bold structural changes. Unlike the
 * reactive proposer which fixes specific trace failures, the architect reimagines
 * harness architecture.
 *
 * @param iteration - Current iteration number
 * @param workspacePath - Path to the .kairn-evolve workspace
 * @param harnessPath - Path to the current harness (.claude/) directory
 * @param history - Logs from previous iterations
 * @param tasks - Task definitions being evaluated
 * @param config - Kairn configuration (for LLM access)
 * @param architectModel - Model ID to use for the architect call
 * @param knowledgeContext - Optional formatted knowledge base context string
 * @returns A validated ArchitectProposal with structural=true and source='architect'
 */
export async function proposeArchitecture(
  iteration: number,
  workspacePath: string,
  harnessPath: string,
  history: IterationLog[],
  tasks: Task[],
  config: KairnConfig,
  architectModel: string,
  knowledgeContext?: string,
): Promise<ArchitectProposal> {
  const harnessFiles = await readHarnessFiles(harnessPath);
  const traces = await loadIterationTraces(workspacePath, iteration);
  const userMessage = buildArchitectUserMessage(
    harnessFiles,
    traces,
    tasks,
    history,
    knowledgeContext,
  );

  const architectConfig: KairnConfig = { ...config, model: architectModel };
  const response = await callLLM(architectConfig, userMessage, {
    systemPrompt: ARCHITECT_SYSTEM_PROMPT,
    maxTokens: 16384,
    jsonMode: true,
    cacheControl: true,
  });

  const base = parseProposerResponse(response);
  return {
    ...base,
    structural: true,
    source: 'architect',
  };
}
