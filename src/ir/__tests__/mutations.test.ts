import { describe, it, expect, vi } from "vitest";
import {
  applyIRMutation,
  applyIRMutations,
  validateIRMutation,
} from "../mutations.js";
import {
  createEmptyIR,
  createSection,
  createCommandNode,
  createRuleNode,
  createAgentNode,
} from "../types.js";
import type { IRMutation, HarnessIR } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an IR pre-populated with a single section, command, rule, agent, and MCP server. */
function buildSeededIR(): HarnessIR {
  const ir = createEmptyIR();
  return {
    ...ir,
    sections: [
      createSection("purpose", "## Purpose", "Build cool things", 0),
      createSection("commands", "## Commands", "npm run build", 1),
    ],
    commands: [createCommandNode("dev", "Run dev server", "Start development")],
    rules: [createRuleNode("security", "No dangerous ops", ["src/**"])],
    agents: [createAgentNode("reviewer", "Review code", "sonnet")],
    mcpServers: [
      { id: "github", command: "npx", args: ["-y", "@github/mcp-server"] },
    ],
  };
}

// ---------------------------------------------------------------------------
// update_section
// ---------------------------------------------------------------------------

describe("applyIRMutation — update_section", () => {
  it("replaces the content of the targeted section", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_section",
      sectionId: "purpose",
      content: "Build amazing things",
      rationale: "Clarify purpose",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.sections.find((s) => s.id === "purpose")?.content).toBe(
      "Build amazing things",
    );
  });

  it("throws an error when the section does not exist", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_section",
      sectionId: "nonexistent",
      content: "Oops",
      rationale: "Won't work",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "Section 'nonexistent' not found",
    );
  });
});

// ---------------------------------------------------------------------------
// add_section
// ---------------------------------------------------------------------------

describe("applyIRMutation — add_section", () => {
  it("appends a new section to the IR", () => {
    const ir = buildSeededIR();
    const newSection = createSection("testing", "## Testing", "vitest", 2);
    const mutation: IRMutation = {
      type: "add_section",
      section: newSection,
      rationale: "Add testing section",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.sections).toHaveLength(3);
    expect(result.sections[2].id).toBe("testing");
    expect(result.sections[2].content).toBe("vitest");
    expect(result.sections[2].order).toBe(2);
  });

  it("throws an error when a section with the same ID already exists", () => {
    const ir = buildSeededIR();
    const duplicate = createSection("purpose", "## Purpose v2", "Dup", 5);
    const mutation: IRMutation = {
      type: "add_section",
      section: duplicate,
      rationale: "Should fail",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "Section 'purpose' already exists",
    );
  });
});

// ---------------------------------------------------------------------------
// remove_section
// ---------------------------------------------------------------------------

describe("applyIRMutation — remove_section", () => {
  it("removes the targeted section and preserves the rest", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_section",
      sectionId: "purpose",
      rationale: "No longer needed",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].id).toBe("commands");
  });

  it("throws an error when the section does not exist", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_section",
      sectionId: "ghost",
      rationale: "Doesn't exist",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "Section 'ghost' not found",
    );
  });
});

// ---------------------------------------------------------------------------
// reorder_section
// ---------------------------------------------------------------------------

describe("applyIRMutation — reorder_section", () => {
  it("updates the order field of the targeted section", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "reorder_section",
      sectionId: "commands",
      newOrder: 10,
      rationale: "Move commands down",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.sections.find((s) => s.id === "commands")?.order).toBe(10);
  });

  it("throws an error when the section does not exist", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "reorder_section",
      sectionId: "missing",
      newOrder: 5,
      rationale: "Won't work",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "Section 'missing' not found",
    );
  });
});

// ---------------------------------------------------------------------------
// add_command
// ---------------------------------------------------------------------------

describe("applyIRMutation — add_command", () => {
  it("appends a new command to the IR", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_command",
      command: createCommandNode("lint", "Run linter", "ESLint check"),
      rationale: "Add lint command",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.commands).toHaveLength(2);
    expect(result.commands[1].name).toBe("lint");
  });

  it("throws an error when a command with the same name already exists", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_command",
      command: createCommandNode("dev", "Duplicate"),
      rationale: "Duplicate",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "Command 'dev' already exists",
    );
  });
});

// ---------------------------------------------------------------------------
// update_command
// ---------------------------------------------------------------------------

describe("applyIRMutation — update_command", () => {
  it("replaces the content of the targeted command", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_command",
      name: "dev",
      content: "Run dev server with --watch",
      rationale: "Add watch flag",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.commands.find((c) => c.name === "dev")?.content).toBe(
      "Run dev server with --watch",
    );
  });

  it("throws an error when the command does not exist", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_command",
      name: "missing",
      content: "Nothing",
      rationale: "Won't work",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "Command 'missing' not found",
    );
  });
});

