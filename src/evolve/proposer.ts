import fs from 'fs/promises';
import path from 'path';
import { callLLM } from '../llm.js';
import { loadIterationTraces } from './trace.js';
import type { Task, Trace, Proposal, Mutation, IterationLog } from './types.js';
import type { KairnConfig } from '../types.js';
import type { HarnessIR, SettingsIR } from '../ir/types.js';

export const PROPOSER_SYSTEM_PROMPT = `You are an expert agent environment optimizer. Your job is to improve a Claude Code
agent environment (.claude/ directory) based on execution traces from real tasks.

## What You Have Access To
1. Current harness: The .claude/ directory files (CLAUDE.md, commands/, rules/, agents/)
2. Execution traces: Full stdout/stderr, tool call sequences, file changes, and scores
3. History: Previous iterations' proposals, diffs, and resulting score changes

## Your Task
Analyze the traces to identify WHY tasks fail or underperform. Then propose specific,
minimal changes to the harness files that will fix those failures.

## Diagnosis Process
1. For each failed/low-scoring task:
   a. Read the full trace (stdout, tool calls, file changes)
   b. Identify the ROOT CAUSE: bad instruction? Missing tool? Wrong rule?
   c. Trace the failure back to a specific harness decision
   d. Propose a fix

2. For each successful task:
   a. Note what worked well
   b. Ensure proposed changes don't break what's working

3. Check history for counterfactual evidence

## Available Mutation Actions
1. **replace** — Replace old_text with new_text in a file: { "file": "...", "action": "replace", "old_text": "...", "new_text": "...", "rationale": "..." }
2. **add_section** — Append new content to a file (or create it): { "file": "...", "action": "add_section", "new_text": "...", "rationale": "..." }
3. **create_file** — Create a new file: { "file": "...", "action": "create_file", "new_text": "...", "rationale": "..." }
4. **delete_section** — Remove specific text from a file: { "file": "...", "action": "delete_section", "old_text": "...", "rationale": "..." }
5. **delete_file** — Delete an entire file: { "file": "...", "action": "delete_file", "rationale": "..." }

## Output Format
Return a JSON object:
{
  "reasoning": "Your full causal analysis...",
  "mutations": [
    { "file": "CLAUDE.md", "action": "replace", "old_text": "...", "new_text": "...", "rationale": "..." },
    { "file": "commands/develop.md", "action": "add_section", "new_text": "...", "rationale": "..." },
    { "file": "rules/obsolete.md", "action": "delete_file", "rationale": "..." }
  ],
  "expected_impact": { "task-id": "+15% — explanation" }
}

## MCP Configuration
You can also mutate .mcp.json to add, remove, or reconfigure MCP servers.
Treat .mcp.json like any other harness file — propose changes when traces show
the agent lacks a tool it needs, or has tools that add noise without benefit.

## Rules
- Propose AT MOST 3 mutations per iteration. Fewer, targeted mutations are more stable than many broad ones.
- Each mutation must have a clear rationale tied to a specific trace observation.
- Never remove something that's working for another task.
- If a previous iteration's change caused a regression, REVERT it.
- Consider both additions AND removals. Remove sections that add noise without improving task performance.
- Bloated harnesses hurt performance — trim what isn't earning its keep.

## Anti-Gaming (CRITICAL)
- Mutations must improve GENERAL-PURPOSE development quality, not target specific eval criteria.
- You do NOT have access to scoring rubrics or expected outcomes. Diagnose problems from traces only.
- Do NOT add over-specified rules that restate existing conventions with stronger emphasis (e.g., changing "use chalk.green for success" to "MUST use chalk.green, no exceptions"). If a convention already exists, trust it.
- Do NOT add rules that only apply to a narrow eval scenario (e.g., write permissions for a specific directory just because one task needed it).
- Ask: "Would this mutation help a developer working on ANY task in this project?" If not, don't propose it.

Return ONLY valid JSON.`;

/**
 * Count the total number of settings-level hooks across all hook categories.
 *
 * Iterates over all hook categories (PreToolUse, PostToolUse, etc.) and sums
 * the number of individual hook entries within each category.
 */
function countSettingsHooks(settings: SettingsIR): number {
  let count = 0;
  const categories = settings.hooks;
  for (const key of Object.keys(categories) as Array<keyof typeof categories>) {
    const entries = categories[key];
    if (entries) {
      count += entries.length;
    }
  }
  return count;
}

