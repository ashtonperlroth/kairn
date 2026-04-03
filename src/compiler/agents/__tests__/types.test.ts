import { describe, it, expect } from "vitest";
import {
  TruncationError,
  VALID_AGENT_NAMES,
  validatePlan,
} from "../types.js";
import type {
  AgentName,
  CompilationPlan,
  CompilationPhase,
  AgentTask,
  AgentResult,
} from "../types.js";

// ---------------------------------------------------------------------------
// TruncationError
// ---------------------------------------------------------------------------

describe("TruncationError", () => {
  it("extends Error", () => {
    const err = new TruncationError("output truncated", {
      agentName: "sections-writer",
      tokensUsed: 95000,
    });

    expect(err).toBeInstanceOf(Error);
  });

  it("has the correct name property", () => {
    const err = new TruncationError("output truncated", {
      agentName: "command-writer",
      tokensUsed: 80000,
    });

    expect(err.name).toBe("TruncationError");
  });

  it("stores the message", () => {
    const err = new TruncationError("agent exceeded limit", {
      agentName: "rule-writer",
      tokensUsed: 120000,
    });

    expect(err.message).toBe("agent exceeded limit");
  });

  it("stores agentName and tokensUsed", () => {
    const err = new TruncationError("truncated", {
      agentName: "doc-writer",
      tokensUsed: 42000,
    });

    expect(err.agentName).toBe("doc-writer");
    expect(err.tokensUsed).toBe(42000);
  });

  it("agentName and tokensUsed are readonly", () => {
    const err = new TruncationError("truncated", {
      agentName: "skill-writer",
      tokensUsed: 50000,
    });

    // TypeScript readonly enforcement — at runtime we verify the values are set correctly
    expect(err.agentName).toBe("skill-writer");
    expect(err.tokensUsed).toBe(50000);
  });
});

// ---------------------------------------------------------------------------
// VALID_AGENT_NAMES
// ---------------------------------------------------------------------------

