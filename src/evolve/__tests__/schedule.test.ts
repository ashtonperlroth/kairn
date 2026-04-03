import { describe, it, expect } from 'vitest';
import { computeMutationCap } from '../loop.js';
import { shouldUseArchitect, computeArchitectMutationBudget } from '../schedule.js';

describe('computeMutationCap (exploration/exploitation schedule)', () => {
  it('returns full cap for early iterations (first 40%)', () => {
    // Iteration 0 of 10: progress=0, exploration phase
    expect(computeMutationCap(0, 10, 5)).toBe(5);
    // Iteration 3 of 10: progress=0.33, still exploration
    expect(computeMutationCap(3, 10, 5)).toBe(5);
  });

  it('decays cap for late iterations (last 60%)', () => {
    // Iteration 9 of 10: progress=1.0, full exploitation
    expect(computeMutationCap(9, 10, 5)).toBe(1);
  });

  it('minimum cap is always 1', () => {
    expect(computeMutationCap(99, 100, 10)).toBe(1);
    expect(computeMutationCap(9, 10, 1)).toBe(1);
  });

  it('returns maxMutations for single-iteration runs', () => {
    expect(computeMutationCap(0, 1, 5)).toBe(5);
  });

  it('decays linearly between 40% and 100% progress', () => {
    const caps: number[] = [];
    for (let i = 0; i < 10; i++) {
      caps.push(computeMutationCap(i, 10, 5));
    }
    // First 4 should be 5 (exploration)
    expect(caps[0]).toBe(5);
    expect(caps[3]).toBe(5);
    // Middle should be between 1 and 5
    expect(caps[6]).toBeGreaterThanOrEqual(1);
    expect(caps[6]).toBeLessThanOrEqual(5);
    // Last should be 1
    expect(caps[9]).toBe(1);
    // Should be monotonically non-increasing from iteration 4 onward
    for (let i = 5; i < 10; i++) {
      expect(caps[i]).toBeLessThanOrEqual(caps[i - 1]);
    }
  });

  it('is deterministic — same inputs always produce same output', () => {
    const a = computeMutationCap(5, 10, 3);
    const b = computeMutationCap(5, 10, 3);
    expect(a).toBe(b);
  });
});

describe('shouldUseArchitect', () => {
  it('never returns true on iteration 0 (baseline evaluation)', () => {
    expect(shouldUseArchitect(0, 10, 'constant', 3)).toBe(false);
    expect(shouldUseArchitect(0, 10, 'explore-exploit', 3)).toBe(false);
    expect(shouldUseArchitect(0, 10, 'adaptive', 3, [80, 80])).toBe(false);
  });

  it('never returns true on the last iteration', () => {
    expect(shouldUseArchitect(9, 10, 'constant', 3)).toBe(false);
    expect(shouldUseArchitect(9, 10, 'explore-exploit', 3)).toBe(false);
    expect(shouldUseArchitect(9, 10, 'adaptive', 3, [80, 80, 80])).toBe(false);
  });

  describe('constant schedule', () => {
    it('returns true on multiples of architectEvery', () => {
      expect(shouldUseArchitect(3, 10, 'constant', 3)).toBe(true);
      expect(shouldUseArchitect(6, 10, 'constant', 3)).toBe(true);
    });

    it('returns false on non-multiples of architectEvery', () => {
      expect(shouldUseArchitect(1, 10, 'constant', 3)).toBe(false);
      expect(shouldUseArchitect(2, 10, 'constant', 3)).toBe(false);
      expect(shouldUseArchitect(4, 10, 'constant', 3)).toBe(false);
      expect(shouldUseArchitect(5, 10, 'constant', 3)).toBe(false);
    });
  });

  describe('explore-exploit schedule', () => {
    it('returns true on iterations 1 and 2 (early exploration)', () => {
      expect(shouldUseArchitect(1, 10, 'explore-exploit', 5)).toBe(true);
      expect(shouldUseArchitect(2, 10, 'explore-exploit', 5)).toBe(true);
    });

    it('returns true on Nth iterations after early exploration', () => {
      expect(shouldUseArchitect(5, 10, 'explore-exploit', 5)).toBe(true);
    });

    it('returns false on non-Nth iterations after early exploration', () => {
      expect(shouldUseArchitect(3, 10, 'explore-exploit', 5)).toBe(false);
      expect(shouldUseArchitect(4, 10, 'explore-exploit', 5)).toBe(false);
      expect(shouldUseArchitect(6, 10, 'explore-exploit', 5)).toBe(false);
      expect(shouldUseArchitect(7, 10, 'explore-exploit', 5)).toBe(false);
      expect(shouldUseArchitect(8, 10, 'explore-exploit', 5)).toBe(false);
    });
  });

  describe('adaptive schedule', () => {
    it('returns false when scores are improving', () => {
      // Scores are improving: 70 -> 75 -> 80 (range = 10 >= 1)
      expect(shouldUseArchitect(3, 10, 'adaptive', 3, [70, 75, 80])).toBe(false);
    });

    it('returns true when scores plateau (range < 1 point)', () => {
      // Scores are plateaued: 80.0 -> 80.2 -> 80.1 (range = 0.2 < 1)
      expect(shouldUseArchitect(3, 10, 'adaptive', 3, [80.0, 80.2, 80.1])).toBe(true);
    });

    it('returns false with insufficient data (fewer than 2 scores)', () => {
      expect(shouldUseArchitect(1, 10, 'adaptive', 3, [])).toBe(false);
      expect(shouldUseArchitect(1, 10, 'adaptive', 3, [80])).toBe(false);
      expect(shouldUseArchitect(1, 10, 'adaptive', 3)).toBe(false);
    });

    it('uses last 3 scores for plateau detection', () => {
      // Old improvement followed by recent plateau
      // recentScores = [50, 60, 80.0, 80.2, 80.1]
      // Last 3 are [80.0, 80.2, 80.1] => range = 0.2 < 1 => plateau
      expect(shouldUseArchitect(5, 10, 'adaptive', 3, [50, 60, 80.0, 80.2, 80.1])).toBe(true);
    });
  });

  it('returns false for an unknown schedule strategy', () => {
    // Force an unknown schedule to test the default branch
    expect(shouldUseArchitect(3, 10, 'unknown' as 'constant', 3)).toBe(false);
  });
});

describe('computeArchitectMutationBudget', () => {
  it('returns 10 for early iterations (progress < 0.5)', () => {
    expect(computeArchitectMutationBudget(0, 10)).toBe(10);
    expect(computeArchitectMutationBudget(1, 10)).toBe(10);
    expect(computeArchitectMutationBudget(4, 10)).toBe(10);
  });

  it('returns 7 for mid iterations (progress 0.5 to 0.75)', () => {
    expect(computeArchitectMutationBudget(5, 10)).toBe(7);
    expect(computeArchitectMutationBudget(6, 10)).toBe(7);
    expect(computeArchitectMutationBudget(7, 10)).toBe(7);
  });

  it('returns 5 for late iterations (progress >= 0.75)', () => {
    expect(computeArchitectMutationBudget(8, 10)).toBe(5);
    expect(computeArchitectMutationBudget(9, 10)).toBe(5);
  });

  it('handles edge case of single iteration', () => {
    // progress = 0/1 = 0 < 0.5
    expect(computeArchitectMutationBudget(0, 1)).toBe(10);
  });

  it('is deterministic', () => {
    const a = computeArchitectMutationBudget(5, 10);
    const b = computeArchitectMutationBudget(5, 10);
    expect(a).toBe(b);
  });
});