/**
 * Build a compact structural overview of a HarnessIR for proposer context.
 *
 * Produces a ~200-500 token summary listing counts and names of all IR
 * components: sections, commands, rules, agents, MCP servers, skills, docs,
 * hooks, and settings. This gives the proposer a structural map of the
 * harness without including full content.
 *
 * @param ir - The HarnessIR to summarize
 * @returns A markdown-formatted string suitable for injection into a prompt
 */
export function buildIRSummary(ir: HarnessIR): string {
  const lines: string[] = [];

  // Header
  lines.push('## Harness Structure (IR)');

  // Meta
  const meta = ir.meta;
  const techParts: string[] = [meta.techStack.language];
  if (meta.techStack.framework) techParts.push(meta.techStack.framework);
  if (meta.techStack.buildTool) techParts.push(meta.techStack.buildTool);
  lines.push(`Project: ${meta.name || '(unnamed)'} — ${techParts.join(', ')}`);

  // Sections
  const sectionIds = ir.sections.map((s) => s.id);
  lines.push(`Sections (${ir.sections.length}): ${sectionIds.join(', ') || 'none'}`);

  // Commands — include description hint
  const commandSummaries = ir.commands.map((c) => c.name);
  lines.push(`Commands (${ir.commands.length}): ${commandSummaries.join(', ') || 'none'}`);

  // Rules — include glob patterns
  const ruleSummaries = ir.rules.map((r) => {
    const pathHint = r.paths && r.paths.length > 0 ? ` (${r.paths.join(', ')})` : '';
    return `${r.name}${pathHint}`;
  });
  lines.push(`Rules (${ir.rules.length}): ${ruleSummaries.join(', ') || 'none'}`);

  // Agents
  const agentNames = ir.agents.map((a) => a.name);
  lines.push(`Agents (${ir.agents.length}): ${agentNames.join(', ') || 'none'}`);

  // MCP Servers
  const serverNames = ir.mcpServers.map((s) => s.id);
  lines.push(`MCP Servers (${ir.mcpServers.length}): ${serverNames.join(', ') || 'none'}`);

  // Optional categories — only show when non-empty
  if (ir.skills.length > 0) {
    const skillNames = ir.skills.map((s) => s.name);
    lines.push(`Skills (${ir.skills.length}): ${skillNames.join(', ')}`);
  }

  if (ir.docs.length > 0) {
    const docNames = ir.docs.map((d) => d.name);
    lines.push(`Docs (${ir.docs.length}): ${docNames.join(', ')}`);
  }

  if (ir.hooks.length > 0) {
    const hookNames = ir.hooks.map((h) => h.name);
    lines.push(`Hooks (${ir.hooks.length}): ${hookNames.join(', ')}`);
  }

  // Settings summary
  const settingsParts: string[] = [];
  if (ir.settings.statusLine) {
    settingsParts.push('statusLine=enabled');
  }
  if (ir.settings.denyPatterns && ir.settings.denyPatterns.length > 0) {
    settingsParts.push(`denyPatterns=${ir.settings.denyPatterns.length}`);
  }
  const hooksCount = countSettingsHooks(ir.settings);
  if (hooksCount > 0) {
    settingsParts.push(`hooks=${hooksCount}`);
  }
  lines.push(`Settings: ${settingsParts.join(', ') || 'default'}`);

  return lines.join('\n');
}

/** Maximum characters of stdout to include per trace in the prompt. */
const STDOUT_TRUNCATION_LIMIT = 1000;

/** Maximum total characters for the proposer user message. */
const MAX_CONTEXT_CHARS = 100_000;

/**
 * Recursively read all files in a harness directory.
 *
 * Returns a record mapping relative file paths (e.g. "commands/develop.md")
 * to their string contents. Missing or unreadable directories return an
 * empty record.
 */