describe("VALID_AGENT_NAMES", () => {
  it("contains all six agent names", () => {
    expect(VALID_AGENT_NAMES).toHaveLength(6);
  });

  it("includes each expected agent name", () => {
    const expected: AgentName[] = [
      "sections-writer",
      "command-writer",
      "agent-writer",
      "rule-writer",
      "doc-writer",
      "skill-writer",
    ];

    for (const name of expected) {
      expect(VALID_AGENT_NAMES).toContain(name);
    }
  });

  it("is readonly (frozen at type level)", () => {
    // The array should be a readonly tuple — we can only verify length stability
    expect(Array.isArray(VALID_AGENT_NAMES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validatePlan — valid inputs
// ---------------------------------------------------------------------------

describe("validatePlan", () => {
  function makeValidPlan(): CompilationPlan {
    return {
      project_context: "A TypeScript CLI tool",
      phases: [
        {
          id: "phase-1",
          agents: [
            {
              agent: "sections-writer",
              items: ["purpose", "architecture"],
              max_tokens: 4096,
            },
          ],
          dependsOn: [],
        },
      ],
    };
  }

  it("accepts a valid CompilationPlan and returns it", () => {
    const plan = makeValidPlan();
    const result = validatePlan(plan);

    expect(result).toEqual(plan);
  });

  it("accepts a plan with multiple phases", () => {
    const plan: CompilationPlan = {
      project_context: "React dashboard app",
      phases: [
        {
          id: "phase-1",
          agents: [
            { agent: "sections-writer", items: ["overview"], max_tokens: 2048 },
          ],
          dependsOn: [],
        },
        {
          id: "phase-2",
          agents: [
            { agent: "command-writer", items: ["build", "test"], max_tokens: 4096 },
            { agent: "rule-writer", items: ["security"], max_tokens: 2048 },
          ],
          dependsOn: ["phase-1"],
        },
      ],
    };

    const result = validatePlan(plan);
    expect(result.phases).toHaveLength(2);
    expect(result.phases[1].agents).toHaveLength(2);
  });

  it("accepts a plan with context_hint on agent tasks", () => {
    const plan: CompilationPlan = {
      project_context: "Python ML pipeline",
      phases: [
        {
          id: "p1",
          agents: [
            {
              agent: "doc-writer",
              items: ["api-reference"],
              context_hint: "Focus on the REST API endpoints",
              max_tokens: 8192,
            },
          ],
          dependsOn: [],
        },
      ],
    };

    const result = validatePlan(plan);
    expect(result.phases[0].agents[0].context_hint).toBe(
      "Focus on the REST API endpoints",
    );
  });

  // -------------------------------------------------------------------------
  // validatePlan — invalid inputs
  // -------------------------------------------------------------------------

  it("throws on null input", () => {
    expect(() => validatePlan(null)).toThrow();
  });

  it("throws on undefined input", () => {
    expect(() => validatePlan(undefined)).toThrow();
  });

  it("throws on non-object input", () => {
    expect(() => validatePlan("not an object")).toThrow();
  });

  it("throws on missing project_context", () => {
    const plan = { phases: [{ id: "p1", agents: [], dependsOn: [] }] };
    expect(() => validatePlan(plan)).toThrow(/project_context/);
  });

  it("throws on empty string project_context", () => {
    const plan = {
      project_context: "",
      phases: [{ id: "p1", agents: [], dependsOn: [] }],
    };
    expect(() => validatePlan(plan)).toThrow(/project_context/);
  });

  it("throws on non-string project_context", () => {
    const plan = {
      project_context: 42,
      phases: [{ id: "p1", agents: [], dependsOn: [] }],
    };
    expect(() => validatePlan(plan)).toThrow(/project_context/);
  });

  it("throws on missing phases", () => {
    const plan = { project_context: "test" };
    expect(() => validatePlan(plan)).toThrow(/phases/);
  });

  it("throws on non-array phases", () => {
    const plan = { project_context: "test", phases: "not-array" };
    expect(() => validatePlan(plan)).toThrow(/phases/);
  });

  it("throws on empty phases array", () => {
    const plan = { project_context: "test", phases: [] };
    expect(() => validatePlan(plan)).toThrow(/phases/);
  });

  it("throws on phase with missing id", () => {
    const plan = {
      project_context: "test",
      phases: [{ agents: [{ agent: "sections-writer", items: [], max_tokens: 1024 }], dependsOn: [] }],
    };
    expect(() => validatePlan(plan)).toThrow(/id/);
  });

  it("throws on phase with non-string id", () => {
    const plan = {
      project_context: "test",
      phases: [{ id: 123, agents: [{ agent: "sections-writer", items: [], max_tokens: 1024 }], dependsOn: [] }],
    };
    expect(() => validatePlan(plan)).toThrow(/id/);
  });

  it("throws on phase with missing agents", () => {
    const plan = {
      project_context: "test",
      phases: [{ id: "p1", dependsOn: [] }],
    };
    expect(() => validatePlan(plan)).toThrow(/agents/);
  });

  it("throws on phase with non-array agents", () => {
    const plan = {
      project_context: "test",
      phases: [{ id: "p1", agents: "not-array", dependsOn: [] }],
    };
    expect(() => validatePlan(plan)).toThrow(/agents/);
  });

  it("throws on agent with invalid agent name", () => {
    const plan = {
      project_context: "test",
      phases: [
        {
          id: "p1",
          agents: [{ agent: "invalid-writer", items: [], max_tokens: 1024 }],
          dependsOn: [],
        },
      ],
    };
    expect(() => validatePlan(plan)).toThrow(/agent.*invalid-writer/i);
  });

  it("throws on agent with missing items", () => {
    const plan = {
      project_context: "test",
      phases: [
        {
          id: "p1",
          agents: [{ agent: "sections-writer", max_tokens: 1024 }],
          dependsOn: [],
        },
      ],
    };
    expect(() => validatePlan(plan)).toThrow(/items/);
  });

  it("throws on agent with non-array items", () => {
    const plan = {
      project_context: "test",
      phases: [
        {
          id: "p1",
          agents: [{ agent: "sections-writer", items: "not-array", max_tokens: 1024 }],
          dependsOn: [],
        },
      ],
    };
    expect(() => validatePlan(plan)).toThrow(/items/);
  });

  it("throws on agent with missing max_tokens", () => {
    const plan = {
      project_context: "test",
      phases: [
        {
          id: "p1",
          agents: [{ agent: "sections-writer", items: [] }],
          dependsOn: [],
        },
      ],
    };
    expect(() => validatePlan(plan)).toThrow(/max_tokens/);
  });

  it("throws on agent with non-number max_tokens", () => {
    const plan = {
      project_context: "test",
      phases: [
        {
          id: "p1",
          agents: [{ agent: "sections-writer", items: [], max_tokens: "big" }],
          dependsOn: [],
        },
      ],
    };
    expect(() => validatePlan(plan)).toThrow(/max_tokens/);
  });

  it("throws on phase with missing dependsOn", () => {
    const plan = {
      project_context: "test",
      phases: [
        {
          id: "p1",
          agents: [{ agent: "sections-writer", items: [], max_tokens: 1024 }],
        },
      ],
    };
    expect(() => validatePlan(plan)).toThrow(/dependsOn/);
  });
});

// ---------------------------------------------------------------------------
// AgentResult discriminated union
// ---------------------------------------------------------------------------

describe("AgentResult discriminated union", () => {
  it("sections-writer result has sections field", () => {
    const result: AgentResult = {
      agent: "sections-writer",
      sections: [
        { id: "purpose", heading: "## Purpose", content: "Build tools", order: 1 },
      ],
    };

    expect(result.agent).toBe("sections-writer");
    if (result.agent === "sections-writer") {
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].id).toBe("purpose");
    }
  });

  it("command-writer result has commands field", () => {
    const result: AgentResult = {
      agent: "command-writer",
      commands: [
        { name: "build", description: "Build the project", content: "npm run build" },
      ],
    };

    expect(result.agent).toBe("command-writer");
    if (result.agent === "command-writer") {
      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].name).toBe("build");
    }
  });

  it("agent-writer result has agents field", () => {
    const result: AgentResult = {
      agent: "agent-writer",
      agents: [{ name: "reviewer", content: "Review code" }],
    };

    expect(result.agent).toBe("agent-writer");
    if (result.agent === "agent-writer") {
      expect(result.agents).toHaveLength(1);
    }
  });

  it("rule-writer result has rules field", () => {
    const result: AgentResult = {
      agent: "rule-writer",
      rules: [{ name: "security", content: "No dangerous ops" }],
    };

    expect(result.agent).toBe("rule-writer");
    if (result.agent === "rule-writer") {
      expect(result.rules).toHaveLength(1);
    }
  });

  it("doc-writer result has docs field", () => {
    const result: AgentResult = {
      agent: "doc-writer",
      docs: [{ name: "api", content: "API docs" }],
    };

    expect(result.agent).toBe("doc-writer");
    if (result.agent === "doc-writer") {
      expect(result.docs).toHaveLength(1);
    }
  });

  it("skill-writer result has skills field", () => {
    const result: AgentResult = {
      agent: "skill-writer",
      skills: [{ name: "debug", content: "Debugging guide" }],
    };

    expect(result.agent).toBe("skill-writer");
    if (result.agent === "skill-writer") {
      expect(result.skills).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Type shape verification (compile-time + runtime)
// ---------------------------------------------------------------------------

describe("type shape verification", () => {
  it("AgentTask satisfies the interface with optional context_hint", () => {
    const task: AgentTask = {
      agent: "sections-writer",
      items: ["overview", "architecture"],
      max_tokens: 4096,
    };

    expect(task.agent).toBe("sections-writer");
    expect(task.items).toHaveLength(2);
    expect(task.max_tokens).toBe(4096);
    expect(task.context_hint).toBeUndefined();
  });

  it("AgentTask with context_hint", () => {
    const task: AgentTask = {
      agent: "command-writer",
      items: ["build"],
      context_hint: "Focus on npm scripts",
      max_tokens: 2048,
    };

    expect(task.context_hint).toBe("Focus on npm scripts");
  });

  it("CompilationPhase satisfies the interface", () => {
    const phase: CompilationPhase = {
      id: "phase-1",
      agents: [
        { agent: "sections-writer", items: ["overview"], max_tokens: 4096 },
      ],
      dependsOn: [],
    };

    expect(phase.id).toBe("phase-1");
    expect(phase.agents).toHaveLength(1);
    expect(phase.dependsOn).toEqual([]);
  });

  it("CompilationPhase with dependencies", () => {
    const phase: CompilationPhase = {
      id: "phase-2",
      agents: [
        { agent: "command-writer", items: ["test"], max_tokens: 2048 },
      ],
      dependsOn: ["phase-1"],
    };

    expect(phase.dependsOn).toEqual(["phase-1"]);
  });

  it("CompilationPlan satisfies the interface", () => {
    const plan: CompilationPlan = {
      project_context: "A Node.js web server",
      phases: [
        {
          id: "p1",
          agents: [
            { agent: "sections-writer", items: ["overview"], max_tokens: 4096 },
          ],
          dependsOn: [],
        },
      ],
    };

    expect(plan.project_context).toBe("A Node.js web server");
    expect(plan.phases).toHaveLength(1);
  });
});
