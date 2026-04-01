import fs from 'fs/promises';
import path from 'path';
import { copyDir } from './baseline.js';
import type { Mutation } from './types.js';

/**
 * Apply mutations to a copy of the current harness.
 *
 * 1. Copies currentHarnessPath to {nextIterationDir}/harness/
 * 2. Applies each mutation in order
 * 3. Generates a unified diff between old and new harness
 *
 * @returns Path to new harness and diff patch string
 */
export async function applyMutations(
  currentHarnessPath: string,
  nextIterationDir: string,
  mutations: Mutation[],
): Promise<{ newHarnessPath: string; diffPatch: string }> {
  const newHarnessPath = path.join(nextIterationDir, 'harness');

  // 1. Copy current harness to new iteration
  await copyDir(currentHarnessPath, newHarnessPath);

  // 2. Apply each mutation
  for (const mutation of mutations) {
    // Security: reject path traversal
    if (mutation.file.includes('..')) {
      continue;
    }

    const filePath = path.join(newHarnessPath, mutation.file);

    if (mutation.action === 'replace') {
      if (!mutation.oldText) {
        continue;
      }
      const content = await fs.readFile(filePath, 'utf-8');
      if (!content.includes(mutation.oldText)) {
        continue;
      }
      // Replace first occurrence only — intentional for surgical mutations
      await fs.writeFile(
        filePath,
        content.replace(mutation.oldText, mutation.newText),
        'utf-8',
      );
    } else if (mutation.action === 'add_section') {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        await fs.writeFile(
          filePath,
          content + '\n\n' + mutation.newText,
          'utf-8',
        );
      } catch {
        // File doesn't exist — create it
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, mutation.newText, 'utf-8');
      }
    } else if (mutation.action === 'create_file') {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, mutation.newText, 'utf-8');
    } else if (mutation.action === 'delete_section') {
      if (!mutation.oldText) {
        continue;
      }
      let sectionContent: string;
      try {
        sectionContent = await fs.readFile(filePath, 'utf-8');
      } catch {
        continue;
      }
      if (!sectionContent.includes(mutation.oldText)) {
        continue;
      }
      await fs.writeFile(filePath, sectionContent.replace(mutation.oldText, ''), 'utf-8');
    } else if (mutation.action === 'delete_file') {
      await fs.unlink(filePath).catch(() => {});
    }
  }

  // 3. Generate diff
  const diffPatch = await generateDiff(currentHarnessPath, newHarnessPath);

  return { newHarnessPath, diffPatch };
}

/**
 * Generate a simple unified-diff-style patch between two directories.
 * Compares files in both directories and outputs differences.
 */
export async function generateDiff(
  oldDir: string,
  newDir: string,
): Promise<string> {
  const oldFiles = await readAllFiles(oldDir);
  const newFiles = await readAllFiles(newDir);

  const allPaths = new Set([
    ...Object.keys(oldFiles),
    ...Object.keys(newFiles),
  ]);
  const patches: string[] = [];

  for (const filePath of [...allPaths].sort()) {
    const oldContent = oldFiles[filePath] ?? '';
    const newContent = newFiles[filePath] ?? '';

    if (oldContent === newContent) continue;

    patches.push(`--- a/${filePath}`);
    patches.push(`+++ b/${filePath}`);

    if (!oldContent) {
      // New file
      for (const line of newContent.split('\n')) {
        patches.push(`+${line}`);
      }
    } else if (!newContent) {
      // Deleted file
      for (const line of oldContent.split('\n')) {
        patches.push(`-${line}`);
      }
    } else {
      // Modified — show old lines as removed, new lines as added
      const oldLines = oldContent.split('\n');
      const newLines = newContent.split('\n');
      for (const line of oldLines) {
        patches.push(`-${line}`);
      }
      for (const line of newLines) {
        patches.push(`+${line}`);
      }
    }
    patches.push('');
  }

  return patches.join('\n');
}

/**
 * Recursively read all files in a directory into a map of relative path -> content.
 */
async function readAllFiles(dir: string): Promise<Record<string, string>> {
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
        result[relativePath] = await fs.readFile(fullPath, 'utf-8');
      }
    }
  }

  await walk(dir);
  return result;
}
