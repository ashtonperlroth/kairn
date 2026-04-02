/**
 * IR Mutation Engine — Immutable transformations on HarnessIR.
 *
 * Every `applyIRMutation` call returns a **new** HarnessIR; the input is never mutated.
 * `validateIRMutation` checks pre-conditions without side-effects.
 */

import type {
  HarnessIR,
  IRMutation,
  SettingsIR,
} from "./types.js";

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

/** Result of a pre-condition check on a mutation. */
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Internal lookup helpers
// ---------------------------------------------------------------------------

function sectionExists(ir: HarnessIR, id: string): boolean {
  return ir.sections.some((s) => s.id === id);
}

function commandExists(ir: HarnessIR, name: string): boolean {
  return ir.commands.some((c) => c.name === name);
}

function ruleExists(ir: HarnessIR, name: string): boolean {
  return ir.rules.some((r) => r.name === name);
}

function agentExists(ir: HarnessIR, name: string): boolean {
  return ir.agents.some((a) => a.name === name);
}

function mcpServerExists(ir: HarnessIR, id: string): boolean {
  return ir.mcpServers.some((s) => s.id === id);
}

// ---------------------------------------------------------------------------
// Deep-set helper for settings paths
// ---------------------------------------------------------------------------

/** Known top-level keys in SettingsIR that map to structured fields. */
const STRUCTURED_SETTINGS_KEYS = new Set(["statusLine", "hooks", "denyPatterns"]);

/**
 * Immutably deep-set a dotted path on an object, returning a new object tree.
 *
 * Example: `deepSet({}, "a.b.c", 42)` => `{ a: { b: { c: 42 } } }`
 */
function deepSet(
  obj: Record<string, unknown>,
  segments: string[],
  value: unknown,
): Record<string, unknown> {
  if (segments.length === 0) return obj;

  const [head, ...rest] = segments;

  if (rest.length === 0) {
    return { ...obj, [head]: value };
  }

  const existing = obj[head];
  const child =
    existing !== null && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};

  return { ...obj, [head]: deepSet(child, rest, value) };
}

/**
 * Apply a dotted-path setting update to SettingsIR immutably.
 *
 * If the top-level key maps to a structured field (statusLine, hooks, denyPatterns),
 * we set it directly on the SettingsIR. Otherwise, we store it in `settings.raw`.
 */
function applySettingsUpdate(
  settings: SettingsIR,
  path: string,
  value: unknown,
): SettingsIR {
  const segments = path.split(".");
  const topKey = segments[0];

  if (STRUCTURED_SETTINGS_KEYS.has(topKey)) {
    // Deep-set into the structured settings object
    const settingsRecord = { ...settings } as unknown as Record<string, unknown>;
    const updated = deepSet(settingsRecord, segments, value);
    return {
      ...settings,
      ...updated,
      // Preserve raw as-is (deepSet may have overwritten it if path happened to be "raw")
      raw: settings.raw,
    } as SettingsIR;
  }

  // Unrecognized key — store in raw
  const updatedRaw = deepSet({ ...settings.raw }, segments, value);
  return {
    ...settings,
    raw: updatedRaw,
  };
}

// ---------------------------------------------------------------------------
// applyIRMutation
// ---------------------------------------------------------------------------

/**
 * Apply a single mutation to a HarnessIR, returning a new immutable IR.
 *
 * Throws if a pre-condition is violated (e.g., updating a section that doesn't exist).
 */
