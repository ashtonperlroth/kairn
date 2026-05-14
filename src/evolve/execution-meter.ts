import fs from 'fs/promises';
import path from 'path';
import { callLLM } from '../llm.js';
import {
  aggregateCostByPhase,
  aggregateTelemetry,
  estimateCost,
  estimateTelemetry,
  unavailableTelemetry,
} from './cost.js';
import type { KairnConfig } from '../types.js';
import type {
  CostTelemetry,
  EvolveTelemetry,
  TelemetryPhase,
  UsageTelemetry,
} from './cost.js';
import type { EvolveBudgetConfig } from './types.js';

export interface MeteredResult<T> {
  result: T;
  telemetry: EvolveTelemetry;
}

export interface MeteredCallOptions<T> {
  phase: TelemetryPhase;
  model: string;
  inputText?: string;
  source: string;
  budgetField?: keyof EvolveBudgetConfig;
  deriveTelemetry?: (result: T, durationMs: number) => EvolveTelemetry;
  estimateOutputText?: (result: T) => string;
}

export interface ExecutionMeterOptions {
  globalBudgetField?: Extract<keyof EvolveBudgetConfig, 'runUSD' | 'pbtUSD'>;
}

export class BudgetExhaustedError extends Error {
  constructor(
    public readonly phase: TelemetryPhase,
    public readonly field: keyof EvolveBudgetConfig,
    public readonly limitUSD: number,
    public readonly spentUSD: number,
  ) {
    super(
      `Budget exhausted for ${phase}: ${spentUSD.toFixed(6)} USD exceeds ${field} limit ${limitUSD.toFixed(6)} USD`,
    );
    this.name = 'BudgetExhaustedError';
  }
}

export class ExecutionMeter {
  private readonly telemetryEntries: EvolveTelemetry[] = [];
  private readonly globalBudgetField: Extract<keyof EvolveBudgetConfig, 'runUSD' | 'pbtUSD'>;

  constructor(
    private readonly budgets: EvolveBudgetConfig | undefined = undefined,
    options: ExecutionMeterOptions = {},
  ) {
    this.globalBudgetField = options.globalBudgetField ?? 'runUSD';
  }

  checkpoint(): number {
    return this.telemetryEntries.length;
  }

  entries(): EvolveTelemetry[] {
    return [...this.telemetryEntries];
  }

  entriesSince(checkpoint: number): EvolveTelemetry[] {
    return this.telemetryEntries.slice(checkpoint);
  }

  aggregateSince(checkpoint: number, phase: TelemetryPhase, model = 'mixed'): EvolveTelemetry {
    return aggregateTelemetry(this.entriesSince(checkpoint), phase, model);
  }

  costByPhase() {
    return aggregateCostByPhase(this.telemetryEntries);
  }

  assertBudgetAvailable(
    phase: TelemetryPhase,
    budgetField?: keyof EvolveBudgetConfig,
  ): void {
    this.checkBudgets(phase, budgetField, 'before');
  }

  async run<T>(
    options: MeteredCallOptions<T>,
    call: () => Promise<T>,
  ): Promise<MeteredResult<T>> {
    this.checkBudgets(options.phase, options.budgetField, 'before');
    const started = Date.now();

    let result: T;
    try {
      result = await call();
    } catch (err) {
      const durationMs = Date.now() - started;
      const telemetry = options.inputText
        ? estimateTelemetry({
            phase: options.phase,
            model: options.model,
            durationMs,
            inputText: options.inputText,
            outputText: err instanceof Error ? err.message : String(err),
            source: options.source,
          })
        : unavailableTelemetry(
            options.phase,
            options.model,
            durationMs,
            'Call failed before token-bearing text was available',
          );

      this.record(telemetry);
      this.checkBudgets(options.phase, options.budgetField, 'after');
      throw err;
    }

    const durationMs = Date.now() - started;
    const telemetry = options.deriveTelemetry
      ? options.deriveTelemetry(result, durationMs)
      : estimateTelemetry({
          phase: options.phase,
          model: options.model,
          durationMs,
          inputText: options.inputText,
          outputText: options.estimateOutputText?.(result) ?? String(result ?? ''),
          source: options.source,
        });

    this.record(telemetry);
    this.checkBudgets(options.phase, options.budgetField, 'after');
    return { result, telemetry };
  }

