import fs from 'fs/promises';
import path from 'path';
import { copyDir } from './baseline.js';
import { generateDiff } from './mutator.js';
import { loadIterationLog } from './trace.js';

export interface ApplyResult {
  iteration: number;
  filesChanged: string[];
  diffPreview: string;
}

/**
 * Find all iteration directories in the workspace and return their numbers.
 */
async function listIterations(workspacePath: string): Promise<number[]> {
  const iterationsDir = path.join(workspacePath, 'iterations');
  let entries: string[];
  try {
    entries = await fs.readdir(iterationsDir);
  } catch {
    return [];
  }

  const nums: number[] = [];
  for (const entry of entries) {
    const n = parseInt(entry, 10);
    if (!isNaN(n)) {
      try {
        await fs.access(path.join(iterationsDir, entry, 'harness'));
        nums.push(n);
      } catch {
        // skip entries without a harness directory
      }
    }
  }
  return nums.sort((a, b) => a - b);
}

/**
 * Find the best iteration by score across all iteration logs.
 */
async function findBestIteration(
  workspacePath: string,
  iterations: number[],
): Promise<number> {
  let bestIter = iterations[0];
  let bestScore = -Infinity;

  for (const iter of iterations) {
    const log = await loadIterationLog(workspacePath, iter);
    const score = log?.score ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestIter = iter;
    }
  }

  return bestIter;
}

/**
 * List all files in a directory recursively, returning relative paths.
 */
async function listFilesRecursive(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        results.push(path.relative(dir, fullPath));
      }
    }
  }

  await walk(dir);
  return results;
}

/**
 * Apply an evolved harness to the project's .claude/ directory.
 *
 * 1. Determines target iteration (best by score, or user-specified)
 * 2. Generates a unified diff between current .claude/ and target harness
 * 3. Replaces .claude/ with the target harness
 *
 * @param workspacePath - Path to .kairn-evolve/ directory
 * @param projectRoot - Path to the project root (parent of .claude/)
 * @param targetIteration - Specific iteration to apply (undefined = best)
 * @returns ApplyResult with iteration number, changed files, and diff preview
 */
export async function applyEvolution(
  workspacePath: string,
  projectRoot: string,
  targetIteration?: number,
): Promise<ApplyResult> {
  const iterations = await listIterations(workspacePath);

  if (iterations.length === 0) {
    throw new Error('No iterations found in workspace. Run `kairn evolve run` first.');
  }

  let iter: number;
  if (targetIteration !== undefined) {
    if (!iterations.includes(targetIteration)) {
      throw new Error(
        `Iteration ${targetIteration} not found. Available: ${iterations.join(', ')}`,
      );
    }
    iter = targetIteration;
  } else {
    iter = await findBestIteration(workspacePath, iterations);
  }

  const harnessPath = path.join(
    workspacePath,
    'iterations',
    iter.toString(),
    'harness',
  );
  const claudeDir = path.join(projectRoot, '.claude');

  const diffPreview = await generateDiff(claudeDir, harnessPath);

  const currentFiles = await listFilesRecursive(claudeDir);
  const targetFiles = await listFilesRecursive(harnessPath);
  const allPaths = new Set([...currentFiles, ...targetFiles]);
  const filesChanged: string[] = [];
  for (const filePath of allPaths) {
    const currentContent = await fs.readFile(path.join(claudeDir, filePath), 'utf-8').catch(() => null);
    const targetContent = await fs.readFile(path.join(harnessPath, filePath), 'utf-8').catch(() => null);
    if (currentContent !== targetContent) {
      filesChanged.push(filePath);
    }
  }

  await fs.rm(claudeDir, { recursive: true, force: true });
  await copyDir(harnessPath, claudeDir);

  return {
    iteration: iter,
    filesChanged,
    diffPreview,
  };
}
