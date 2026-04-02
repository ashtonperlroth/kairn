/**
 * @linker — Cross-reference validation and auto-patching for HarnessIR.
 *
 * Pure function that scans a compiled HarnessIR for broken cross-references
 * between nodes (e.g. @agent-name in commands, /project:cmd in agents) and
 * injects missing default nodes (help command, security/continuity rules).
 *
 * The linker never mutates its input — it deep-clones the IR first and
 * returns a patched copy alongside a LinkReport describing what was found
 * and what was auto-fixed.
 */

import type { HarnessIR } from '../ir/types.js';
import { createCommandNode, createRuleNode } from '../ir/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Summary of linker findings and auto-applied patches. */
export interface LinkReport {
  /** Human-readable warnings about broken references (not auto-fixed). */
  warnings: string[];
  /** Human-readable descriptions of patches that were auto-applied. */
  autoFixes: string[];
}

// ---------------------------------------------------------------------------
// Default content for injected nodes
// ---------------------------------------------------------------------------

const DEFAULT_HELP_CONTENT =
  'Show available commands and their descriptions.\n\nList all /project: commands with brief descriptions.';

const DEFAULT_HELP_DESCRIPTION = 'Show available commands';

const DEFAULT_SECURITY_CONTENT = [
  '# Security Rules',
  '',
  '- NEVER log or echo API keys, tokens, or secrets',
  '- NEVER write secrets to files',
  '- NEVER execute user-provided strings as shell commands',
  '- Validate all inputs before use',
].join('\n');

const DEFAULT_CONTINUITY_CONTENT = [
  '# Continuity',
  '',
  'After every significant decision or discovery:',
  '',
  '1. Update docs/DECISIONS.md',
  '2. Update docs/LEARNINGS.md',
  '3. Update docs/TODO.md task status',
].join('\n');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Regex to find @agent-name mentions (word-char and hyphens). */
const AGENT_REF_PATTERN = /@([\w-]+)/g;

/** Regex to find /project:command-name references. */
const COMMAND_REF_PATTERN = /\/project:([\w-]+)/g;

/**
 * Scan command content for @agent-name mentions and validate against known agents.
 * Auto-fixes broken references by stripping the @ prefix.
 */
function validateAgentReferences(
  patched: HarnessIR,
  agentNames: ReadonlySet<string>,
  report: LinkReport,
): void {
  for (const cmd of patched.commands) {
    const refs = cmd.content.matchAll(AGENT_REF_PATTERN);
    for (const match of refs) {
      const name = match[1];
      if (!agentNames.has(name)) {
        report.warnings.push(
          `Command "${cmd.name}" references non-existent agent "${name}"`,
        );
        cmd.content = cmd.content.replace(
          new RegExp(`@${escapeRegExp(name)}\\b`, 'g'),
          name,
        );
        report.autoFixes.push(
          `Removed @${name} mention from command "${cmd.name}"`,
        );
      }
    }
  }
}

/**
 * Scan agent content for /project:command-name references and validate
 * against known commands. Emits warnings but does not auto-fix (removing
 * a command reference could break documentation).
 */
function validateCommandReferences(
  patched: HarnessIR,
  commandNames: ReadonlySet<string>,
  report: LinkReport,
): void {
  for (const agent of patched.agents) {
    const refs = agent.content.matchAll(COMMAND_REF_PATTERN);
    for (const match of refs) {
      const name = match[1];
      if (!commandNames.has(name)) {
        report.warnings.push(
          `Agent "${agent.name}" references non-existent command "${name}"`,
        );
      }
    }
  }
}

/** Inject /project:help command if no command named "help" exists. */
function injectHelpCommand(patched: HarnessIR, report: LinkReport): void {
  const commandNames = new Set(patched.commands.map((c) => c.name));
  if (!commandNames.has('help')) {
    patched.commands.push(
      createCommandNode('help', DEFAULT_HELP_CONTENT, DEFAULT_HELP_DESCRIPTION),
    );
    report.autoFixes.push('Injected default /project:help command');
  }
}

/** Inject a default security rule if none exists. */
function injectSecurityRule(patched: HarnessIR, report: LinkReport): void {
  const ruleNames = new Set(patched.rules.map((r) => r.name));
  if (!ruleNames.has('security')) {
    patched.rules.push(createRuleNode('security', DEFAULT_SECURITY_CONTENT));
    report.autoFixes.push('Injected default security rule');
  }
}

/** Inject a default continuity rule if none exists. */
function injectContinuityRule(patched: HarnessIR, report: LinkReport): void {
  const ruleNames = new Set(patched.rules.map((r) => r.name));
  if (!ruleNames.has('continuity')) {
    patched.rules.push(createRuleNode('continuity', DEFAULT_CONTINUITY_CONTENT));
    report.autoFixes.push('Injected default continuity rule');
  }
}

/** Escape special regex characters in a string for use in `new RegExp()`. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate cross-references in a HarnessIR and auto-patch where possible.
 *
 * This is a pure function: it deep-clones the input IR and returns the
 * patched copy alongside a report of warnings and auto-fixes.
 *
 * Validations performed:
 * 1. `@agent-name` mentions in command content must reference existing agents.
 *    Broken references are auto-fixed by stripping the `@` prefix.
 * 2. `/project:command-name` references in agent content must reference
 *    existing commands. Broken references generate warnings only.
 * 3. A `/project:help` command is injected if missing.
 * 4. `security` and `continuity` rules are injected if missing.
 */
export function linkHarness(ir: HarnessIR): { ir: HarnessIR; report: LinkReport } {
  // Deep clone to avoid mutating the input
  const patched: HarnessIR = JSON.parse(JSON.stringify(ir)) as HarnessIR;
  const report: LinkReport = { warnings: [], autoFixes: [] };

  // Build lookup sets from the current state of the IR
  const agentNames = new Set(patched.agents.map((a) => a.name));
  const commandNames = new Set(patched.commands.map((c) => c.name));

  // 1. Validate @agent-name references in commands
  validateAgentReferences(patched, agentNames, report);

  // 2. Validate /project:command-name references in agents
  validateCommandReferences(patched, commandNames, report);

  // 3. Inject default help command if missing
  injectHelpCommand(patched, report);

  // 4. Inject security rule if missing
  injectSecurityRule(patched, report);

  // 5. Inject continuity rule if missing
  injectContinuityRule(patched, report);

  return { ir: patched, report };
}
