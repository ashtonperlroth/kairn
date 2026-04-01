import fs from 'fs/promises';
import path from 'path';
import type { HarnessSnapshot } from './types.js';

/**
 * Creates a baseline snapshot of the .claude/ directory.
 * Copies to both baseline/ and iterations/0/harness/ in the workspace.
 */
export async function snapshotBaseline(
  projectRoot: string,
  workspacePath: string,
): Promise<void> {
  const claudeDir = path.join(projectRoot, '.claude');
  const baselineDir = path.join(workspacePath, 'baseline');
  const iter0Dir = path.join(workspacePath, 'iterations', '0', 'harness');

  try {
    await fs.access(claudeDir);
  } catch {
    throw new Error(`.claude/ directory not found in ${projectRoot}`);
  }

  await copyDir(claudeDir, baselineDir);
  await copyDir(claudeDir, iter0Dir);

  // Include .mcp.json in harness scope if it exists
  const mcpJsonPath = path.join(projectRoot, '.mcp.json');
  try {
    await fs.access(mcpJsonPath);
    await fs.copyFile(mcpJsonPath, path.join(baselineDir, '.mcp.json'));
    await fs.copyFile(mcpJsonPath, path.join(iter0Dir, '.mcp.json'));
  } catch {
    // .mcp.json doesn't exist — skip
  }
}

/**
 * Recursively copies a directory from src to dest.
 * Creates dest (and any missing parent directories) if it does not exist.
 */
export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Loads a HarnessSnapshot from a harness directory path.
 * Verifies the directory exists before returning.
 */
export async function loadHarnessSnapshot(
  harnessDir: string,
  iteration: number,
): Promise<HarnessSnapshot> {
  try {
    await fs.access(harnessDir);
  } catch {
    throw new Error(`Harness directory not found: ${harnessDir}`);
  }

  return { path: harnessDir, iteration };
}
