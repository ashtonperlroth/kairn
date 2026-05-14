import { describe, expect, it } from 'vitest';
import {
  checkEvolveBudgets,
  forecastEvolveBudget,
  formatBudgetForecast,
} from '../budget.js';
import type { EvolveConfig, Task } from '../types.js';

function makeConfig(overrides: Partial<EvolveConfig> = {}): EvolveConfig {
  return {
    model: 'claude-sonnet-4-6',
    proposerModel: 'claude-sonnet-4-6',
    scorer: 'pass-fail',
    maxIterations: 2,
    parallelTasks: 1,
    runsPerTask: 1,
    maxMutationsPerIteration: 3,
    pruneThreshold: 95,
    maxTaskDrop: 20,
    usePrincipal: false,
    evalSampleSize: 0,
    samplingStrategy: 'thompson',
    klLambda: 0.1,
    pbtBranches: 3,
    architectEvery: 3,
    schedule: 'explore-exploit',
    architectModel: 'claude-sonnet-4-6',
    budgets: {},
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    template: 'add-feature',
    description: 'Add a health endpoint',
    setup: '',
    expected_outcome: 'GET /health returns 200',
    scoring: 'pass-fail',
    timeout: 60,
    ...overrides,
  };
}

describe('evolve budget forecasting', () => {
  it('estimates dry-run task, proposer, and run costs from planned work', () => {
    const forecast = forecastEvolveBudget(
      [makeTask(), makeTask({ id: 'task-2', scoring: 'llm-judge' })],
      makeConfig({ maxIterations: 3, runsPerTask: 2, usePrincipal: true }),
    );

    expect(forecast.taskRuns).toBe(12);
    expect(forecast.scorerCalls).toBe(6);
    expect(forecast.proposerCalls).toBeGreaterThan(0);
    expect(forecast.estimatedRunUSD).toBeGreaterThan(forecast.estimatedTaskUSD);
    expect(formatBudgetForecast(forecast).join('\n')).toContain('Run estimate');
  });

  it('reports budget exhaustion when forecast exceeds hard limits', () => {
    const forecast = forecastEvolveBudget(
      [makeTask()],
      makeConfig({ budgets: { runUSD: 0, taskUSD: 0 } }),
    );

    const result = checkEvolveBudgets(forecast, { runUSD: 0, taskUSD: 0 });

    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.field)).toEqual(
      expect.arrayContaining(['runUSD', 'taskUSD']),
    );
  });

  it('checks PBT budget against branch multiplier', () => {
    const forecast = forecastEvolveBudget(
      [makeTask()],
      makeConfig(),
      { pbtBranches: 4 },
    );

    const result = checkEvolveBudgets(forecast, { pbtUSD: forecast.estimatedRunUSD });

    expect(forecast.estimatedPbtUSD).toBeCloseTo(forecast.estimatedRunUSD * 4);
    expect(result.ok).toBe(false);
    expect(result.violations[0].field).toBe('pbtUSD');
  });

  it('forecasts zero architect calls when architect schedule is off', () => {
    const forecast = forecastEvolveBudget(
      [makeTask()],
      makeConfig({ maxIterations: 5, schedule: 'off', architectEvery: 0 }),
    );

    expect(forecast.architectCalls).toBe(0);
    expect(forecast.estimatedArchitectUSD).toBe(0);
  });
});
