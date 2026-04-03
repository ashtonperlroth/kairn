/**
 * Agent dispatcher — routes an AgentTask to the correct specialist agent function.
 *
 * Each specialist follows the same signature:
 *   generate*(intent, skeleton, task, config) => Promise<AgentResult>
 *
 * The dispatcher's public API uses (task, config, intent, skeleton) ordering
 * so that `task` (the dispatch key) comes first, while internally it calls
 * each specialist with (intent, skeleton, task, config) for natural readability.
 */

import type { AgentTask, AgentResult } from './types.js';
import type { KairnConfig, SkeletonSpec } from '../../types.js';
import { generateSections } from './sections-writer.js';
import { generateRules } from './rule-writer.js';
import { generateDocs } from './doc-writer.js';
import { generateCommands } from './command-writer.js';
import { generateAgents } from './agent-writer.js';
import { generateSkills } from './skill-writer.js';

/**
 * Dispatch an agent task to the appropriate specialist function.
 *
 * @param task - The task describing which agent to invoke and what to generate
 * @param config - Kairn configuration (API key, model, etc.)
 * @param intent - The user's original natural-language intent
 * @param skeleton - The skeleton spec from Pass 1 (tools, outline, etc.)
 * @returns The specialist's result containing generated IR nodes
 * @throws If `task.agent` is not a recognized agent name
 */
export async function dispatchAgent(
  task: AgentTask,
  config: KairnConfig,
  intent: string,
  skeleton: SkeletonSpec,
): Promise<AgentResult> {
  switch (task.agent) {
    case 'sections-writer':
      return generateSections(intent, skeleton, task, config);
    case 'rule-writer':
      return generateRules(intent, skeleton, task, config);
    case 'doc-writer':
      return generateDocs(intent, skeleton, task, config);
    case 'command-writer':
      return generateCommands(intent, skeleton, task, config);
    case 'agent-writer':
      return generateAgents(intent, skeleton, task, config);
    case 'skill-writer':
      return generateSkills(intent, skeleton, task, config);
    default:
      throw new Error(`Unknown agent: ${(task as { agent: string }).agent}`);
  }
}