// ---------------------------------------------------------------------------
// remove_command
// ---------------------------------------------------------------------------

describe("applyIRMutation — remove_command", () => {
  it("removes the targeted command", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_command",
      name: "dev",
      rationale: "No longer needed",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.commands).toHaveLength(0);
  });

  it("throws an error when the command does not exist", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_command",
      name: "ghost",
      rationale: "Won't work",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "Command 'ghost' not found",
    );
  });
});

// ---------------------------------------------------------------------------
// add_rule
// ---------------------------------------------------------------------------

describe("applyIRMutation — add_rule", () => {
  it("appends a new rule with paths to the IR", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_rule",
      rule: createRuleNode("typescript", "Use strict mode", ["src/**/*.ts"]),
      rationale: "Add TS rule",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.rules).toHaveLength(2);
    expect(result.rules[1].name).toBe("typescript");
    expect(result.rules[1].paths).toEqual(["src/**/*.ts"]);
  });

  it("throws an error when a rule with the same name already exists", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_rule",
      rule: createRuleNode("security", "Duplicate"),
      rationale: "Duplicate",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "Rule 'security' already exists",
    );
  });
});

// ---------------------------------------------------------------------------
// update_rule
// ---------------------------------------------------------------------------

describe("applyIRMutation — update_rule", () => {
  it("replaces the content of the targeted rule", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_rule",
      name: "security",
      content: "Strict security: no eval, no exec",
      rationale: "Tighten security",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.rules.find((r) => r.name === "security")?.content).toBe(
      "Strict security: no eval, no exec",
    );
  });

  it("throws an error when the rule does not exist", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_rule",
      name: "nonexistent",
      content: "Nothing",
      rationale: "Won't work",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "Rule 'nonexistent' not found",
    );
  });
});

// ---------------------------------------------------------------------------
// remove_rule
// ---------------------------------------------------------------------------

describe("applyIRMutation — remove_rule", () => {
  it("removes the targeted rule", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_rule",
      name: "security",
      rationale: "Replaced by agent",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.rules).toHaveLength(0);
  });

  it("throws an error when the rule does not exist", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_rule",
      name: "ghost",
      rationale: "Won't work",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "Rule 'ghost' not found",
    );
  });
});

// ---------------------------------------------------------------------------
// add_agent
// ---------------------------------------------------------------------------

describe("applyIRMutation — add_agent", () => {
  it("appends a new agent to the IR", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_agent",
      agent: createAgentNode("architect", "Design systems", "opus"),
      rationale: "Add architect agent",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.agents).toHaveLength(2);
    expect(result.agents[1].name).toBe("architect");
    expect(result.agents[1].model).toBe("opus");
  });

  it("throws an error when an agent with the same name already exists", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_agent",
      agent: createAgentNode("reviewer", "Duplicate"),
      rationale: "Duplicate",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "Agent 'reviewer' already exists",
    );
  });
});

// ---------------------------------------------------------------------------
// update_agent
// ---------------------------------------------------------------------------

describe("applyIRMutation — update_agent", () => {
  it("merges partial changes into the targeted agent", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_agent",
      name: "reviewer",
      changes: { model: "opus", disallowedTools: ["Bash"] },
      rationale: "Upgrade reviewer",
    };

    const result = applyIRMutation(ir, mutation);
    const agent = result.agents.find((a) => a.name === "reviewer");

    expect(agent?.model).toBe("opus");
    expect(agent?.disallowedTools).toEqual(["Bash"]);
    expect(agent?.content).toBe("Review code");
  });

  it("throws an error when the agent does not exist", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_agent",
      name: "nonexistent",
      changes: { model: "opus" },
      rationale: "Won't work",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "Agent 'nonexistent' not found",
    );
  });
});

// ---------------------------------------------------------------------------
// remove_agent
// ---------------------------------------------------------------------------

describe("applyIRMutation — remove_agent", () => {
  it("removes the targeted agent", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_agent",
      name: "reviewer",
      rationale: "Consolidating",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.agents).toHaveLength(0);
  });

  it("throws an error when the agent does not exist", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_agent",
      name: "ghost",
      rationale: "Won't work",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "Agent 'ghost' not found",
    );
  });
});

// ---------------------------------------------------------------------------
// add_mcp_server
// ---------------------------------------------------------------------------

