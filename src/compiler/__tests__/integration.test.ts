/**
 * Integration tests for the multi-agent compilation pipeline.
 *
 * Tests the interaction between plan generation, batch execution, linker
 * validation, and backward compatibility with the existing EnvironmentSpec.
 *
 * Uses real functions (generateDefaultPlan, executePlan, linkHarness) with
 * mock data -- not mocking internal implementation.
 */

import { describe, it, expect } from "vitest";
import {
  createEmptyIR,
  createSection,
  createCommandNode,
  createRuleNode,
  createAgentNode,
} from "../../ir/types.js";
import type {
  HarnessIR,
  Section,
  CommandNode,
  RuleNode,
  AgentNode,
  DocNode,
  SkillNode,
} from "../../ir/types.js";
import { renderHarness } from "../../ir/renderer.js";
import { buildFileMap } from "../../adapter/claude-code.js";
import type { EnvironmentSpec, SkeletonSpec } from "../../types.js";
import { generateDefaultPlan } from "../plan.js";
import { executePlan } from "../batch.js";
import { linkHarness } from "../linker.js";
import type {
  AgentResult,
  AgentTask,
  CompilationPlan,
} from "../agents/types.js";
import { TruncationError } from "../agents/types.js";
import type { ExecuteAgentFn } from "../batch.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal legacy EnvironmentSpec (no `ir` field, flat harness fields). */
function createLegacySpec(overrides?: Partial<EnvironmentSpec>): EnvironmentSpec {
  return {
    id: "env_test-legacy-001",
    name: "Legacy Project",
    description: "A test project without IR",
    intent: "Build a TypeScript CLI tool",
    created_at: "2025-01-01T00:00:00.000Z",
    autonomy_level: 1,
    tools: [],
    harness: {
      claude_md: "# Legacy Project\n\n## Purpose\n\nBuild a CLI tool.\n\n## Commands\n\n```bash\nnpm run build\nnpm test\n```",
      settings: {},
      mcp_config: {},
      commands: {
        build: "Run `npm run build` to compile the project.",
        test: "Run `npm test` to execute the test suite.",
        help: "Show available commands and usage.",
      },
      rules: {
        security: "Never log API keys or secrets.",
        continuity: "Update DECISIONS.md after every significant change.",
      },
      skills: {},
      agents: {
        reviewer: "You are a code reviewer. Check for quality issues.",
      },
      docs: {
        DECISIONS: "# Decisions\n\nRecord decisions here.",
      },
      hooks: {},
      intent_patterns: [],
      intent_prompt_template: "",
    },
    ...overrides,
  };
}

