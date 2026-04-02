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
/**
 * Find the best PBT result: check branch winners and synthesis output.
 * Returns the path to the best harness and a label describing its source.
 */
async function findBestPBTHarness(
  workspacePath: string,
): Promise<{ harnessPath: string; label: string } | null> {
  const branchesDir = path.join(workspacePath, 'branches');
  let branchEntries: string[];
  try {
    branchEntries = await fs.readdir(branchesDir);
  } catch {
    return null; // No PBT branches exist
  }

  let bestScore = -Infinity;
  let bestPath = '';
  let bestLabel = '';

  // Check each branch's best iteration
  for (const branchId of branchEntries) {
    const branchPath = path.join(branchesDir, branchId);
    const branchIterations = await listIterations(branchPath);
    if (branchIterations.length === 0) continue;

    const bestIter = await findBestIteration(branchPath, branchIterations);
    const log = await loadIterationLog(branchPath, bestIter);
    const score = log?.score ?? 0;

    if (score > bestScore) {
      bestScore = score;
      bestPath = path.join(branchPath, 'iterations', bestIter.toString(), 'harness');
      bestLabel = `branch ${branchId}, iteration ${bestIter} (${score.toFixed(1)}%)`;
    }
  }

  // Check synthesis output
  const synthesisHarness = path.join(workspacePath, 'synthesis', 'harness');
  try {
    await fs.access(synthesisHarness);
    // Synthesis doesn't have iteration logs — check for a score file
    const synthesisLog = await loadIterationLog(workspacePath, 999);
    const synthScore = synthesisLog?.score ?? 0;
    if (synthScore > bestScore) {
      bestScore = synthScore;
      bestPath = synthesisHarness;
      bestLabel = `Meta-Principal synthesis (${synthScore.toFixed(1)}%)`;
    }
  } catch {
    // No synthesis output
  }

  if (!bestPath) return null;
  return { harnessPath: bestPath, label: bestLabel };
}

export async function applyEvolution(
  workspacePath: string,
  projectRoot: string,
  targetIteration?: number,
  pbt?: boolean,
): Promise<ApplyResult> {
  // PBT mode: find best across branches and synthesis
  if (pbt) {
    const pbtResult = await findBestPBTHarness(workspacePath);
    if (!pbtResult) {
      throw new Error('No PBT results found. Run `kairn evolve pbt` first.');
    }

    const claudeDir = path.join(projectRoot, '.claude');
    const diffPreview = await generateDiff(claudeDir, pbtResult.harnessPath);

    const currentFiles = await listFilesRecursive(claudeDir);
    const targetFiles = await listFilesRecursive(pbtResult.harnessPath);
    const allPaths = new Set([...currentFiles, ...targetFiles]);
    const filesChanged: string[] = [];
    for (const filePath of allPaths) {
      const currentContent = await fs.readFile(path.join(claudeDir, filePath), 'utf-8').catch(() => null);
      const targetContent = await fs.readFile(path.join(pbtResult.harnessPath, filePath), 'utf-8').catch(() => null);
      if (currentContent !== targetContent) {
        filesChanged.push(filePath);
      }
    }

    await fs.rm(claudeDir, { recursive: true, force: true });
    await copyDir(pbtResult.harnessPath, claudeDir);

    // Copy .mcp.json if present
    const harnessMcpJson = path.join(pbtResult.harnessPath, '.mcp.json');
    const projectMcpJson = path.join(projectRoot, '.mcp.json');
    try {
      await fs.access(harnessMcpJson);
      await fs.copyFile(harnessMcpJson, projectMcpJson);
      if (!filesChanged.includes('.mcp.json')) filesChanged.push('.mcp.json');
    } catch {
      // No .mcp.json in harness
    }

    return {
      iteration: -1, // signals PBT source
      filesChanged,
      diffPreview,
    };
  }

  // Standard mode: find best among top-level iterations
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

  // Copy .mcp.json from harness if it exists (harness scope includes MCP config)
  const harnessMcpJson = path.join(harnessPath, '.mcp.json');
  const projectMcpJson = path.join(projectRoot, '.mcp.json');
  try {
    await fs.access(harnessMcpJson);
    const currentMcp = await fs.readFile(projectMcpJson, 'utf-8').catch(() => null);
    const targetMcp = await fs.readFile(harnessMcpJson, 'utf-8').catch(() => null);
    if (currentMcp !== targetMcp) {
      filesChanged.push('.mcp.json');
    }
    await fs.copyFile(harnessMcpJson, projectMcpJson);
  } catch {
    // No .mcp.json in harness — leave project's .mcp.json untouched
  }

  return {
    iteration: iter,
    filesChanged,
    diffPreview,
  };
}
