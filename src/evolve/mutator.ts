import fs from 'fs/promises';
import path from 'path';
import { copyDir } from './baseline.js';
import type { Mutation } from './types.js';
import { parseHarness } from '../ir/parser.js';
import { translateMutations } from '../ir/translate.js';
import { applyIRMutation } from '../ir/mutations.js';
import { renderHarness } from '../ir/renderer.js';
import { diffIR, formatIRDiff } from '../ir/diff.js';
import type { HarnessIR } from '../ir/types.js';

/**
 * Apply mutations to a copy of the current harness using the IR pipeline.
 *
 * Pipeline:
 * 1. Parse the current harness into an IR
 * 2. Translate legacy Mutations into IRMutations
 * 3. Apply each IRMutation immutably (skip failures silently)
 * 4. Render the new IR to disk
 * 5. Apply any raw_text mutations via file-based string surgery (backward compat)
 * 6. Generate a structural diff between baseline and new IR
 *
 * Falls back to the legacy file-copy + string-surgery approach if IR parsing fails.
 *
 * @returns Path to new harness and diff patch string
 */
export async function applyMutations(
  currentHarnessPath: string,
  nextIterationDir: string,
  mutations: Mutation[],
): Promise<{ newHarnessPath: string; diffPatch: string }> {
  const newHarnessPath = path.join(nextIterationDir, 'harness');

  // Try the IR pipeline first
  let baselineIR: HarnessIR | null = null;
  try {
    baselineIR = await parseHarness(currentHarnessPath);
  } catch {
    // IR parsing failed — fall back to legacy approach
  }

  if (baselineIR !== null) {
    return applyMutationsViaIR(
      currentHarnessPath,
      newHarnessPath,
      mutations,
      baselineIR,
    );
  }

  // Legacy fallback: file-copy + string surgery
  return applyMutationsLegacy(currentHarnessPath, newHarnessPath, mutations);
}

/**
 * IR-based mutation pipeline.
 *
 * Strategy: copy the original harness first (preserving exact byte content),
 * then apply mutations through the IR engine. Only files affected by IR
 * mutations get re-rendered, so untouched files remain byte-identical.
 *
 * raw_text mutations are applied via legacy file-based string surgery after
 * the IR mutations, preserving backward compatibility for non-IR-translatable
 * mutations.
 */
async function applyMutationsViaIR(
  currentHarnessPath: string,
  newHarnessPath: string,
  mutations: Mutation[],
  baselineIR: HarnessIR,
): Promise<{ newHarnessPath: string; diffPatch: string }> {
  // 1. Copy the original harness to preserve exact byte content
  await copyDir(currentHarnessPath, newHarnessPath);

  // 2. Translate legacy mutations to IR mutations
  const irMutations = translateMutations(mutations, baselineIR);

  // 3. Apply IR mutations one by one, skipping failures silently.
  //    Track which IR node categories were touched so we only re-render those files.
  let currentIR = baselineIR;
  const rawTextMutations: Mutation[] = [];
  const touchedCategories = new Set<string>();

  for (let i = 0; i < irMutations.length; i++) {
    const irMut = irMutations[i];

    if (irMut.type === 'raw_text') {
      // Collect raw_text mutations for file-based application later
      rawTextMutations.push(mutations[i]);
      continue;
    }

    try {
      currentIR = applyIRMutation(currentIR, irMut);
      // Track which file category this mutation touched
      touchedCategories.add(getMutationCategory(irMut.type));
    } catch {
      // Skip failed mutations silently — matches old behavior where
      // a replace with missing oldText was simply skipped
      continue;
    }
  }

  // 4. Selectively re-render only files affected by IR mutations.
  //    This preserves byte-identical content for untouched files while
  //    applying structural changes through the IR engine.
  if (touchedCategories.size > 0) {
    await renderAffectedFiles(currentIR, newHarnessPath, touchedCategories);
  }

  // 5. Apply raw_text mutations via file-based string surgery
  for (const mutation of rawTextMutations) {
    await applyLegacyMutation(newHarnessPath, mutation);
  }

  // 6. Generate structural diff
  const irDiff = diffIR(baselineIR, currentIR);
  let diffPatch = formatIRDiff(irDiff);

  // If the IR diff says "No changes." but raw_text mutations were applied,
  // fall back to a file-based diff to capture those changes
  if (diffPatch === 'No changes.' && rawTextMutations.length > 0) {
    diffPatch = await generateDiffLegacy(currentHarnessPath, newHarnessPath);
  }

  // Normalize "No changes." to empty string for backward compatibility
  if (diffPatch === 'No changes.') {
    diffPatch = '';
  }

  return { newHarnessPath, diffPatch };
}