/** Create a skeleton spec for plan generation tests. */
function createTestSkeleton(overrides?: Partial<SkeletonSpec>): SkeletonSpec {
  return {
    name: "Test Project",
    description: "A test project for integration tests",
    tools: [{ tool_id: "context7", reason: "Documentation lookup" }],
    outline: {
      tech_stack: ["TypeScript", "Node.js"],
      workflow_type: "backend-api",
      key_commands: ["build", "test", "lint", "deploy"],
      custom_rules: ["error-handling"],
      custom_agents: ["architect", "tester"],
      custom_skills: ["tdd"],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Backward compatibility
// ---------------------------------------------------------------------------

describe("backward compatibility: legacy EnvironmentSpec without ir field", () => {
  it("buildFileMap produces correct file map for legacy specs", () => {
    const spec = createLegacySpec();
    const fileMap = buildFileMap(spec);

    // CLAUDE.md must be present
    expect(fileMap.has(".claude/CLAUDE.md")).toBe(true);
    expect(fileMap.get(".claude/CLAUDE.md")).toContain("# Legacy Project");

    // Commands must be present
    expect(fileMap.has(".claude/commands/build.md")).toBe(true);
    expect(fileMap.has(".claude/commands/test.md")).toBe(true);
    expect(fileMap.has(".claude/commands/help.md")).toBe(true);

    // Rules must be present
    expect(fileMap.has(".claude/rules/security.md")).toBe(true);
    expect(fileMap.has(".claude/rules/continuity.md")).toBe(true);

    // Agents must be present
    expect(fileMap.has(".claude/agents/reviewer.md")).toBe(true);

    // Docs must be present
    expect(fileMap.has(".claude/docs/DECISIONS.md")).toBe(true);
  });

  it("buildFileMap handles spec with minimal harness fields gracefully", () => {
    const spec = createLegacySpec({
      harness: {
        claude_md: "# Minimal",
        settings: {},
        mcp_config: {},
        commands: {},
        rules: {},
        skills: {},
        agents: {},
        docs: {},
        hooks: {},
        intent_patterns: [],
        intent_prompt_template: "",
      },
    });

    const fileMap = buildFileMap(spec);

    // CLAUDE.md must always be present
    expect(fileMap.has(".claude/CLAUDE.md")).toBe(true);
    expect(fileMap.get(".claude/CLAUDE.md")).toContain("# Minimal");

    // The file map should be non-empty (applyAutonomyLevel injects baseline
    // commands, docs, etc. even when user harness fields are empty)
    expect(fileMap.size).toBeGreaterThanOrEqual(1);

    // All file paths should start with .claude/ or .mcp.json
    for (const key of fileMap.keys()) {
      expect(
        key.startsWith(".claude/") || key === ".mcp.json",
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2: IR -> flat harness consistency
// ---------------------------------------------------------------------------

describe("IR to flat harness consistency", () => {
  it("IR commands and flat harness commands contain equivalent data", () => {
    const ir = createEmptyIR();
    ir.meta.name = "Consistent Project";
    ir.sections = [
      createSection("preamble", "# Consistent Project", "A project.", 0),
    ];
    ir.commands = [
      createCommandNode("build", "Run npm run build."),
      createCommandNode("test", "Run npm test."),
    ];
    ir.rules = [
      createRuleNode("security", "No secrets."),
      createRuleNode("style", "Use TypeScript strict mode."),
    ];
    ir.agents = [
      createAgentNode("reviewer", "Review code quality."),
    ];

    // Render IR to file map
    const irFileMap = renderHarness(ir);

    // Build equivalent flat harness fields
    const flatCommands: Record<string, string> = {};
    for (const cmd of ir.commands) {
      flatCommands[cmd.name] = cmd.content;
    }
    const flatRules: Record<string, string> = {};
    for (const rule of ir.rules) {
      flatRules[rule.name] = rule.content;
    }

    // IR commands should match flat commands
    expect(Object.keys(flatCommands).sort()).toEqual(
      ir.commands.map((c) => c.name).sort(),
    );

    // IR rules should match flat rules
    expect(Object.keys(flatRules).sort()).toEqual(
      ir.rules.map((r) => r.name).sort(),
    );

    // IR file map should contain all command files
    for (const name of Object.keys(flatCommands)) {
      expect(irFileMap.has(`commands/${name}.md`)).toBe(true);
    }

    // IR file map should contain all rule files
    for (const name of Object.keys(flatRules)) {
      expect(irFileMap.has(`rules/${name}.md`)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3: linkHarness fixes broken refs
// ---------------------------------------------------------------------------

describe("linkHarness fixes broken references", () => {
  it("removes @nonexistent agent references from command content", () => {
    const ir = createEmptyIR();
    ir.commands = [
      createCommandNode(
        "deploy",
        "Run the deployment. Delegate to @nonexistent-agent for validation.",
      ),
    ];
    ir.agents = [
      createAgentNode("reviewer", "Review code."),
    ];

    const { ir: patched, report } = linkHarness(ir);

    // The @nonexistent-agent reference should be removed
    const deployCmd = patched.commands.find((c) => c.name === "deploy");
    expect(deployCmd).toBeDefined();
    expect(deployCmd!.content).not.toContain("@nonexistent-agent");
    expect(deployCmd!.content).toContain("Run the deployment.");

    // Report should note the fix
    expect(report.autoFixes.some((f) => f.includes("nonexistent-agent"))).toBe(true);
  });

  it("preserves valid @agent references in command content", () => {
    const ir = createEmptyIR();
    ir.commands = [
      createCommandNode(
        "review",
        "Delegate to @reviewer for code review.",
      ),
    ];
    ir.agents = [
      createAgentNode("reviewer", "Review code."),
    ];

    const { ir: patched } = linkHarness(ir);

    const reviewCmd = patched.commands.find((c) => c.name === "review");
    expect(reviewCmd!.content).toContain("@reviewer");
  });

  it("injects security and continuity rules when missing", () => {
    const ir = createEmptyIR();
    ir.commands = [
      createCommandNode("build", "Run build."),
    ];
    // No rules at all

    const { ir: patched, report } = linkHarness(ir);

    const ruleNames = patched.rules.map((r) => r.name);
    expect(ruleNames).toContain("security");
    expect(ruleNames).toContain("continuity");
    expect(report.autoFixes.some((f) => f.includes("security"))).toBe(true);
    expect(report.autoFixes.some((f) => f.includes("continuity"))).toBe(true);
  });

  it("does not duplicate existing security and continuity rules", () => {
    const ir = createEmptyIR();
    ir.rules = [
      createRuleNode("security", "Custom security rule."),
      createRuleNode("continuity", "Custom continuity rule."),
    ];

    const { ir: patched, report } = linkHarness(ir);

    const securityRules = patched.rules.filter((r) => r.name === "security");
    expect(securityRules).toHaveLength(1);
    expect(securityRules[0].content).toBe("Custom security rule.");

    const continuityRules = patched.rules.filter((r) => r.name === "continuity");
    expect(continuityRules).toHaveLength(1);

    expect(report.autoFixes.filter((f) => f.includes("rule")).length).toBe(0);
  });

  it("injects /project:help command when missing", () => {
    const ir = createEmptyIR();
    ir.commands = [
      createCommandNode("build", "Run build."),
    ];

    const { ir: patched, report } = linkHarness(ir);

    const helpCmd = patched.commands.find((c) => c.name === "help");
    expect(helpCmd).toBeDefined();
    expect(report.autoFixes.some((f) => f.includes("help"))).toBe(true);
  });

  it("does not mutate the original IR", () => {
    const ir = createEmptyIR();
    ir.commands = [
      createCommandNode("deploy", "Delegate to @ghost for deployment."),
    ];

    linkHarness(ir);

    // Original should still contain the broken ref
    expect(ir.commands[0].content).toContain("@ghost");
  });
});

// ---------------------------------------------------------------------------
// Test 4: executePlan + mergeIntoIR produces complete IR
// ---------------------------------------------------------------------------

describe("executePlan produces complete IR from mock agents", () => {
  it("merges results from multiple phases into a single IR", async () => {
    const plan: CompilationPlan = {
      project_context: "CLI Project: A command-line tool using TypeScript",
      phases: [
        {
          id: "phase-a",
          agents: [
            { agent: "sections-writer", items: ["purpose", "tech-stack"], max_tokens: 4096 },
            { agent: "rule-writer", items: ["security"], max_tokens: 2048 },
            { agent: "doc-writer", items: ["DECISIONS"], max_tokens: 2048 },
          ],
          dependsOn: [],
        },
        {
          id: "phase-b",
          agents: [
            { agent: "command-writer", items: ["build", "test"], max_tokens: 4096 },
            { agent: "agent-writer", items: ["reviewer"], max_tokens: 4096 },
          ],
          dependsOn: ["phase-a"],
        },
      ],
    };

    const mockExecuteAgent: ExecuteAgentFn = async (
      task: AgentTask,
    ): Promise<AgentResult> => {
      switch (task.agent) {
        case "sections-writer":
          return {
            agent: "sections-writer",
            sections: [
              createSection("purpose", "## Purpose", "Build a CLI.", 1),
              createSection("tech-stack", "## Tech Stack", "TypeScript", 2),
            ],
          };
        case "rule-writer":
          return {
            agent: "rule-writer",
            rules: [createRuleNode("security", "No secrets.")],
          };
        case "doc-writer":
          return {
            agent: "doc-writer",
            docs: [{ name: "DECISIONS", content: "# Decisions" } as DocNode],
          };
        case "command-writer":
          return {
            agent: "command-writer",
            commands: [
              createCommandNode("build", "Run npm run build."),
              createCommandNode("test", "Run npm test."),
            ],
          };
        case "agent-writer":
          return {
            agent: "agent-writer",
            agents: [createAgentNode("reviewer", "Review code.")],
          };
        default:
          throw new Error(`Unknown agent: ${task.agent}`);
      }
    };

    const ir = await executePlan(plan, mockExecuteAgent, 3);

    // Verify sections from Phase A
    expect(ir.sections).toHaveLength(2);
    expect(ir.sections.some((s) => s.id === "purpose")).toBe(true);
    expect(ir.sections.some((s) => s.id === "tech-stack")).toBe(true);

    // Verify rules from Phase A
    expect(ir.rules).toHaveLength(1);
    expect(ir.rules[0].name).toBe("security");

    // Verify docs from Phase A
    expect(ir.docs).toHaveLength(1);
    expect(ir.docs[0].name).toBe("DECISIONS");

    // Verify commands from Phase B
    expect(ir.commands).toHaveLength(2);
    expect(ir.commands.some((c) => c.name === "build")).toBe(true);
    expect(ir.commands.some((c) => c.name === "test")).toBe(true);

    // Verify agents from Phase B
    expect(ir.agents).toHaveLength(1);
    expect(ir.agents[0].name).toBe("reviewer");
  });

  it("respects phase dependencies (Phase B runs after Phase A)", async () => {
    const executionOrder: string[] = [];

    const plan: CompilationPlan = {
      project_context: "Test: test project",
      phases: [
        {
          id: "phase-a",
          agents: [{ agent: "sections-writer", items: ["purpose"], max_tokens: 2048 }],
          dependsOn: [],
        },
        {
          id: "phase-b",
          agents: [{ agent: "command-writer", items: ["build"], max_tokens: 2048 }],
          dependsOn: ["phase-a"],
        },
      ],
    };

    const mockExecuteAgent: ExecuteAgentFn = async (
      task: AgentTask,
    ): Promise<AgentResult> => {
      executionOrder.push(task.agent);
      if (task.agent === "sections-writer") {
        return { agent: "sections-writer" as const, sections: [createSection("purpose", "## Purpose", "Test.", 0)] };
      }
      return { agent: "command-writer" as const, commands: [createCommandNode("build", "Build.")] };
    };

    await executePlan(plan, mockExecuteAgent, 1);

    // Phase A agent should run before Phase B agent
    expect(executionOrder.indexOf("sections-writer")).toBeLessThan(
      executionOrder.indexOf("command-writer"),
    );
  });
});

// ---------------------------------------------------------------------------
// Test 5: generateDefaultPlan produces valid plan
// ---------------------------------------------------------------------------

describe("generateDefaultPlan produces valid compilation plan", () => {
  it("creates a two-phase plan from skeleton", () => {
    const skeleton = createTestSkeleton();
    const plan = generateDefaultPlan(skeleton);

    // Should have project context
    expect(plan.project_context).toContain("Test Project");
    expect(typeof plan.project_context).toBe("string");

    // Should have exactly 2 phases
    expect(plan.phases).toHaveLength(2);
  });

  it("phase-a has sections-writer, rule-writer, and doc-writer", () => {
    const skeleton = createTestSkeleton();
    const plan = generateDefaultPlan(skeleton);

    const phaseA = plan.phases.find((p) => p.id === "phase-a");
    expect(phaseA).toBeDefined();

    const agentNames = phaseA!.agents.map((a) => a.agent);
    expect(agentNames).toContain("sections-writer");
    expect(agentNames).toContain("rule-writer");
    expect(agentNames).toContain("doc-writer");

    // Phase A has no dependencies
    expect(phaseA!.dependsOn).toEqual([]);
  });

  it("phase-b has command-writer, agent-writer, and skill-writer", () => {
    const skeleton = createTestSkeleton();
    const plan = generateDefaultPlan(skeleton);

    const phaseB = plan.phases.find((p) => p.id === "phase-b");
    expect(phaseB).toBeDefined();

    const agentNames = phaseB!.agents.map((a) => a.agent);
    expect(agentNames).toContain("command-writer");
    expect(agentNames).toContain("agent-writer");
    expect(agentNames).toContain("skill-writer");
  });

  it("phase-b depends on phase-a", () => {
    const skeleton = createTestSkeleton();
    const plan = generateDefaultPlan(skeleton);

    const phaseB = plan.phases.find((p) => p.id === "phase-b");
    expect(phaseB!.dependsOn).toEqual(["phase-a"]);
  });

  it("includes custom rules from skeleton outline", () => {
    const skeleton = createTestSkeleton({
      outline: {
        tech_stack: ["TypeScript"],
        workflow_type: "api",
        key_commands: ["build"],
        custom_rules: ["error-handling", "logging"],
        custom_agents: [],
        custom_skills: [],
      },
    });

    const plan = generateDefaultPlan(skeleton);
    const ruleWriter = plan.phases
      .flatMap((p) => p.agents)
      .find((a) => a.agent === "rule-writer");

    expect(ruleWriter).toBeDefined();
    expect(ruleWriter!.items).toContain("error-handling");
    expect(ruleWriter!.items).toContain("logging");
    // Should also include mandatory rules
    expect(ruleWriter!.items).toContain("security");
    expect(ruleWriter!.items).toContain("continuity");
  });

  it("includes key commands from skeleton in command-writer items", () => {
    const skeleton = createTestSkeleton();
    const plan = generateDefaultPlan(skeleton);

    const cmdWriter = plan.phases
      .flatMap((p) => p.agents)
      .find((a) => a.agent === "command-writer");

    expect(cmdWriter).toBeDefined();
    expect(cmdWriter!.items).toContain("build");
    expect(cmdWriter!.items).toContain("test");
    expect(cmdWriter!.items).toContain("lint");
    expect(cmdWriter!.items).toContain("deploy");
  });

  it("includes custom agents and skills from skeleton", () => {
    const skeleton = createTestSkeleton();
    const plan = generateDefaultPlan(skeleton);

    const agentWriter = plan.phases
      .flatMap((p) => p.agents)
      .find((a) => a.agent === "agent-writer");
    expect(agentWriter!.items).toContain("architect");
    expect(agentWriter!.items).toContain("tester");

    const skillWriter = plan.phases
      .flatMap((p) => p.agents)
      .find((a) => a.agent === "skill-writer");
    expect(skillWriter!.items).toContain("tdd");
  });

  it("has a string project_context describing the project", () => {
    const skeleton = createTestSkeleton();
    const plan = generateDefaultPlan(skeleton);

    expect(typeof plan.project_context).toBe("string");
    expect(plan.project_context.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Error isolation -- single agent failure
// ---------------------------------------------------------------------------

describe("error isolation in batch execution", () => {
  it("single agent failure causes entire phase to fail", async () => {
    const plan: CompilationPlan = {
      project_context: "Test: test project",
      phases: [
        {
          id: "phase-a",
          agents: [
            { agent: "sections-writer", items: ["purpose"], max_tokens: 2048 },
            { agent: "rule-writer", items: ["security"], max_tokens: 2048 },
          ],
          dependsOn: [],
        },
      ],
    };

    const mockExecuteAgent: ExecuteAgentFn = async (
      task: AgentTask,
    ): Promise<AgentResult> => {
      if (task.agent === "rule-writer") {
        throw new Error("LLM API error: model overloaded");
      }
      return {
        agent: "sections-writer" as const,
        sections: [createSection("purpose", "## Purpose", "A purpose.", 0)],
      };
    };

    // The whole executePlan should throw because a non-TruncationError
    // in a phase causes the phase (and thus the plan) to fail
    await expect(executePlan(plan, mockExecuteAgent, 3)).rejects.toThrow(
      "LLM API error: model overloaded",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 7: TruncationError retry
// ---------------------------------------------------------------------------

describe("TruncationError retry in batch execution", () => {
  it("retries agent with doubled max_tokens on TruncationError", async () => {
    let callCount = 0;
    const seenMaxTokens: number[] = [];

    const plan: CompilationPlan = {
      project_context: "Test: test project",
      phases: [
        {
          id: "phase-a",
          agents: [
            { agent: "sections-writer", items: ["purpose"], max_tokens: 2048 },
          ],
          dependsOn: [],
        },
      ],
    };

    const mockExecuteAgent: ExecuteAgentFn = async (
      task: AgentTask,
    ): Promise<AgentResult> => {
      callCount++;
      seenMaxTokens.push(task.max_tokens);

      if (callCount === 1) {
        throw new TruncationError("Truncated at 2048 tokens", { agentName: "sections-writer", tokensUsed: 2048 });
      }

      return {
        agent: "sections-writer" as const,
        sections: [createSection("purpose", "## Purpose", "Retry succeeded.", 0)],
      };
    };

    const ir = await executePlan(plan, mockExecuteAgent, 1);

    // Should have been called twice (original + retry)
    expect(callCount).toBe(2);

    // First call should have original max_tokens, second should be doubled
    expect(seenMaxTokens[0]).toBe(2048);
    expect(seenMaxTokens[1]).toBe(4096);

    // The result should contain the successful retry output
    expect(ir.sections).toHaveLength(1);
    expect(ir.sections[0].content).toBe("Retry succeeded.");
  });

  it("does not retry on non-TruncationError", async () => {
    let callCount = 0;

    const plan: CompilationPlan = {
      project_context: "Test: test project",
      phases: [
        {
          id: "phase-a",
          agents: [
            { agent: "sections-writer", items: ["purpose"], max_tokens: 2048 },
          ],
          dependsOn: [],
        },
      ],
    };

    const mockExecuteAgent: ExecuteAgentFn = async (): Promise<AgentResult> => {
      callCount++;
      throw new Error("Some other error");
    };

    await expect(executePlan(plan, mockExecuteAgent, 1)).rejects.toThrow(
      "Some other error",
    );

    // Should only be called once (no retry for non-TruncationError)
    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Additional integration: full pipeline flow
// ---------------------------------------------------------------------------

describe("full pipeline: plan -> execute -> link", () => {
  it("generates plan, executes with mock agents, and links successfully", async () => {
    // Step 1: Generate a plan from skeleton
    const skeleton = createTestSkeleton({
      outline: {
        tech_stack: ["TypeScript", "Express"],
        workflow_type: "backend-api",
        key_commands: ["build", "test", "dev"],
        custom_rules: [],
        custom_agents: ["reviewer"],
        custom_skills: [],
      },
    });
    const plan = generateDefaultPlan(skeleton);

    // Step 2: Execute plan with mock agents
    const mockExecuteAgent: ExecuteAgentFn = async (
      task: AgentTask,
    ): Promise<AgentResult> => {
      switch (task.agent) {
        case "sections-writer":
          return {
            agent: "sections-writer",
            sections: [
              createSection("preamble", "# Express API", "An API project.", 0),
              createSection("purpose", "## Purpose", "Build an Express API.", 1),
            ],
          };
        case "rule-writer":
          return {
            agent: "rule-writer",
            rules: [
              createRuleNode("security", "No secrets."),
              createRuleNode("continuity", "Track decisions."),
            ],
          };
        case "doc-writer":
          return {
            agent: "doc-writer",
            docs: [
              { name: "DECISIONS", content: "# Decisions" },
              { name: "LEARNINGS", content: "# Learnings" },
              { name: "SPRINT", content: "# Sprint" },
            ],
          };
        case "command-writer":
          return {
            agent: "command-writer",
            commands: task.items.map((item) =>
              createCommandNode(item, `Run ${item} task.`),
            ),
          };
        case "agent-writer":
          return {
            agent: "agent-writer",
            agents: task.items.map((item) =>
              createAgentNode(item, `You are the ${item} agent.`),
            ),
          };
        case "skill-writer":
          return {
            agent: "skill-writer",
            skills: task.items.map((item) => ({
              name: item,
              content: `Skill: ${item}`,
            } as SkillNode)),
          };
        default:
          throw new Error(`Unknown agent: ${task.agent}`);
      }
    };

    const ir = await executePlan(plan, mockExecuteAgent, 3);

    // Step 3: Link the IR
    const { ir: linkedIR, report } = linkHarness(ir);

    // Verify the full pipeline output
    expect(linkedIR.sections.length).toBeGreaterThan(0);
    expect(linkedIR.commands.length).toBeGreaterThan(0);
    expect(linkedIR.rules.length).toBeGreaterThan(0);
    expect(linkedIR.docs.length).toBeGreaterThan(0);

    // Linker should have injected /project:help
    expect(linkedIR.commands.some((c) => c.name === "help")).toBe(true);

    // Security and continuity rules should exist (provided by mock, not injected)
    const ruleNames = linkedIR.rules.map((r) => r.name);
    expect(ruleNames).toContain("security");
    expect(ruleNames).toContain("continuity");

    // The IR should render to a valid file map
    const fileMap = renderHarness(linkedIR);
    expect(fileMap.has("CLAUDE.md")).toBe(true);
    expect(fileMap.size).toBeGreaterThan(5);
  });
});