  private record(telemetry: EvolveTelemetry): void {
    this.telemetryEntries.push(telemetry);
  }

  private checkBudgets(
    phase: TelemetryPhase,
    budgetField: keyof EvolveBudgetConfig | undefined,
    stage: 'before' | 'after',
  ): void {
    this.checkBudgetField(phase, this.globalBudgetField, this.totalSpent(), stage);
    if (budgetField) {
      this.checkBudgetField(phase, budgetField, this.totalSpentForPhase(phase), stage);
    }
  }

  private checkBudgetField(
    phase: TelemetryPhase,
    field: keyof EvolveBudgetConfig,
    spentUSD: number,
    stage: 'before' | 'after',
  ): void {
    const limit = this.budgets?.[field];
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) return;
    const exhausted = stage === 'before' ? spentUSD >= limit : spentUSD > limit;
    if (exhausted) {
      throw new BudgetExhaustedError(phase, field, limit, spentUSD);
    }
  }

  private totalSpent(): number {
    return this.telemetryEntries.reduce((sum, entry) => sum + costUSD(entry.cost), 0);
  }

  private totalSpentForPhase(phase: TelemetryPhase): number {
    return this.telemetryEntries
      .filter(entry => entry.phase === phase)
      .reduce((sum, entry) => sum + costUSD(entry.cost), 0);
  }
}

function costUSD(cost: CostTelemetry): number {
  return cost.estimatedUSD ?? 0;
}

export function telemetryFromUsage(input: {
  phase: TelemetryPhase;
  model: string;
  durationMs: number;
  usage: UsageTelemetry;
  sourceReason: string;
}): EvolveTelemetry {
  const inputTokens = input.usage.inputTokens ?? 0;
  const outputTokens = input.usage.outputTokens ?? 0;
  return {
    phase: input.phase,
    model: input.model,
    durationMs: input.durationMs,
    usage: input.usage,
    cost: {
      status: 'estimated',
      estimatedUSD: estimateCost(inputTokens, outputTokens, input.model),
      currency: 'USD',
      source: 'src/evolve/execution-meter.ts',
      reason: input.sourceReason,
    },
  };
}

export async function callEvolveLLM(
  config: KairnConfig,
  userMessage: string,
  options: Parameters<typeof callLLM>[2],
  meter: ExecutionMeter | undefined,
  metering: {
    phase: TelemetryPhase;
    model?: string;
    budgetField?: keyof EvolveBudgetConfig;
    source: string;
  },
): Promise<string> {
  const effectiveMeter = meter ?? new ExecutionMeter();
  const model = metering.model ?? config.model;
  const { result } = await effectiveMeter.run(
    {
      phase: metering.phase,
      model,
      inputText: `${options?.systemPrompt ?? ''}\n${userMessage}`,
      source: metering.source,
      budgetField: metering.budgetField,
      estimateOutputText: (response) => response,
    },
    () => callLLM(config, userMessage, options),
  );
  return result;
}

export async function writeExecutionLedger(
  workspacePath: string,
  meter: ExecutionMeter,
): Promise<void> {
  await fs.writeFile(
    path.join(workspacePath, 'telemetry-ledger.json'),
    JSON.stringify({
      entries: meter.entries(),
      costByPhase: meter.costByPhase(),
    }, null, 2),
    'utf-8',
  );
}

export async function loadExecutionLedger(workspacePath: string): Promise<EvolveTelemetry[]> {
  try {
    const raw = await fs.readFile(path.join(workspacePath, 'telemetry-ledger.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { entries?: EvolveTelemetry[] };
    return parsed.entries ?? [];
  } catch {
    return [];
  }
}