export async function readHarnessFiles(
  harnessPath: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        try {
          result[relativePath] = await fs.readFile(fullPath, 'utf-8');
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(harnessPath, '');
  return result;
}

function truncateStdout(stdout: string, limit: number): string {
  if (stdout.length <= limit) {
    return stdout;
  }
  return `[...truncated, showing last ${limit} chars...]\n${stdout.slice(-limit)}`;
}

/**
 * Build the user-facing prompt for the proposer LLM call.
 *
 * Assembles current harness file contents, trace summaries (with truncated
 * stdout), task definitions, and iteration history into a single string.
 */
export function buildProposerUserMessage(
  harnessFiles: Record<string, string>,
  traces: Trace[],
  tasks: Task[],
  history: IterationLog[],
  memorySection?: string,
): string {
  // Priority-based context assembly: harness + tasks are never truncated,
  // traces and history are progressively reduced to fit within budget.

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

  // Section 2: Task definitions (description only — rubrics and expected_outcome
  // are intentionally excluded to prevent the proposer from gaming eval criteria)
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

  const fixedContent = harnessSection.join('\n') + '\n' + taskSection.join('\n');
  const remainingBudget = MAX_CONTEXT_CHARS - fixedContent.length;

  if (remainingBudget <= 0) {
    return fixedContent + '\n\n[...traces and history omitted — harness + tasks fill context budget...]';
  }

  // Section 3: Execution traces (medium priority — stdout truncated progressively)
  // Allocate 70% of remaining budget to traces, 30% to history
  const traceBudget = Math.floor(remainingBudget * 0.7);
  const historyBudget = remainingBudget - traceBudget;

  const traceSection = buildTraceSection(traces, traceBudget);
  const historySection = buildHistorySection(history, historyBudget);

  const memoryPart = memorySection ? '\n' + memorySection : '';
  return fixedContent + '\n' + traceSection + '\n' + historySection + memoryPart;
}

/**
 * Build the trace section, fitting within the given character budget.
 * Progressively reduces per-trace stdout limit if the section exceeds budget.
 */
function buildTraceSection(traces: Trace[], budget: number): string {
  if (traces.length === 0) return '## Execution Traces\n\n(No traces available)\n';

  // Sort traces by score ascending (worst-first) so the proposer focuses on what's broken
  const sortedTraces = [...traces].sort((a, b) => {
    const scoreA = a.score.score ?? (a.score.pass ? 100 : 0);
    const scoreB = b.score.score ?? (b.score.pass ? 100 : 0);
    return scoreA - scoreB;
  });

  // Try with default limit, halve stdout limit until it fits
  let stdoutLimit = STDOUT_TRUNCATION_LIMIT;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts: string[] = ['## Execution Traces (sorted worst-first)\n'];
    for (const trace of sortedTraces) {
      const scoreNum = trace.score.score !== undefined ? trace.score.score : (trace.score.pass ? 100 : 0);
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
  for (const trace of traces) {
    const scoreNum = trace.score.score !== undefined ? trace.score.score : (trace.score.pass ? 100 : 0);
    summary.push(`- ${trace.taskId}: ${scoreNum} (pass=${trace.score.pass})\n`);
  }
  return summary.join('\n');
}

/**
 * Build the history section, fitting within the given character budget.
 * Drops oldest iterations first if it exceeds budget.
 */
function buildHistorySection(history: IterationLog[], budget: number): string {
  if (history.length === 0) return '## Iteration History\n\n(No previous iterations)\n';

  // Try with full history, then drop oldest entries until it fits
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
    entries = entries.slice(1); // drop oldest
  }

  return '## Iteration History\n\n(History omitted to fit context budget)\n';
}

/**
 * Parse a raw LLM response string into a validated Proposal.
 *
 * Strips markdown code fences, extracts JSON, maps snake_case keys
 * (old_text, new_text, expected_impact) to camelCase, and filters out
 * any mutations with path traversal in the file field.
 *
 * @throws Error if the response is not valid JSON or lacks required fields.
 */
export function parseProposerResponse(raw: string): Proposal {
  let cleaned = raw.trim();

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: extract JSON object from prose-wrapped text (first '{' to last '}')
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const extracted = cleaned.slice(firstBrace, lastBrace + 1);
      try {
        parsed = JSON.parse(extracted);
      } catch {
        throw new Error(`Proposer returned invalid JSON: ${cleaned.slice(0, 200)}`);
      }
    } else {
      throw new Error(`Proposer returned invalid JSON: ${cleaned.slice(0, 200)}`);
    }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Proposer response is not a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj['reasoning'] !== 'string') {
    throw new Error('Proposer response missing required "reasoning" string field');
  }

  if (!Array.isArray(obj['mutations'])) {
    throw new Error('Proposer response missing required "mutations" array field');
  }

  const mutations: Mutation[] = [];
  for (const entry of obj['mutations'] as unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const m = entry as Record<string, unknown>;

    const file = typeof m['file'] === 'string' ? m['file'] : '';
    const action = typeof m['action'] === 'string' ? m['action'] : '';
    const newText = typeof m['new_text'] === 'string'
      ? m['new_text']
      : (typeof m['newText'] === 'string' ? m['newText'] : '');
    const oldText = typeof m['old_text'] === 'string'
      ? m['old_text']
      : (typeof m['oldText'] === 'string' ? m['oldText'] : undefined);
    const rationale = typeof m['rationale'] === 'string' ? m['rationale'] : '';

    // Security: reject path traversal
    if (file.includes('..')) {
      continue;
    }

    const validActions = new Set(['replace', 'add_section', 'create_file', 'delete_section', 'delete_file']);
    if (!validActions.has(action)) {
      continue;
    }

    // For replace and delete_section actions, oldText is required
    if ((action === 'replace' || action === 'delete_section') && !oldText) {
      continue;
    }

    const mutation: Mutation = {
      file,
      action: action as Mutation['action'],
      newText,
      rationale,
    };

    if (oldText !== undefined) {
      mutation.oldText = oldText;
    }

    mutations.push(mutation);
  }

  // Parse expectedImpact (accept both snake_case and camelCase)
  const rawImpact = obj['expected_impact'] ?? obj['expectedImpact'] ?? {};
  const expectedImpact: Record<string, string> = {};
  if (typeof rawImpact === 'object' && rawImpact !== null) {
    for (const [key, value] of Object.entries(rawImpact as Record<string, unknown>)) {
      expectedImpact[key] = typeof value === 'string' ? value : String(value);
    }
  }

  return {
    reasoning: obj['reasoning'] as string,
    mutations,
    expectedImpact,
  };
}