describe("applyIRMutation — add_mcp_server", () => {
  it("appends a new MCP server to the IR", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_mcp_server",
      server: {
        id: "slack",
        command: "npx",
        args: ["-y", "@slack/mcp-server"],
        env: { SLACK_TOKEN: "xoxb-123" },
      },
      rationale: "Add Slack integration",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.mcpServers).toHaveLength(2);
    expect(result.mcpServers[1].id).toBe("slack");
    expect(result.mcpServers[1].env).toEqual({ SLACK_TOKEN: "xoxb-123" });
  });

  it("throws an error when an MCP server with the same ID already exists", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_mcp_server",
      server: { id: "github", command: "npx", args: ["dup"] },
      rationale: "Duplicate",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "MCP server 'github' already exists",
    );
  });
});

// ---------------------------------------------------------------------------
// remove_mcp_server
// ---------------------------------------------------------------------------

describe("applyIRMutation — remove_mcp_server", () => {
  it("removes the targeted MCP server", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_mcp_server",
      id: "github",
      rationale: "Remove GitHub integration",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.mcpServers).toHaveLength(0);
  });

  it("throws an error when the MCP server does not exist", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_mcp_server",
      id: "nonexistent",
      rationale: "Won't work",
    };

    expect(() => applyIRMutation(ir, mutation)).toThrow(
      "MCP server 'nonexistent' not found",
    );
  });
});

// ---------------------------------------------------------------------------
// update_settings
// ---------------------------------------------------------------------------

describe("applyIRMutation — update_settings", () => {
  it("sets a simple dotted path in settings", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_settings",
      path: "statusLine.command",
      value: "git status",
      rationale: "Add status line",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.settings.statusLine).toEqual({ command: "git status" });
  });

  it("sets a top-level setting into settings.raw when it does not map to a structured field", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_settings",
      path: "customSetting",
      value: true,
      rationale: "Add custom flag",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.settings.raw["customSetting"]).toBe(true);
  });

  it("sets a nested path into settings.raw for unrecognized fields", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_settings",
      path: "custom.nested.value",
      value: 42,
      rationale: "Deep setting",
    };

    const result = applyIRMutation(ir, mutation);
    const raw = result.settings.raw as Record<string, Record<string, Record<string, unknown>>>;

    expect(raw["custom"]["nested"]["value"]).toBe(42);
  });

  it("sets denyPatterns when path is 'denyPatterns'", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_settings",
      path: "denyPatterns",
      value: ["rm -rf /", "curl | sh"],
      rationale: "Add deny patterns",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result.settings.denyPatterns).toEqual(["rm -rf /", "curl | sh"]);
  });
});

// ---------------------------------------------------------------------------
// raw_text (legacy fallback)
// ---------------------------------------------------------------------------

