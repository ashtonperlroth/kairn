import { describe, it, expect, vi } from 'vitest';
import type {
  CompilationPlan,
  AgentTask,
  AgentResult,
} from '../agents/types.js';
import { TruncationError } from '../agents/types.js';
import { createEmptyIR } from '../../ir/types.js';
import {
  runWithConcurrency,
  mergeIntoIR,
  executePlan,
} from '../batch.js';
import type { ExecuteAgentFn, BatchProgress } from '../batch.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal CompilationPlan from phase definitions. */
function makePlan(
  phases: Array<{
    id: string;
    agents: AgentTask[];
    dependsOn?: string[];
  }>,
  context = 'test context',
): CompilationPlan {
  return {
    project_context: context,
    phases: phases.map((p) => ({
      id: p.id,
      agents: p.agents,
      dependsOn: p.dependsOn ?? [],
    })),
  };
}

/** Creates a simple AgentTask for the given agent. */
function makeTask(
  agent: AgentTask['agent'],
  items: string[] = ['item-1'],
  maxTokens = 4096,
): AgentTask {
  return { agent, items, max_tokens: maxTokens };
}

/** A no-op delay that resolves after the given milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// runWithConcurrency
// ---------------------------------------------------------------------------

describe('runWithConcurrency', () => {
  it('runs tasks and returns results in original order', async () => {
    const tasks = [
      async () => 'a',
      async () => 'b',
      async () => 'c',
    ];

    const results = await runWithConcurrency(tasks, 3);

    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('respects concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;

    const makeDelayedTask = (value: string) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await delay(20);
      running--;
      return value;
    };

    const tasks = [
      makeDelayedTask('a'),
      makeDelayedTask('b'),
      makeDelayedTask('c'),
      makeDelayedTask('d'),
      makeDelayedTask('e'),
    ];

    const results = await runWithConcurrency(tasks, 2);

    expect(results).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('handles empty task list', async () => {
    const results = await runWithConcurrency([], 3);

    expect(results).toEqual([]);
  });

  it('propagates errors from tasks', async () => {
    const tasks = [
      async () => 'ok',
      async () => {
        throw new Error('task failed');
      },
      async () => 'also ok',
    ];

    await expect(runWithConcurrency(tasks, 3)).rejects.toThrow('task failed');
  });
});

// ---------------------------------------------------------------------------
// mergeIntoIR
// ---------------------------------------------------------------------------

describe('mergeIntoIR', () => {
  it('merges sections-writer result into ir.sections', () => {
    const ir = createEmptyIR();
    const result: AgentResult = {
      agent: 'sections-writer',
      sections: [
        { id: 'purpose', heading: '## Purpose', content: 'Build things', order: 1 },
        { id: 'stack', heading: '## Stack', content: 'TypeScript', order: 2 },
      ],
    };

    mergeIntoIR(ir, result);

    expect(ir.sections).toHaveLength(2);
    expect(ir.sections[0].id).toBe('purpose');
    expect(ir.sections[1].id).toBe('stack');
  });

  it('merges command-writer result into ir.commands', () => {
    const ir = createEmptyIR();
    const result: AgentResult = {
      agent: 'command-writer',
      commands: [
        { name: 'build', description: 'Build project', content: 'npm run build' },
      ],
    };

    mergeIntoIR(ir, result);

    expect(ir.commands).toHaveLength(1);
    expect(ir.commands[0].name).toBe('build');
  });

  it('merges agent-writer result into ir.agents', () => {
    const ir = createEmptyIR();
    const result: AgentResult = {
      agent: 'agent-writer',
      agents: [
        { name: 'reviewer', content: 'Review code for quality' },
      ],
    };

    mergeIntoIR(ir, result);

    expect(ir.agents).toHaveLength(1);
    expect(ir.agents[0].name).toBe('reviewer');
  });

  it('merges rule-writer result into ir.rules', () => {
    const ir = createEmptyIR();
    const result: AgentResult = {
      agent: 'rule-writer',
      rules: [
        { name: 'security', content: 'No dangerous operations' },
      ],
    };

    mergeIntoIR(ir, result);

    expect(ir.rules).toHaveLength(1);
    expect(ir.rules[0].name).toBe('security');
  });

  it('merges doc-writer result into ir.docs', () => {
    const ir = createEmptyIR();
    const result: AgentResult = {
      agent: 'doc-writer',
      docs: [
        { name: 'api', content: 'API documentation' },
      ],
    };

    mergeIntoIR(ir, result);

    expect(ir.docs).toHaveLength(1);
    expect(ir.docs[0].name).toBe('api');
  });

  it('merges skill-writer result into ir.skills', () => {
    const ir = createEmptyIR();
    const result: AgentResult = {
      agent: 'skill-writer',
      skills: [
        { name: 'debug', content: 'Debug instructions' },
      ],
    };

    mergeIntoIR(ir, result);

    expect(ir.skills).toHaveLength(1);
    expect(ir.skills[0].name).toBe('debug');
  });

  it('appends to existing items (does not overwrite)', () => {
    const ir = createEmptyIR();
    ir.sections.push({ id: 'existing', heading: '## Existing', content: 'old', order: 0 });

    const result: AgentResult = {
      agent: 'sections-writer',
      sections: [{ id: 'new', heading: '## New', content: 'new', order: 1 }],
    };

    mergeIntoIR(ir, result);

    expect(ir.sections).toHaveLength(2);
    expect(ir.sections[0].id).toBe('existing');
    expect(ir.sections[1].id).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// executePlan
// ---------------------------------------------------------------------------

describe('executePlan', () => {
  it('executes phases in order', async () => {
    const executionOrder: string[] = [];

    const executeAgent: ExecuteAgentFn = async (task) => {
      executionOrder.push(task.agent);
      return {
        agent: 'sections-writer' as const,
        sections: [{ id: task.agent, heading: `## ${task.agent}`, content: 'content', order: 0 }],
      };
    };

    const plan = makePlan([
      { id: 'phase-1', agents: [makeTask('sections-writer')] },
      { id: 'phase-2', agents: [makeTask('sections-writer')], dependsOn: ['phase-1'] },
    ]);

    await executePlan(plan, executeAgent, 2);

    // The first agent should be called before the second
    expect(executionOrder).toEqual(['sections-writer', 'sections-writer']);
  });

  it('runs agents within a phase concurrently', async () => {
    let running = 0;
    let maxRunning = 0;

    const executeAgent: ExecuteAgentFn = async (task) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await delay(30);
      running--;

      if (task.agent === 'sections-writer') {
        return { agent: 'sections-writer', sections: [] };
      }
      return { agent: 'command-writer', commands: [] };
    };

    const plan = makePlan([
      {
        id: 'phase-1',
        agents: [
          makeTask('sections-writer'),
          makeTask('command-writer'),
        ],
      },
    ]);

    await executePlan(plan, executeAgent, 4);

    // Both agents should have run concurrently (maxRunning >= 2)
    expect(maxRunning).toBeGreaterThanOrEqual(2);
  });

  it('calls onProgress for each phase', async () => {
    const progressEvents: BatchProgress[] = [];

    const executeAgent: ExecuteAgentFn = async (task) => {
      return { agent: 'sections-writer' as const, sections: [] };
    };

    const plan = makePlan([
      { id: 'phase-1', agents: [makeTask('sections-writer')] },
      { id: 'phase-2', agents: [makeTask('sections-writer'), makeTask('command-writer')], dependsOn: ['phase-1'] },
    ]);

    await executePlan(plan, executeAgent, 2, (progress) => {
      progressEvents.push({ ...progress });
    });

    // Each phase should emit 'start' and 'complete'
    expect(progressEvents).toHaveLength(4);

    expect(progressEvents[0]).toEqual({
      phaseId: 'phase-1',
      status: 'start',
      agentCount: 1,
    });
    expect(progressEvents[1]).toEqual({
      phaseId: 'phase-1',
      status: 'complete',
      agentCount: 1,
      completedCount: 1,
    });
    expect(progressEvents[2]).toEqual({
      phaseId: 'phase-2',
      status: 'start',
      agentCount: 2,
    });
    expect(progressEvents[3]).toEqual({
      phaseId: 'phase-2',
      status: 'complete',
      agentCount: 2,
      completedCount: 2,
    });
  });

  it('returns createEmptyIR() for empty plan', async () => {
    const executeAgent: ExecuteAgentFn = vi.fn();

    const plan: CompilationPlan = { project_context: 'empty', phases: [] };
    const result = await executePlan(plan, executeAgent, 2);

    expect(result).toEqual(createEmptyIR());
    expect(executeAgent).not.toHaveBeenCalled();
  });

  it('throws on unknown dependency', async () => {
    const executeAgent: ExecuteAgentFn = vi.fn();

    const plan = makePlan([
      { id: 'phase-1', agents: [makeTask('sections-writer')], dependsOn: ['non-existent'] },
    ]);

    await expect(executePlan(plan, executeAgent, 2)).rejects.toThrow(
      'Phase "phase-1" depends on unknown phase "non-existent"',
    );
  });

  it('throws on dependency cycle (phase depends on later phase)', async () => {
    const executeAgent: ExecuteAgentFn = vi.fn();

    // phase-1 depends on phase-2, but phase-2 comes after phase-1
    const plan = makePlan([
      { id: 'phase-1', agents: [makeTask('sections-writer')], dependsOn: ['phase-2'] },
      { id: 'phase-2', agents: [makeTask('command-writer')], dependsOn: ['phase-1'] },
    ]);

    await expect(executePlan(plan, executeAgent, 2)).rejects.toThrow();
  });

  it('retries on TruncationError with doubled max_tokens (max 1 retry)', async () => {
    let callCount = 0;
    const receivedMaxTokens: number[] = [];

    const executeAgent: ExecuteAgentFn = async (task) => {
      callCount++;
      receivedMaxTokens.push(task.max_tokens);

      if (callCount === 1) {
        throw new TruncationError('Output truncated', {
          agentName: task.agent,
          tokensUsed: task.max_tokens,
        });
      }

      return { agent: 'sections-writer' as const, sections: [] };
    };

    const plan = makePlan([
      { id: 'phase-1', agents: [makeTask('sections-writer', ['item'], 4096)] },
    ]);

    const result = await executePlan(plan, executeAgent, 2);

    expect(callCount).toBe(2);
    expect(receivedMaxTokens[0]).toBe(4096);
    expect(receivedMaxTokens[1]).toBe(8192); // doubled
    expect(result).toBeDefined();
  });

  it('fails after TruncationError retry exhausted', async () => {
    const executeAgent: ExecuteAgentFn = async (task) => {
      throw new TruncationError('Output truncated', {
        agentName: task.agent,
        tokensUsed: task.max_tokens,
      });
    };

    const plan = makePlan([
      { id: 'phase-1', agents: [makeTask('sections-writer', ['item'], 4096)] },
    ]);

    await expect(executePlan(plan, executeAgent, 2)).rejects.toThrow(
      'Output truncated',
    );
  });

  it('merges results from multiple agents into the IR', async () => {
    const executeAgent: ExecuteAgentFn = async (task) => {
      switch (task.agent) {
        case 'sections-writer':
          return {
            agent: 'sections-writer',
            sections: [{ id: 's1', heading: '## S1', content: 'content', order: 0 }],
          };
        case 'command-writer':
          return {
            agent: 'command-writer',
            commands: [{ name: 'build', description: 'Build', content: 'npm run build' }],
          };
        case 'rule-writer':
          return {
            agent: 'rule-writer',
            rules: [{ name: 'security', content: 'No danger' }],
          };
        default:
          return { agent: 'sections-writer', sections: [] };
      }
    };

    const plan = makePlan([
      {
        id: 'phase-1',
        agents: [
          makeTask('sections-writer'),
          makeTask('command-writer'),
          makeTask('rule-writer'),
        ],
      },
    ]);

    const ir = await executePlan(plan, executeAgent, 3);

    expect(ir.sections).toHaveLength(1);
    expect(ir.commands).toHaveLength(1);
    expect(ir.rules).toHaveLength(1);
  });

  it('propagates non-TruncationError errors without retry', async () => {
    const executeAgent: ExecuteAgentFn = async () => {
      throw new Error('network failure');
    };

    const plan = makePlan([
      { id: 'phase-1', agents: [makeTask('sections-writer')] },
    ]);

    await expect(executePlan(plan, executeAgent, 2)).rejects.toThrow(
      'network failure',
    );
  });
});
