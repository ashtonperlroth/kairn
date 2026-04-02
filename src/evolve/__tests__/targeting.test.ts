import { describe, it, expect } from 'vitest';
import { mutationsToAspects, taskDependsOnAspects, shouldReEvaluate, filterTasksByAspects } from '../targeting.js';
import type { IRMutation } from '../../ir/types.js';
import { createSection, createCommandNode, createRuleNode, createAgentNode } from '../../ir/types.js';
import type { Task } from '../types.js';

function makeTask(id: string, template: Task['template']): Task {
  return {
    id,
    template,
    description: `Task ${id}`,
    setup: '',
    expected_outcome: 'Some outcome',
    scoring: 'pass-fail',
    timeout: 60,
  };
}

describe('mutationsToAspects', () => {
  it('maps update_section conventions → conventions', () => {
    const mutations: IRMutation[] = [
      { type: 'update_section', sectionId: 'conventions', content: 'new', rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['conventions']));
  });

  it('maps update_section gotchas → conventions', () => {
    const mutations: IRMutation[] = [
      { type: 'update_section', sectionId: 'gotchas', content: 'new', rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['conventions']));
  });

  it('maps update_section purpose → general', () => {
    const mutations: IRMutation[] = [
      { type: 'update_section', sectionId: 'purpose', content: 'new', rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['general']));
  });

  it('maps update_section verification → verification', () => {
    const mutations: IRMutation[] = [
      { type: 'update_section', sectionId: 'verification', content: 'new', rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['verification']));
  });

  it('maps update_section architecture → architecture', () => {
    const mutations: IRMutation[] = [
      { type: 'update_section', sectionId: 'architecture', content: 'new', rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['architecture']));
  });

  it('maps add_section with conventions id → conventions', () => {
    const mutations: IRMutation[] = [
      { type: 'add_section', section: createSection('conventions', '## Conventions', 'stuff', 0), rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['conventions']));
  });

  it('maps add_command → commands', () => {
    const mutations: IRMutation[] = [
      { type: 'add_command', command: createCommandNode('build', 'npm run build'), rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['commands']));
  });

  it('maps update_command → commands', () => {
    const mutations: IRMutation[] = [
      { type: 'update_command', name: 'build', content: 'new', rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['commands']));
  });

  it('maps remove_command → commands', () => {
    const mutations: IRMutation[] = [
      { type: 'remove_command', name: 'old', rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['commands']));
  });

  it('maps add_rule → rules', () => {
    const mutations: IRMutation[] = [
      { type: 'add_rule', rule: createRuleNode('security', 'no eval'), rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['rules']));
  });

  it('maps update_rule → rules', () => {
    const mutations: IRMutation[] = [
      { type: 'update_rule', name: 'security', content: 'new', rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['rules']));
  });

  it('maps remove_rule → rules', () => {
    const mutations: IRMutation[] = [
      { type: 'remove_rule', name: 'old', rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['rules']));
  });

  it('maps add_agent → agents', () => {
    const mutations: IRMutation[] = [
      { type: 'add_agent', agent: createAgentNode('arch', 'instructions'), rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['agents']));
  });

  it('maps update_agent → agents', () => {
    const mutations: IRMutation[] = [
      { type: 'update_agent', name: 'arch', changes: { model: 'opus' }, rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['agents']));
  });

  it('maps remove_agent → agents', () => {
    const mutations: IRMutation[] = [
      { type: 'remove_agent', name: 'old', rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['agents']));
  });

  it('maps add_mcp_server → mcp', () => {
    const mutations: IRMutation[] = [
      { type: 'add_mcp_server', server: { id: 'sentry', command: 'npx', args: ['sentry'] }, rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['mcp']));
  });

  it('maps remove_mcp_server → mcp', () => {
    const mutations: IRMutation[] = [
      { type: 'remove_mcp_server', id: 'sentry', rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['mcp']));
  });

  it('maps update_settings → settings', () => {
    const mutations: IRMutation[] = [
      { type: 'update_settings', path: 'statusLine.command', value: 'echo hi', rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['settings']));
  });

  it('maps raw_text → general', () => {
    const mutations: IRMutation[] = [
      { type: 'raw_text', file: 'random.txt', action: 'replace', oldText: 'a', newText: 'b', rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['general']));
  });

  it('maps remove_section → general', () => {
    const mutations: IRMutation[] = [
      { type: 'remove_section', sectionId: 'old', rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['general']));
  });

  it('maps reorder_section → general', () => {
    const mutations: IRMutation[] = [
      { type: 'reorder_section', sectionId: 'purpose', newOrder: 5, rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['general']));
  });

  it('collects unique aspects from multiple mutations', () => {
    const mutations: IRMutation[] = [
      { type: 'add_rule', rule: createRuleNode('sec', 'no eval'), rationale: 'test' },
      { type: 'update_section', sectionId: 'conventions', content: 'new', rationale: 'test' },
      { type: 'add_command', command: createCommandNode('build', 'run'), rationale: 'test' },
    ];
    expect(mutationsToAspects(mutations)).toEqual(new Set(['rules', 'conventions', 'commands']));
  });

  it('returns empty set for empty mutations', () => {
    expect(mutationsToAspects([])).toEqual(new Set());
  });

  it('deduplicates aspects', () => {
    const mutations: IRMutation[] = [
      { type: 'add_rule', rule: createRuleNode('a', 'x'), rationale: 'test' },
      { type: 'update_rule', name: 'b', content: 'y', rationale: 'test' },
      { type: 'remove_rule', name: 'c', rationale: 'test' },
    ];
    const aspects = mutationsToAspects(mutations);
    expect(aspects.size).toBe(1);
    expect(aspects.has('rules')).toBe(true);
  });
});

