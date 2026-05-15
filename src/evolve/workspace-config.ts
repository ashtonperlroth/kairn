import fs from 'fs/promises';
import path from 'path';
import { parse as yamlParse } from 'yaml';

const DEFAULT_MIN_MEASURED_TASKS_FOR_BEST = 1;

export async function loadMinMeasuredTasksForBest(workspacePath: string): Promise<number> {
  try {
    const configStr = await fs.readFile(path.join(workspacePath, 'config.yaml'), 'utf-8');
    const parsed = yamlParse(configStr) as Record<string, unknown>;
    const value = parsed.min_measured_tasks_for_best;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
  } catch {
    // Older workspaces may not have config.yaml or this key.
  }

  return DEFAULT_MIN_MEASURED_TASKS_FOR_BEST;
}
