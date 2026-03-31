import fs from 'fs/promises';
import path from 'path';

/**
 * Creates a baseline snapshot of the .claude/ directory.
 */
export async function snapshotBaseline(
  projectRoot: string,
  workspacePath: string,
): Promise<void> {
  const claudeDir = path.join(projectRoot, '.claude');
  const baselineDir = path.join(workspacePath, 'baseline');

  // Check if .claude exists
  try {
    await fs.access(claudeDir);
  } catch {
    throw new Error(`.claude/ directory not found in ${projectRoot}`);
  }

  // Recursively copy .claude/ to baseline/
  await copyDir(claudeDir, baselineDir);
}

/**
 * Recursively copy directory.
 */
async function copyDir(src: string, dest: string): Promise<void> {
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