export function applyIRMutation(ir: HarnessIR, mutation: IRMutation): HarnessIR {
  switch (mutation.type) {
    // -- Sections ----------------------------------------------------------

    case "update_section": {
      if (!sectionExists(ir, mutation.sectionId)) {
        throw new Error(`Section '${mutation.sectionId}' not found`);
      }
      return {
        ...ir,
        sections: ir.sections.map((s) =>
          s.id === mutation.sectionId ? { ...s, content: mutation.content } : s,
        ),
      };
    }

    case "add_section": {
      if (sectionExists(ir, mutation.section.id)) {
        throw new Error(`Section '${mutation.section.id}' already exists`);
      }
      return {
        ...ir,
        sections: [...ir.sections, { ...mutation.section }],
      };
    }

    case "remove_section": {
      if (!sectionExists(ir, mutation.sectionId)) {
        throw new Error(`Section '${mutation.sectionId}' not found`);
      }
      return {
        ...ir,
        sections: ir.sections.filter((s) => s.id !== mutation.sectionId),
      };
    }

    case "reorder_section": {
      if (!sectionExists(ir, mutation.sectionId)) {
        throw new Error(`Section '${mutation.sectionId}' not found`);
      }
      return {
        ...ir,
        sections: ir.sections.map((s) =>
          s.id === mutation.sectionId ? { ...s, order: mutation.newOrder } : s,
        ),
      };
    }

    // -- Commands ----------------------------------------------------------

    case "add_command": {
      if (commandExists(ir, mutation.command.name)) {
        throw new Error(`Command '${mutation.command.name}' already exists`);
      }
      return {
        ...ir,
        commands: [...ir.commands, { ...mutation.command }],
      };
    }

    case "update_command": {
      if (!commandExists(ir, mutation.name)) {
        throw new Error(`Command '${mutation.name}' not found`);
      }
      return {
        ...ir,
        commands: ir.commands.map((c) =>
          c.name === mutation.name ? { ...c, content: mutation.content } : c,
        ),
      };
    }

    case "remove_command": {
      if (!commandExists(ir, mutation.name)) {
        throw new Error(`Command '${mutation.name}' not found`);
      }
      return {
        ...ir,
        commands: ir.commands.filter((c) => c.name !== mutation.name),
      };
    }

    // -- Rules -------------------------------------------------------------

    case "add_rule": {
      if (ruleExists(ir, mutation.rule.name)) {
        throw new Error(`Rule '${mutation.rule.name}' already exists`);
      }
      return {
        ...ir,
        rules: [...ir.rules, { ...mutation.rule }],
      };
    }

    case "update_rule": {
      if (!ruleExists(ir, mutation.name)) {
        throw new Error(`Rule '${mutation.name}' not found`);
      }
      return {
        ...ir,
        rules: ir.rules.map((r) =>
          r.name === mutation.name ? { ...r, content: mutation.content } : r,
        ),
      };
    }

    case "remove_rule": {
      if (!ruleExists(ir, mutation.name)) {
        throw new Error(`Rule '${mutation.name}' not found`);
      }
      return {
        ...ir,
        rules: ir.rules.filter((r) => r.name !== mutation.name),
      };
    }

    // -- Agents ------------------------------------------------------------

    case "add_agent": {
      if (agentExists(ir, mutation.agent.name)) {
        throw new Error(`Agent '${mutation.agent.name}' already exists`);
      }
      return {
        ...ir,
        agents: [...ir.agents, { ...mutation.agent }],
      };
    }

    case "update_agent": {
      if (!agentExists(ir, mutation.name)) {
        throw new Error(`Agent '${mutation.name}' not found`);
      }
      return {
        ...ir,
        agents: ir.agents.map((a) =>
          a.name === mutation.name ? { ...a, ...mutation.changes } : a,
        ),
      };
    }

    case "remove_agent": {
      if (!agentExists(ir, mutation.name)) {
        throw new Error(`Agent '${mutation.name}' not found`);
      }
      return {
        ...ir,
        agents: ir.agents.filter((a) => a.name !== mutation.name),
      };
    }

    // -- MCP Servers -------------------------------------------------------

    case "add_mcp_server": {
      if (mcpServerExists(ir, mutation.server.id)) {
        throw new Error(`MCP server '${mutation.server.id}' already exists`);
      }
      return {
        ...ir,
        mcpServers: [...ir.mcpServers, { ...mutation.server }],
      };
    }

    case "remove_mcp_server": {
      if (!mcpServerExists(ir, mutation.id)) {
        throw new Error(`MCP server '${mutation.id}' not found`);
      }
      return {
        ...ir,
        mcpServers: ir.mcpServers.filter((s) => s.id !== mutation.id),
      };
    }

    // -- Settings ----------------------------------------------------------

    case "update_settings": {
      return {
        ...ir,
        settings: applySettingsUpdate(ir.settings, mutation.path, mutation.value),
      };
    }

    // -- Raw text (legacy fallback) ----------------------------------------

    case "raw_text": {
      console.warn(
        "raw_text mutation is a legacy fallback — the text operation will be applied during rendering",
      );
      return { ...ir };
    }
  }
}

// ---------------------------------------------------------------------------
// applyIRMutations
// ---------------------------------------------------------------------------

