/**
 * IR-Aware Targeted Re-evaluation — maps IR mutations to harness aspects
 * and tasks to aspects, enabling the loop to skip tasks unaffected by
 * the current iteration's mutations.
 */

import type { IRMutation } from '../ir/types.js';
import type { Task, EvalTemplate } from './types.js';

/** Semantic aspects of a harness that mutations can affect. */
export type HarnessAspect =
  | 'conventions'
  | 'commands'
  | 'rules'
  | 'agents'
  | 'settings'
  | 'mcp'
  | 'architecture'
  | 'verification'
  | 'general';

/** Map a single IR mutation to the harness aspect it affects. */
function mutationToAspect(mutation: IRMutation): HarnessAspect {
  switch (mutation.type) {
    case 'update_section': {
      const id = mutation.sectionId;
      if (id === 'conventions' || id === 'gotchas' || id === 'debugging' || id === 'git') return 'conventions';
      if (id === 'commands' || id === 'custom-key-commands') return 'commands';
      if (id === 'verification') return 'verification';
      if (id === 'architecture') return 'architecture';
      return 'general';
    }
    case 'add_section': {
      const id = mutation.section.id;
      if (id === 'conventions' || id === 'gotchas' || id === 'debugging' || id === 'git') return 'conventions';
      if (id === 'commands' || id === 'custom-key-commands') return 'commands';
      if (id === 'verification') return 'verification';
      if (id === 'architecture') return 'architecture';
      return 'general';
    }
    case 'remove_section':
    case 'reorder_section':
      return 'general';
    case 'add_command':
    case 'update_command':
    case 'remove_command':
      return 'commands';
    case 'add_rule':
    case 'update_rule':
    case 'remove_rule':
      return 'rules';
    case 'add_agent':
    case 'update_agent':
    case 'remove_agent':
      return 'agents';
    case 'add_mcp_server':
    case 'remove_mcp_server':
      return 'mcp';
    case 'update_settings':
      return 'settings';
    case 'raw_text':
      return 'general';
  }
}

/** Map which eval templates depend on which harness aspects. */
const TEMPLATE_ASPECTS: Record<EvalTemplate, HarnessAspect[]> = {
  'convention-adherence': ['conventions', 'rules'],
  'workflow-compliance': ['commands', 'verification'],
  'rule-compliance': ['rules'],
  'intent-routing': ['settings'],
  'add-feature': ['general'],
  'fix-bug': ['general'],
  'refactor': ['architecture', 'conventions'],
  'test-writing': ['verification', 'commands'],
  'config-change': ['settings', 'mcp'],
  'documentation': ['general'],
};

/**
 * Map IR mutations to the harness aspects they affect.
 */
export function mutationsToAspects(mutations: IRMutation[]): Set<HarnessAspect> {
  const aspects = new Set<HarnessAspect>();
  for (const m of mutations) {
    aspects.add(mutationToAspect(m));
  }
  return aspects;
}

/**
 * Determine which harness aspects a task depends on based on its template.
 */
export function taskDependsOnAspects(task: Task): Set<HarnessAspect> {
  const aspects = TEMPLATE_ASPECTS[task.template];
  return new Set(aspects ?? ['general']);
}

/**
 * Determine if a task should be re-evaluated given the changed aspects.
 */
export function shouldReEvaluate(task: Task, changedAspects: Set<HarnessAspect>): boolean {
  if (changedAspects.has('general')) return true;
  if (changedAspects.size === 0) return false;

  const taskAspects = taskDependsOnAspects(task);
  if (taskAspects.has('general')) return true;

  for (const aspect of taskAspects) {
    if (changedAspects.has(aspect)) return true;
  }
  return false;
}

/**
 * Filter a task list to only tasks that need re-evaluation.
 */
export function filterTasksByAspects(tasks: Task[], changedAspects: Set<HarnessAspect>): Task[] {
  return tasks.filter(t => shouldReEvaluate(t, changedAspects));
}
