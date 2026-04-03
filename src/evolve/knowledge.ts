/**
 * Persistent knowledge base for cross-run, cross-project pattern learning.
 *
 * Stores discovered mutation patterns at ~/.kairn/knowledge/patterns.jsonl.
 * Both the reactive proposer and architect read patterns before proposing.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getKairnDir } from '../config.js';
import type { IterationLog, KnowledgePattern } from './types.js';

/** Return the root knowledge directory: ~/.kairn/knowledge/ */
function getKnowledgeDir(): string {
  return path.join(getKairnDir(), 'knowledge');
}

/** Return the path to the JSONL patterns file. */
function getPatternsPath(): string {
  return path.join(getKnowledgeDir(), 'patterns.jsonl');
}

/** Return the path to the per-project history directory. */
function getProjectsDir(): string {
  return path.join(getKnowledgeDir(), 'projects');
}

/** Return the path to the convergence analysis file. */
function getConvergencePath(): string {
  return path.join(getKnowledgeDir(), 'convergence.json');
}

/**
 * Load all patterns from the knowledge base, optionally filtered by type or language.
 *
 * Returns an empty array if the patterns file does not exist yet.
 * Malformed JSONL lines are silently skipped.
 */
export async function loadKnowledgeBase(
  filter?: { type?: KnowledgePattern['type']; language?: string },
): Promise<KnowledgePattern[]> {
  const patternsPath = getPatternsPath();
  let content: string;
  try {
    content = await fs.readFile(patternsPath, 'utf-8');
  } catch {
    return []; // File doesn't exist yet
  }

  const patterns: KnowledgePattern[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const pattern = JSON.parse(trimmed) as KnowledgePattern;
      if (filter?.type && pattern.type !== filter.type) continue;
      if (filter?.language && !pattern.evidence.languages.includes(filter.language)) continue;
      patterns.push(pattern);
    } catch {
      // Skip malformed lines
    }
  }

  return patterns;
}

/**
 * Append a single pattern to the knowledge base JSONL file.
 *
 * Creates the knowledge directory and file if they don't exist.
 */
export async function savePattern(pattern: KnowledgePattern): Promise<void> {
  const dir = getKnowledgeDir();
  await fs.mkdir(dir, { recursive: true });
  const patternsPath = getPatternsPath();
  await fs.appendFile(patternsPath, JSON.stringify(pattern) + '\n', 'utf-8');
}

/**
 * Extract accepted mutations from a completed evolve run and save as patterns.
 *
 * For iterations where the score improved compared to the previous iteration,
 * the mutations are saved as accepted patterns. For iterations where the score
 * dropped, mutations are saved as rejected patterns.
 *
 * The score delta is split evenly across all mutations in a single iteration
 * since we cannot attribute individual credit without ablation.
 */
export async function extractAndSavePatterns(
  history: IterationLog[],
  projectName: string,
  language: string | null,
): Promise<KnowledgePattern[]> {
  const patterns: KnowledgePattern[] = [];
  const now = new Date().toISOString();

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    if (!curr.proposal || curr.proposal.mutations.length === 0) continue;

    const scoreDelta = curr.score - prev.score;
    const improved = scoreDelta > 0;

    for (const mutation of curr.proposal.mutations) {
      const pattern: KnowledgePattern = {
        id: `pattern_${crypto.randomUUID().slice(0, 8)}`,
        type: 'project',
        description: mutation.rationale || `${mutation.action} on ${mutation.file}`,
        mutation,
        evidence: {
          repos_tested: 1,
          repos_helped: improved ? 1 : 0,
          mean_score_delta: scoreDelta / curr.proposal.mutations.length,
          languages: language ? [language] : [],
        },
        discovered_at: now,
        last_validated: now,
        rejected: !improved,
      };
      patterns.push(pattern);
      await savePattern(pattern);
    }
  }

  return patterns;
}

/**
 * Format top-N relevant patterns for the reactive proposer's context.
 *
 * Excludes rejected patterns. Filters to universal patterns and those
 * matching the given language. Sorts by evidence strength (highest
 * mean_score_delta first).
 */
export function formatKnowledgeForProposer(
  patterns: KnowledgePattern[],
  language: string | null,
  maxPatterns: number = 5,
): string {
  const relevant = patterns
    .filter((p) => !p.rejected)
    .filter(
      (p) =>
        p.type === 'universal' ||
        (language !== null && p.evidence.languages.includes(language)),
    )
    .sort((a, b) => b.evidence.mean_score_delta - a.evidence.mean_score_delta)
    .slice(0, maxPatterns);

  if (relevant.length === 0) return '';

  const lines = relevant.map(
    (p) =>
      `- ${p.description} (${p.type}, avg +${p.evidence.mean_score_delta.toFixed(1)} pts, ${p.evidence.repos_helped}/${p.evidence.repos_tested} repos)`,
  );

  return `## Known Patterns (from previous runs)\n\nThese patterns have improved scores in other projects. Consider applying if relevant:\n${lines.join('\n')}\n`;
}

/**
 * Format all patterns for the architect's context.
 *
 * Includes both accepted and rejected patterns so the architect
 * knows what worked and what to avoid.
 */
export function formatKnowledgeForArchitect(
  patterns: KnowledgePattern[],
  language: string | null,
): string {
  if (patterns.length === 0) return '';

  const accepted = patterns.filter((p) => !p.rejected);
  const rejected = patterns.filter((p) => p.rejected);

  const lines: string[] = ['## Knowledge Base\n'];

  if (accepted.length > 0) {
    lines.push('### Successful Patterns\n');
    for (const p of accepted.slice(0, 15)) {
      lines.push(
        `- ${p.description} (${p.type}, +${p.evidence.mean_score_delta.toFixed(1)} pts)`,
      );
    }
  }

  if (rejected.length > 0) {
    lines.push('\n### Failed Experiments (do NOT repeat these)\n');
    for (const p of rejected.slice(0, 10)) {
      lines.push(
        `- FAILED: ${p.description} (${p.evidence.mean_score_delta.toFixed(1)} pts)`,
      );
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Save per-project evolution history summary to ~/.kairn/knowledge/projects/<name>.json.
 */
export async function saveProjectHistory(
  projectName: string,
  summary: {
    bestScore: number;
    iterations: number;
    patternsDiscovered: string[];
  },
): Promise<void> {
  const projectsDir = getProjectsDir();
  await fs.mkdir(projectsDir, { recursive: true });
  const filePath = path.join(projectsDir, `${projectName}.json`);
  await fs.writeFile(filePath, JSON.stringify(summary, null, 2), 'utf-8');
}

/**
 * Load convergence analysis data from ~/.kairn/knowledge/convergence.json.
 *
 * Returns null if the file does not exist.
 */
export async function loadConvergence(): Promise<Record<
  string,
  KnowledgePattern
> | null> {
  try {
    const content = await fs.readFile(getConvergencePath(), 'utf-8');
    return JSON.parse(content) as Record<string, KnowledgePattern>;
  } catch {
    return null;
  }
}

/**
 * Save convergence analysis data (called by the research protocol).
 */
export async function saveConvergence(
  convergence: Record<string, KnowledgePattern>,
): Promise<void> {
  const dir = getKnowledgeDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    getConvergencePath(),
    JSON.stringify(convergence, null, 2),
    'utf-8',
  );
}
