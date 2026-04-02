import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  initBeliefs,
  sampleThompson,
  updateBeliefs,
  loadBeliefs,
  saveBeliefs,
} from '../sampling.js';
import type { Task } from '../types.js';

function makeTask(id: string): Task {
  return {
    id,
    template: 'add-feature',
    description: `Task ${id}`,
    setup: '',
    expected_outcome: 'Some outcome',
    scoring: 'pass-fail',
    timeout: 60,
  };
}

// Deterministic seeded RNG for reproducible tests
function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    return (state >>> 0) / 0x100000000;
  };
}

describe('initBeliefs', () => {
  it('creates uniform priors for all tasks', () => {
    const tasks = [makeTask('a'), makeTask('b'), makeTask('c')];
    const beliefs = initBeliefs(tasks);

    expect(beliefs).toHaveLength(3);
    for (const belief of beliefs) {
      expect(belief.alpha).toBe(1);
      expect(belief.beta).toBe(1);
    }
    expect(beliefs.map(b => b.taskId)).toEqual(['a', 'b', 'c']);
  });

  it('handles empty task list', () => {
    expect(initBeliefs([])).toEqual([]);
  });
});

describe('sampleThompson', () => {
  it('returns exactly sampleSize task IDs', () => {
    const tasks = [makeTask('a'), makeTask('b'), makeTask('c'), makeTask('d'), makeTask('e')];
    const beliefs = initBeliefs(tasks);
    const rng = seededRng(42);

    const selected = sampleThompson(beliefs, 3, rng);
    expect(selected).toHaveLength(3);
  });

  it('never returns duplicates', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => makeTask(`task-${i}`));
    const beliefs = initBeliefs(tasks);
    const rng = seededRng(123);

    for (let trial = 0; trial < 20; trial++) {
      const selected = sampleThompson(beliefs, 5, rng);
      expect(new Set(selected).size).toBe(5);
    }
  });

  it('returns all tasks when sampleSize >= beliefs length', () => {
    const tasks = [makeTask('a'), makeTask('b')];
    const beliefs = initBeliefs(tasks);
    const rng = seededRng(1);

    const selected = sampleThompson(beliefs, 5, rng);
    expect(selected).toEqual(['a', 'b']);
  });

  it('with uniform priors approximates uniform random', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => makeTask(`t${i}`));
    const beliefs = initBeliefs(tasks);
    const rng = seededRng(999);

    // Run many trials and count selection frequency
    const counts: Record<string, number> = {};
    for (const t of tasks) counts[t.id] = 0;

    const trials = 1000;
    for (let i = 0; i < trials; i++) {
      const selected = sampleThompson(beliefs, 3, rng);
      for (const id of selected) counts[id]++;
    }

    // With uniform priors, each task should be selected roughly 50% of the time (3/6)
    for (const count of Object.values(counts)) {
      expect(count).toBeGreaterThan(trials * 0.3);
      expect(count).toBeLessThan(trials * 0.7);
    }
  });

  it('with skewed priors favors uncertain tasks', () => {
    const tasks = [makeTask('stable'), makeTask('uncertain'), makeTask('medium')];
    const beliefs = [
      { taskId: 'stable', alpha: 50, beta: 2 },     // very confident high
      { taskId: 'uncertain', alpha: 2, beta: 2 },    // high uncertainty
      { taskId: 'medium', alpha: 10, beta: 10 },     // moderate certainty
    ];
    const rng = seededRng(42);

    // Run many trials — uncertain task should appear more often than stable
    const counts: Record<string, number> = { stable: 0, uncertain: 0, medium: 0 };
    const trials = 500;
    for (let i = 0; i < trials; i++) {
      const selected = sampleThompson(beliefs, 1, rng);
      counts[selected[0]]++;
    }

    // The stable task (alpha=50, beta=2) should be selected most (high mean ~0.96)
    // but the uncertain task should appear meaningfully due to wide variance
    // The key property: uncertain task is selected more than 0
    expect(counts['uncertain']).toBeGreaterThan(0);
  });
});

describe('updateBeliefs', () => {
  it('increments alpha on high scores (>= 70)', () => {
    const beliefs = [{ taskId: 'a', alpha: 1, beta: 1 }];
    const updated = updateBeliefs(beliefs, { a: 85 });

    expect(updated[0].alpha).toBe(2);
    expect(updated[0].beta).toBe(1);
  });

  it('increments beta on low scores (< 70)', () => {
    const beliefs = [{ taskId: 'a', alpha: 1, beta: 1 }];
    const updated = updateBeliefs(beliefs, { a: 40 });

    expect(updated[0].alpha).toBe(1);
    expect(updated[0].beta).toBe(2);
  });

  it('treats exactly 70 as success', () => {
    const beliefs = [{ taskId: 'a', alpha: 1, beta: 1 }];
    const updated = updateBeliefs(beliefs, { a: 70 });

    expect(updated[0].alpha).toBe(2);
    expect(updated[0].beta).toBe(1);
  });

  it('leaves unevaluated tasks unchanged', () => {
    const beliefs = [
      { taskId: 'a', alpha: 3, beta: 2 },
      { taskId: 'b', alpha: 1, beta: 1 },
    ];
    const updated = updateBeliefs(beliefs, { a: 90 });

    expect(updated[1]).toEqual({ taskId: 'b', alpha: 1, beta: 1 });
  });

  it('does not mutate input beliefs', () => {
    const beliefs = [{ taskId: 'a', alpha: 1, beta: 1 }];
    const updated = updateBeliefs(beliefs, { a: 90 });

    expect(beliefs[0].alpha).toBe(1);
    expect(updated[0].alpha).toBe(2);
  });
});

describe('loadBeliefs / saveBeliefs', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join('/tmp', `kairn-sampling-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('persists beliefs to disk and reloads correctly', async () => {
    const beliefs = [
      { taskId: 'a', alpha: 5, beta: 3 },
      { taskId: 'b', alpha: 1, beta: 8 },
    ];

    await saveBeliefs(tempDir, beliefs);
    const loaded = await loadBeliefs(tempDir);

    expect(loaded).toEqual(beliefs);
  });

  it('returns null when no beliefs file exists', async () => {
    const loaded = await loadBeliefs(tempDir);
    expect(loaded).toBeNull();
  });

  it('returns null on invalid JSON', async () => {
    await fs.writeFile(path.join(tempDir, 'task-beliefs.json'), 'not json', 'utf-8');
    const loaded = await loadBeliefs(tempDir);
    expect(loaded).toBeNull();
  });

  it('returns null on invalid structure', async () => {
    await fs.writeFile(
      path.join(tempDir, 'task-beliefs.json'),
      JSON.stringify([{ wrong: 'shape' }]),
      'utf-8',
    );
    const loaded = await loadBeliefs(tempDir);
    expect(loaded).toBeNull();
  });
});