describe('taskDependsOnAspects', () => {
  it('convention-adherence → conventions, rules', () => {
    const task = makeTask('t1', 'convention-adherence');
    expect(taskDependsOnAspects(task)).toEqual(new Set(['conventions', 'rules']));
  });

  it('workflow-compliance → commands, verification', () => {
    const task = makeTask('t2', 'workflow-compliance');
    expect(taskDependsOnAspects(task)).toEqual(new Set(['commands', 'verification']));
  });

  it('rule-compliance → rules', () => {
    const task = makeTask('t3', 'rule-compliance');
    expect(taskDependsOnAspects(task)).toEqual(new Set(['rules']));
  });

  it('intent-routing → settings', () => {
    const task = makeTask('t4', 'intent-routing');
    expect(taskDependsOnAspects(task)).toEqual(new Set(['settings']));
  });

  it('add-feature → general', () => {
    const task = makeTask('t5', 'add-feature');
    expect(taskDependsOnAspects(task)).toEqual(new Set(['general']));
  });

  it('fix-bug → general', () => {
    const task = makeTask('t6', 'fix-bug');
    expect(taskDependsOnAspects(task)).toEqual(new Set(['general']));
  });

  it('refactor → architecture, conventions', () => {
    const task = makeTask('t7', 'refactor');
    expect(taskDependsOnAspects(task)).toEqual(new Set(['architecture', 'conventions']));
  });

  it('test-writing → verification, commands', () => {
    const task = makeTask('t8', 'test-writing');
    expect(taskDependsOnAspects(task)).toEqual(new Set(['verification', 'commands']));
  });

  it('config-change → settings, mcp', () => {
    const task = makeTask('t9', 'config-change');
    expect(taskDependsOnAspects(task)).toEqual(new Set(['settings', 'mcp']));
  });

  it('documentation → general', () => {
    const task = makeTask('t10', 'documentation');
    expect(taskDependsOnAspects(task)).toEqual(new Set(['general']));
  });
});

describe('shouldReEvaluate', () => {
  it('returns true when task aspect overlaps with changed aspects', () => {
    const task = makeTask('t1', 'convention-adherence'); // conventions, rules
    expect(shouldReEvaluate(task, new Set(['conventions']))).toBe(true);
  });

  it('returns true when task aspect partially overlaps', () => {
    const task = makeTask('t1', 'convention-adherence'); // conventions, rules
    expect(shouldReEvaluate(task, new Set(['rules']))).toBe(true);
  });

  it('returns false when no overlap', () => {
    const task = makeTask('t1', 'convention-adherence'); // conventions, rules
    expect(shouldReEvaluate(task, new Set(['commands']))).toBe(false);
  });

  it('returns true when changed aspects include general', () => {
    const task = makeTask('t1', 'convention-adherence');
    expect(shouldReEvaluate(task, new Set(['general']))).toBe(true);
  });

  it('returns true when task depends on general', () => {
    const task = makeTask('t1', 'add-feature'); // general
    expect(shouldReEvaluate(task, new Set(['commands']))).toBe(true);
  });

  it('returns false when changed aspects is empty', () => {
    const task = makeTask('t1', 'convention-adherence');
    expect(shouldReEvaluate(task, new Set())).toBe(false);
  });

  it('returns false for rules task when only commands changed', () => {
    const task = makeTask('t1', 'rule-compliance'); // rules
    expect(shouldReEvaluate(task, new Set(['commands', 'settings']))).toBe(false);
  });

  it('returns true for settings task when settings changed', () => {
    const task = makeTask('t1', 'intent-routing'); // settings
    expect(shouldReEvaluate(task, new Set(['settings']))).toBe(true);
  });
});

describe('filterTasksByAspects', () => {
  it('filters out tasks whose aspects do not overlap', () => {
    const tasks = [
      makeTask('conv', 'convention-adherence'),  // conventions, rules
      makeTask('wf', 'workflow-compliance'),      // commands, verification
      makeTask('rule', 'rule-compliance'),         // rules
    ];
    const result = filterTasksByAspects(tasks, new Set(['rules']));
    expect(result.map(t => t.id)).toEqual(['conv', 'rule']);
  });

  it('returns all tasks when general is in changed aspects', () => {
    const tasks = [
      makeTask('conv', 'convention-adherence'),
      makeTask('wf', 'workflow-compliance'),
      makeTask('feat', 'add-feature'),
    ];
    const result = filterTasksByAspects(tasks, new Set(['general']));
    expect(result).toHaveLength(3);
  });

  it('returns empty array when no aspects overlap and no general tasks', () => {
    const tasks = [
      makeTask('conv', 'convention-adherence'),  // conventions, rules
      makeTask('rule', 'rule-compliance'),         // rules
    ];
    const result = filterTasksByAspects(tasks, new Set(['mcp']));
    expect(result).toHaveLength(0);
  });

  it('always includes general-dependent tasks', () => {
    const tasks = [
      makeTask('feat', 'add-feature'),   // general — always re-evaluate
      makeTask('conv', 'convention-adherence'),
    ];
    const result = filterTasksByAspects(tasks, new Set(['commands']));
    expect(result.map(t => t.id)).toEqual(['feat']);
  });

  it('returns empty for empty changed aspects', () => {
    const tasks = [makeTask('conv', 'convention-adherence')];
    const result = filterTasksByAspects(tasks, new Set());
    expect(result).toHaveLength(0);
  });

  it('handles empty task list', () => {
    const result = filterTasksByAspects([], new Set(['rules']));
    expect(result).toHaveLength(0);
  });
});