/**
 * Run the proposer agent: read harness, load traces, call LLM, return a Proposal.
 *
 * The proposer analyzes execution traces from the current iteration, diagnoses
 * root causes of failures, and proposes minimal mutations to the harness files.
 *
 * @param iteration - Current iteration number
 * @param workspacePath - Path to the .kairn-evolve workspace
 * @param harnessPath - Path to the current harness (.claude/) directory
 * @param history - Logs from previous iterations
 * @param tasks - Task definitions being evaluated
 * @param config - Kairn configuration (for LLM access)
 * @param proposerModel - Model ID to use for the proposer call
 * @returns A validated Proposal with reasoning, mutations, and expected impact
 */
export async function propose(
  iteration: number,
  workspacePath: string,
  harnessPath: string,
  history: IterationLog[],
  tasks: Task[],
  config: KairnConfig,
  proposerModel: string,
): Promise<Proposal> {
  const harnessFiles = await readHarnessFiles(harnessPath);
  const traces = await loadIterationTraces(workspacePath, iteration);
  const { loadProposerMemory, formatMemoryForProposer } = await import('./memory.js');
  const memory = await loadProposerMemory(workspacePath);
  const memorySection = formatMemoryForProposer(memory);

  // Load knowledge base for cross-run learning
  let knowledgeSection = '';
  try {
    const { loadKnowledgeBase, formatKnowledgeForProposer } = await import('./knowledge.js');
    const patterns = await loadKnowledgeBase();
    knowledgeSection = formatKnowledgeForProposer(patterns, null);
  } catch {
    // Knowledge base is non-critical — continue without it
  }

  const combinedMemory = memorySection + (knowledgeSection ? '\n' + knowledgeSection : '');
  const userMessage = buildProposerUserMessage(harnessFiles, traces, tasks, history, combinedMemory || undefined);

  // Override model with proposer-specific model
  const proposerConfig: KairnConfig = { ...config, model: proposerModel };
  const response = await callLLM(proposerConfig, userMessage, {
    systemPrompt: PROPOSER_SYSTEM_PROMPT,
    maxTokens: 8192,
    jsonMode: true,
    cacheControl: true,
  });

  return parseProposerResponse(response);
}
