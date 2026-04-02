import fs from 'fs/promises';
import path from 'path';

/**
 * Metrics capturing the complexity of a harness directory.
 */
export interface ComplexityMetrics {
  totalLines: number;        // total lines across all harness files
  totalFiles: number;        // number of files in harness
  totalSections: number;     // number of ## sections in CLAUDE.md
  totalRules: number;        // number of files in rules/
  totalCommands: number;     // number of files in commands/
  diffFromBaseline: number;  // character-level diff ratio (normalized 0-1)
}

/**
 * Measure the complexity of a harness directory.
 *
 * Counts total lines, files, CLAUDE.md sections, rules/ files, and commands/ files.
 * The diffFromBaseline field is set to 0 here — use computeComplexityCost for comparison.
 */
export async function measureComplexity(harnessPath: string): Promise<ComplexityMetrics> {
  let totalLines = 0;
  let totalFiles = 0;
  let totalSections = 0;
  let totalRules = 0;
  let totalCommands = 0;

  const allContent = await readAllFilesRecursive(harnessPath);

  for (const [relativePath, content] of Object.entries(allContent)) {
    totalFiles++;
    totalLines += content.split('\n').length;

    // Count ## sections in CLAUDE.md
    if (relativePath === 'CLAUDE.md') {
      const sectionMatches = content.match(/^##\s/gm);
      totalSections = sectionMatches ? sectionMatches.length : 0;
    }

    // Count rules/ and commands/ files
    if (relativePath.startsWith('rules/') || relativePath.startsWith('rules\\')) {
      totalRules++;
    }
    if (relativePath.startsWith('commands/') || relativePath.startsWith('commands\\')) {
      totalCommands++;
    }
  }

  return {
    totalLines,
    totalFiles,
    totalSections,
    totalRules,
    totalCommands,
    diffFromBaseline: 0,
  };
}

/**
 * Compute a weighted complexity cost between current and baseline harness metrics.
 *
 * Cost components:
 * - Lines added beyond baseline: +0.3 per line (normalized by baseline)
 * - Files added beyond baseline: +5.0 per file (normalized by baseline)
 * - Net character diff ratio (0 = identical, 1 = completely rewritten)
 *
 * Returns a non-negative number. A return of 0 means identical to baseline.
 * Can return negative values when the current harness is simpler (complexity bonus).
 */
export function computeComplexityCost(
  current: ComplexityMetrics,
  baseline: ComplexityMetrics,
): number {
  // Line cost: normalized by baseline size (capped at a minimum of 1 to avoid division by zero)
  const baselineLines = Math.max(baseline.totalLines, 1);
  const lineDelta = (current.totalLines - baseline.totalLines) / baselineLines;
  const lineCost = lineDelta * 0.3;

  // File cost: each added file is expensive
  const baselineFiles = Math.max(baseline.totalFiles, 1);
  const fileDelta = (current.totalFiles - baseline.totalFiles) / baselineFiles;
  const fileCost = fileDelta * 5.0;

  // Diff ratio is stored in current.diffFromBaseline if pre-computed
  const diffCost = current.diffFromBaseline;

  return lineCost + fileCost + diffCost;
}

/**
 * Apply KL penalty to a raw score.
 *
 * effective_score = rawScore - lambda * complexityCost * 100
 *
 * When lambda = 0, returns rawScore unchanged (regularization disabled).
 *
 * @param rawScore - The raw aggregate score (0-100)
 * @param complexityCost - Complexity cost from computeComplexityCost
 * @param lambda - Regularization strength (default 0.1)
 * @returns Penalized score
 */
export function applyKLPenalty(
  rawScore: number,
  complexityCost: number,
  lambda: number,
): number {
  if (lambda === 0) return rawScore;
  return rawScore - lambda * complexityCost * 100;
}

/**
 * Compute a character-level diff ratio between two harness directories.
 * Returns a value in [0, 1] where 0 means identical content and 1 means completely different.
 */
export async function computeDiffRatio(
  currentPath: string,
  baselinePath: string,
): Promise<number> {
  const currentFiles = await readAllFilesRecursive(currentPath);
  const baselineFiles = await readAllFilesRecursive(baselinePath);

  const allPaths = new Set([
    ...Object.keys(currentFiles),
    ...Object.keys(baselineFiles),
  ]);

  if (allPaths.size === 0) return 0;

  let totalChars = 0;
  let diffChars = 0;

  for (const filePath of allPaths) {
    const currentContent = currentFiles[filePath] ?? '';
    const baselineContent = baselineFiles[filePath] ?? '';

    const maxLen = Math.max(currentContent.length, baselineContent.length);
    totalChars += maxLen;

    if (currentContent !== baselineContent) {
      // Simple character-level diff: count differing characters
      const minLen = Math.min(currentContent.length, baselineContent.length);
      let charDiffs = Math.abs(currentContent.length - baselineContent.length);
      for (let i = 0; i < minLen; i++) {
        if (currentContent[i] !== baselineContent[i]) charDiffs++;
      }
      diffChars += charDiffs;
    }
  }

  return totalChars > 0 ? diffChars / totalChars : 0;
}

/**
 * Recursively read all files in a directory into a map of relative path -> content.
 */
async function readAllFilesRecursive(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

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
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        try {
          result[relativePath] = await fs.readFile(fullPath, 'utf-8');
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(dir);
  return result;
}