/**
 * Apply a sequence of mutations to a HarnessIR, returning the final IR.
 *
 * Mutations are applied in order. If any mutation fails, the error propagates immediately.
 */
export function applyIRMutations(ir: HarnessIR, mutations: IRMutation[]): HarnessIR {
  return mutations.reduce<HarnessIR>(
    (acc, mut) => applyIRMutation(acc, mut),
    ir,
  );
}

// ---------------------------------------------------------------------------
// validateIRMutation
// ---------------------------------------------------------------------------

/**
 * Check whether a mutation's pre-conditions are satisfied without applying it.
 *
 * Returns `{ valid: true }` if the mutation can be applied, or
 * `{ valid: false, reason: "..." }` describing why it cannot.
 */
export function validateIRMutation(
  ir: HarnessIR,
  mutation: IRMutation,
): ValidationResult {
  switch (mutation.type) {
    // -- Sections ----------------------------------------------------------

    case "update_section": {
      if (!sectionExists(ir, mutation.sectionId)) {
        return { valid: false, reason: `Section '${mutation.sectionId}' not found` };
      }
      return { valid: true };
    }

    case "add_section": {
      if (sectionExists(ir, mutation.section.id)) {
        return { valid: false, reason: `Section '${mutation.section.id}' already exists` };
      }
      return { valid: true };
    }

    case "remove_section": {
      if (!sectionExists(ir, mutation.sectionId)) {
        return { valid: false, reason: `Section '${mutation.sectionId}' not found` };
      }
      return { valid: true };
    }

    case "reorder_section": {
      if (!sectionExists(ir, mutation.sectionId)) {
        return { valid: false, reason: `Section '${mutation.sectionId}' not found` };
      }
      return { valid: true };
    }

    // -- Commands ----------------------------------------------------------

    case "add_command": {
      if (commandExists(ir, mutation.command.name)) {
        return { valid: false, reason: `Command '${mutation.command.name}' already exists` };
      }
      return { valid: true };
    }

    case "update_command": {
      if (!commandExists(ir, mutation.name)) {
        return { valid: false, reason: `Command '${mutation.name}' not found` };
      }
      return { valid: true };
    }

    case "remove_command": {
      if (!commandExists(ir, mutation.name)) {
        return { valid: false, reason: `Command '${mutation.name}' not found` };
      }
      return { valid: true };
    }

    // -- Rules -------------------------------------------------------------

    case "add_rule": {
      if (ruleExists(ir, mutation.rule.name)) {
        return { valid: false, reason: `Rule '${mutation.rule.name}' already exists` };
      }
      return { valid: true };
    }

    case "update_rule": {
      if (!ruleExists(ir, mutation.name)) {
        return { valid: false, reason: `Rule '${mutation.name}' not found` };
      }
      return { valid: true };
    }

    case "remove_rule": {
      if (!ruleExists(ir, mutation.name)) {
        return { valid: false, reason: `Rule '${mutation.name}' not found` };
      }
      return { valid: true };
    }

    // -- Agents ------------------------------------------------------------

    case "add_agent": {
      if (agentExists(ir, mutation.agent.name)) {
        return { valid: false, reason: `Agent '${mutation.agent.name}' already exists` };
      }
      return { valid: true };
    }

    case "update_agent": {
      if (!agentExists(ir, mutation.name)) {
        return { valid: false, reason: `Agent '${mutation.name}' not found` };
      }
      return { valid: true };
    }

    case "remove_agent": {
      if (!agentExists(ir, mutation.name)) {
        return { valid: false, reason: `Agent '${mutation.name}' not found` };
      }
      return { valid: true };
    }

    // -- MCP Servers -------------------------------------------------------

    case "add_mcp_server": {
      if (mcpServerExists(ir, mutation.server.id)) {
        return { valid: false, reason: `MCP server '${mutation.server.id}' already exists` };
      }
      return { valid: true };
    }

    case "remove_mcp_server": {
      if (!mcpServerExists(ir, mutation.id)) {
        return { valid: false, reason: `MCP server '${mutation.id}' not found` };
      }
      return { valid: true };
    }

    // -- Settings & raw_text always valid at pre-condition level ------------

    case "update_settings": {
      return { valid: true };
    }

    case "raw_text": {
      return { valid: true };
    }
  }
}