describe("applyIRMutation — raw_text", () => {
  it("returns the IR unchanged and logs a warning", () => {
    const ir = buildSeededIR();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mutation: IRMutation = {
      type: "raw_text",
      file: "CLAUDE.md",
      action: "replace",
      oldText: "old",
      newText: "new",
      rationale: "Fix typo",
    };

    const result = applyIRMutation(ir, mutation);

    expect(result).toEqual(ir);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("raw_text"),
    );

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe("applyIRMutation — immutability", () => {
  it("does not mutate the original IR when updating a section", () => {
    const ir = buildSeededIR();
    const originalContent = ir.sections[0].content;

    const mutation: IRMutation = {
      type: "update_section",
      sectionId: "purpose",
      content: "Totally different",
      rationale: "Change it",
    };

    const result = applyIRMutation(ir, mutation);

    expect(ir.sections[0].content).toBe(originalContent);
    expect(result.sections[0].content).toBe("Totally different");
    expect(result).not.toBe(ir);
    expect(result.sections).not.toBe(ir.sections);
  });

  it("does not mutate the original IR when adding a command", () => {
    const ir = buildSeededIR();
    const originalLength = ir.commands.length;

    const mutation: IRMutation = {
      type: "add_command",
      command: createCommandNode("new-cmd", "New command content"),
      rationale: "Add new",
    };

    const result = applyIRMutation(ir, mutation);

    expect(ir.commands).toHaveLength(originalLength);
    expect(result.commands).toHaveLength(originalLength + 1);
    expect(result.commands).not.toBe(ir.commands);
  });

  it("does not mutate the original IR when removing a rule", () => {
    const ir = buildSeededIR();
    const originalLength = ir.rules.length;

    const mutation: IRMutation = {
      type: "remove_rule",
      name: "security",
      rationale: "Remove it",
    };

    const result = applyIRMutation(ir, mutation);

    expect(ir.rules).toHaveLength(originalLength);
    expect(result.rules).toHaveLength(originalLength - 1);
  });

  it("does not mutate the original IR when updating an agent", () => {
    const ir = buildSeededIR();
    const originalModel = ir.agents[0].model;

    const mutation: IRMutation = {
      type: "update_agent",
      name: "reviewer",
      changes: { model: "opus" },
      rationale: "Upgrade",
    };

    const result = applyIRMutation(ir, mutation);

    expect(ir.agents[0].model).toBe(originalModel);
    expect(result.agents[0].model).toBe("opus");
  });

  it("does not mutate the original IR when updating settings", () => {
    const ir = buildSeededIR();

    const mutation: IRMutation = {
      type: "update_settings",
      path: "statusLine.command",
      value: "echo hi",
      rationale: "Set status",
    };

    const result = applyIRMutation(ir, mutation);

    expect(ir.settings.statusLine).toBeUndefined();
    expect(result.settings.statusLine).toEqual({ command: "echo hi" });
    expect(result.settings).not.toBe(ir.settings);
  });
});

// ---------------------------------------------------------------------------
// applyIRMutations (batch)
// ---------------------------------------------------------------------------

describe("applyIRMutations", () => {
  it("applies a sequence of mutations in order", () => {
    const ir = buildSeededIR();
    const mutations: IRMutation[] = [
      {
        type: "add_section",
        section: createSection("testing", "## Testing", "vitest", 2),
        rationale: "Add testing",
      },
      {
        type: "update_section",
        sectionId: "testing",
        content: "vitest + coverage",
        rationale: "Update testing",
      },
      {
        type: "add_command",
        command: createCommandNode("test", "npm test"),
        rationale: "Add test command",
      },
    ];

    const result = applyIRMutations(ir, mutations);

    expect(result.sections).toHaveLength(3);
    expect(result.sections.find((s) => s.id === "testing")?.content).toBe(
      "vitest + coverage",
    );
    expect(result.commands).toHaveLength(2);
    expect(result.commands[1].name).toBe("test");
  });

  it("returns the original IR unchanged when given an empty array", () => {
    const ir = buildSeededIR();
    const result = applyIRMutations(ir, []);

    expect(result).toEqual(ir);
  });

  it("throws on the first invalid mutation in the sequence", () => {
    const ir = buildSeededIR();
    const mutations: IRMutation[] = [
      {
        type: "add_section",
        section: createSection("new", "## New", "content", 5),
        rationale: "Good",
      },
      {
        type: "update_section",
        sectionId: "nonexistent",
        content: "Oops",
        rationale: "Bad",
      },
    ];

    expect(() => applyIRMutations(ir, mutations)).toThrow(
      "Section 'nonexistent' not found",
    );
  });
});

// ---------------------------------------------------------------------------
// validateIRMutation
// ---------------------------------------------------------------------------

describe("validateIRMutation", () => {
  it("returns valid for a valid update_section mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_section",
      sectionId: "purpose",
      content: "New content",
      rationale: "Update",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("returns invalid with reason for update_section on missing section", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_section",
      sectionId: "nonexistent",
      content: "Content",
      rationale: "Update",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Section 'nonexistent' not found");
  });

  it("returns valid for a valid add_section mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_section",
      section: createSection("new", "## New", "content", 5),
      rationale: "Add new",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(true);
  });

  it("returns invalid for add_section with duplicate ID", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_section",
      section: createSection("purpose", "## Purpose", "dup", 5),
      rationale: "Duplicate",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Section 'purpose' already exists");
  });

  it("returns valid for a valid remove_section mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_section",
      sectionId: "purpose",
      rationale: "Remove",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(true);
  });

  it("returns invalid for remove_section on missing section", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_section",
      sectionId: "ghost",
      rationale: "Missing",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Section 'ghost' not found");
  });

  it("returns valid for a valid reorder_section mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "reorder_section",
      sectionId: "commands",
      newOrder: 10,
      rationale: "Reorder",
    };

    expect(validateIRMutation(ir, mutation).valid).toBe(true);
  });

  it("returns invalid for reorder_section on missing section", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "reorder_section",
      sectionId: "missing",
      newOrder: 0,
      rationale: "Missing",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Section 'missing' not found");
  });

  it("returns valid for a valid add_command mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_command",
      command: createCommandNode("lint", "Run lint"),
      rationale: "Add lint",
    };

    expect(validateIRMutation(ir, mutation).valid).toBe(true);
  });

  it("returns invalid for add_command with duplicate name", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_command",
      command: createCommandNode("dev", "Dup"),
      rationale: "Duplicate",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Command 'dev' already exists");
  });

  it("returns valid for a valid update_command mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_command",
      name: "dev",
      content: "Updated",
      rationale: "Update",
    };

    expect(validateIRMutation(ir, mutation).valid).toBe(true);
  });

  it("returns invalid for update_command on missing command", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_command",
      name: "missing",
      content: "Content",
      rationale: "Missing",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Command 'missing' not found");
  });

  it("returns valid for a valid remove_command mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_command",
      name: "dev",
      rationale: "Remove",
    };

    expect(validateIRMutation(ir, mutation).valid).toBe(true);
  });

  it("returns invalid for remove_command on missing command", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_command",
      name: "ghost",
      rationale: "Missing",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Command 'ghost' not found");
  });

  it("returns valid for a valid add_rule mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_rule",
      rule: createRuleNode("typescript", "Strict mode"),
      rationale: "Add rule",
    };

    expect(validateIRMutation(ir, mutation).valid).toBe(true);
  });

  it("returns invalid for add_rule with duplicate name", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_rule",
      rule: createRuleNode("security", "Dup"),
      rationale: "Duplicate",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Rule 'security' already exists");
  });

  it("returns valid for a valid update_rule mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_rule",
      name: "security",
      content: "Updated",
      rationale: "Update",
    };

    expect(validateIRMutation(ir, mutation).valid).toBe(true);
  });

  it("returns invalid for update_rule on missing rule", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_rule",
      name: "missing",
      content: "Content",
      rationale: "Missing",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Rule 'missing' not found");
  });

  it("returns valid for a valid remove_rule mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_rule",
      name: "security",
      rationale: "Remove",
    };

    expect(validateIRMutation(ir, mutation).valid).toBe(true);
  });

  it("returns invalid for remove_rule on missing rule", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_rule",
      name: "ghost",
      rationale: "Missing",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Rule 'ghost' not found");
  });

  it("returns valid for a valid add_agent mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_agent",
      agent: createAgentNode("architect", "Design"),
      rationale: "Add agent",
    };

    expect(validateIRMutation(ir, mutation).valid).toBe(true);
  });

  it("returns invalid for add_agent with duplicate name", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_agent",
      agent: createAgentNode("reviewer", "Dup"),
      rationale: "Duplicate",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Agent 'reviewer' already exists");
  });

  it("returns valid for a valid update_agent mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_agent",
      name: "reviewer",
      changes: { model: "opus" },
      rationale: "Update",
    };

    expect(validateIRMutation(ir, mutation).valid).toBe(true);
  });

  it("returns invalid for update_agent on missing agent", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_agent",
      name: "missing",
      changes: { model: "opus" },
      rationale: "Missing",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Agent 'missing' not found");
  });

  it("returns valid for a valid remove_agent mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_agent",
      name: "reviewer",
      rationale: "Remove",
    };

    expect(validateIRMutation(ir, mutation).valid).toBe(true);
  });

  it("returns invalid for remove_agent on missing agent", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_agent",
      name: "ghost",
      rationale: "Missing",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Agent 'ghost' not found");
  });

  it("returns valid for a valid add_mcp_server mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_mcp_server",
      server: { id: "slack", command: "npx", args: ["@slack/mcp"] },
      rationale: "Add slack",
    };

    expect(validateIRMutation(ir, mutation).valid).toBe(true);
  });

  it("returns invalid for add_mcp_server with duplicate ID", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "add_mcp_server",
      server: { id: "github", command: "npx", args: ["dup"] },
      rationale: "Duplicate",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("MCP server 'github' already exists");
  });

  it("returns valid for a valid remove_mcp_server mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_mcp_server",
      id: "github",
      rationale: "Remove",
    };

    expect(validateIRMutation(ir, mutation).valid).toBe(true);
  });

  it("returns invalid for remove_mcp_server on missing server", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "remove_mcp_server",
      id: "ghost",
      rationale: "Missing",
    };

    const result = validateIRMutation(ir, mutation);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("MCP server 'ghost' not found");
  });

  it("returns valid for update_settings mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "update_settings",
      path: "statusLine.command",
      value: "echo hi",
      rationale: "Update",
    };

    expect(validateIRMutation(ir, mutation).valid).toBe(true);
  });

  it("returns valid for raw_text mutation", () => {
    const ir = buildSeededIR();
    const mutation: IRMutation = {
      type: "raw_text",
      file: "CLAUDE.md",
      action: "replace",
      oldText: "old",
      newText: "new",
      rationale: "Fix",
    };

    expect(validateIRMutation(ir, mutation).valid).toBe(true);
  });
});