/**
 * Map an IR mutation type to the file category it affects.
 * Used to determine which files need re-rendering after IR mutations.
 */
function getMutationCategory(mutationType: string): string {
  if (mutationType.includes('section') || mutationType.includes('reorder')) {
    return 'claude_md';
  }
  if (mutationType.includes('command')) {
    return 'commands';
  }
  if (mutationType.includes('rule')) {
    return 'rules';
  }
  if (mutationType.includes('agent')) {
    return 'agents';
  }
  if (mutationType.includes('mcp')) {
    return 'mcp';
  }
  if (mutationType.includes('settings')) {
    return 'settings';
  }
  return 'unknown';
}

/**
 * Re-render only the files affected by IR mutations.
 *
 * Instead of re-rendering the entire harness (which can alter whitespace
 * in untouched files), this function renders the full file map from IR
 * and then selectively writes only files belonging to touched categories.
 *
 * For "remove" mutations (remove_rule, remove_command, etc.), the affected
 * file is deleted from disk since it won't appear in the rendered map.
 */
async function renderAffectedFiles(
  ir: HarnessIR,
  targetDir: string,
  touchedCategories: Set<string>,
): Promise<void> {
  const fileMap = renderHarness(ir);

  // Determine which rendered file paths belong to touched categories
  for (const [relativePath, content] of fileMap) {
    const category = getFileCategory(relativePath);
    if (touchedCategories.has(category)) {
      const fullPath = path.join(targetDir, relativePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
    }
  }

  // Handle deletions: for removed commands/rules/agents, delete files that
  // existed in the copy but are absent from the rendered map.
  if (touchedCategories.has('commands')) {
    await deleteOrphanedFiles(targetDir, 'commands', fileMap);
  }
  if (touchedCategories.has('rules')) {
    await deleteOrphanedFiles(targetDir, 'rules', fileMap);
  }
  if (touchedCategories.has('agents')) {
    await deleteOrphanedFiles(targetDir, 'agents', fileMap);
  }
}

/**
 * Map a relative file path to its category for selective rendering.
 */
function getFileCategory(relativePath: string): string {
  if (relativePath === 'CLAUDE.md') return 'claude_md';
  if (relativePath.startsWith('commands/')) return 'commands';
  if (relativePath.startsWith('rules/')) return 'rules';
  if (relativePath.startsWith('agents/')) return 'agents';
  if (relativePath.startsWith('skills/')) return 'skills';
  if (relativePath.startsWith('docs/')) return 'docs';
  if (relativePath.startsWith('hooks/')) return 'hooks';
  if (relativePath === 'settings.json') return 'settings';
  if (relativePath === '.mcp.json') return 'mcp';
  return 'unknown';
}

/**
 * Delete files in a subdirectory that are present on disk but absent from
 * the rendered file map. This handles "remove" IR mutations (e.g., remove_rule).
 */
async function deleteOrphanedFiles(
  targetDir: string,
  subdir: string,
  renderedMap: Map<string, string>,
): Promise<void> {
  const subdirPath = path.join(targetDir, subdir);
  let entries;
  try {
    entries = await fs.readdir(subdirPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    const relativePath = `${subdir}/${entry}`;
    if (!renderedMap.has(relativePath)) {
      await fs.unlink(path.join(subdirPath, entry)).catch(() => {});
    }
  }
}

/**
 * Legacy file-copy + string surgery approach (fallback when IR parsing fails).
 * Preserves the original v2.5.2 behavior exactly.
 */
async function applyMutationsLegacy(
  currentHarnessPath: string,
  newHarnessPath: string,
  mutations: Mutation[],
): Promise<{ newHarnessPath: string; diffPatch: string }> {
  // 1. Copy current harness to new iteration
  await copyDir(currentHarnessPath, newHarnessPath);

  // 2. Apply each mutation
  for (const mutation of mutations) {
    await applyLegacyMutation(newHarnessPath, mutation);
  }

  // 3. Generate diff
  const diffPatch = await generateDiffLegacy(currentHarnessPath, newHarnessPath);

  return { newHarnessPath, diffPatch };
}

/**
 * Apply a single legacy mutation to a file in the harness directory.
 * This is the original string-surgery approach used in v2.5.2.
 */
async function applyLegacyMutation(
  harnessPath: string,
  mutation: Mutation,
): Promise<void> {
  // Security: reject path traversal
  if (mutation.file.includes('..')) {
    return;
  }

  const filePath = path.join(harnessPath, mutation.file);

  if (mutation.action === 'replace') {
    if (!mutation.oldText) {
      return;
    }
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      return;
    }
    if (!content.includes(mutation.oldText)) {
      return;
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
      return;
    }
    let sectionContent: string;
    try {
      sectionContent = await fs.readFile(filePath, 'utf-8');
    } catch {
      return;
    }
    if (!sectionContent.includes(mutation.oldText)) {
      return;
    }
    await fs.writeFile(filePath, sectionContent.replace(mutation.oldText, ''), 'utf-8');
  } else if (mutation.action === 'delete_file') {
    await fs.unlink(filePath).catch(() => {});
  }
}

/**
 * Generate a simple unified-diff-style patch between two directories.
 * Compares files in both directories and outputs differences.
 *
 * Attempts to use the IR-based structural diff first. Falls back to the
 * legacy character-diff approach if IR parsing fails for either directory
 * or if the directories don't contain recognizable harness content.
 */
export async function generateDiff(
  oldDir: string,
  newDir: string,
): Promise<string> {
  // Try IR-based diff first — only if both directories have harness content
  try {
    const oldIR = await parseHarness(oldDir);
    const newIR = await parseHarness(newDir);

    // Only use IR diff if at least one directory has meaningful harness content
    // (sections, commands, rules, etc.). Otherwise fall through to legacy.
    const oldHasContent = oldIR.sections.length > 0 || oldIR.commands.length > 0 ||
      oldIR.rules.length > 0 || oldIR.agents.length > 0;
    const newHasContent = newIR.sections.length > 0 || newIR.commands.length > 0 ||
      newIR.rules.length > 0 || newIR.agents.length > 0;

    if (oldHasContent || newHasContent) {
      const irDiff = diffIR(oldIR, newIR);
      const formatted = formatIRDiff(irDiff);

      // "No changes." means identical — normalize to empty string for backward compat
      if (formatted === 'No changes.') {
        // Double-check with legacy diff in case there are non-IR file changes
        const legacyDiff = await generateDiffLegacy(oldDir, newDir);
        return legacyDiff;
      }

      // IR diff found structural changes — but also check for non-IR file changes
      const legacyDiff = await generateDiffLegacy(oldDir, newDir);
      if (legacyDiff && !formatted.includes(legacyDiff)) {
        return formatted + '\n\n' + legacyDiff;
      }
      return formatted;
    }
  } catch {
    // IR parsing failed — fall back to legacy diff
  }

  return generateDiffLegacy(oldDir, newDir);
}

/**
 * Legacy diff implementation: character-by-character comparison of all files.
 */
async function generateDiffLegacy(
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
