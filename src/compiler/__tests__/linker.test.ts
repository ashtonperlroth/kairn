import { describe, it, expect } from "vitest";
import { createEmptyIR, createCommandNode, createRuleNode, createAgentNode } from "../../ir/types.js";
import type { HarnessIR } from "../../ir/types.js";
import { linkHarness } from "../linker.js";
import type { LinkReport } from "../linker.js";

/** Build a minimal IR with the given overrides applied to createEmptyIR(). */
function buildIR(overrides: Partial<HarnessIR> = {}): HarnessIR {
  return { ...createEmptyIR(), ...overrides };
}

describe("linkHarness", () => {
  // -------------------------------------------------------------------
  // Return shape
  // -------------------------------------------------------------------

  it("returns an object with `ir` and `report` keys", () => {
    const result = linkHarness(createEmptyIR());

    expect(result).toHaveProperty("ir");
    expect(result).toHaveProperty("report");
  });

  it("report has `warnings` and `autoFixes` arrays", () => {
    const { report } = linkHarness(createEmptyIR());

    expect(Array.isArray(report.warnings)).toBe(true);
    expect(Array.isArray(report.autoFixes)).toBe(true);
  });

  // -------------------------------------------------------------------
  // Deep-clone / no mutation
  // -------------------------------------------------------------------

  it("deep-clones IR so the original input is not mutated", () => {
    const original = buildIR({
      commands: [createCommandNode("build", "Run @nonexistent agent")],
    });
    const originalContent = original.commands[0].content;

    linkHarness(original);

    // Original must be untouched
    expect(original.commands[0].content).toBe(originalContent);
  });

  it("returned IR is a different object reference from the input", () => {
    const original = createEmptyIR();
    const { ir } = linkHarness(original);

    expect(ir).not.toBe(original);
    expect(ir.commands).not.toBe(original.commands);
    expect(ir.rules).not.toBe(original.rules);
  });

  // -------------------------------------------------------------------
  // @agent-name detection in command content
  // -------------------------------------------------------------------

  it("detects @agent-name mentions in command content where agent does not exist", () => {
    const ir = buildIR({
      commands: [createCommandNode("deploy", "Ask @ghost-agent to deploy")],
      agents: [],
    });

    const { report } = linkHarness(ir);

    expect(report.warnings.some((w) => w.includes("ghost-agent"))).toBe(true);
  });

  it("auto-removes @ prefix from non-existent agent mentions in command content", () => {
    const ir = buildIR({
      commands: [createCommandNode("deploy", "Ask @ghost-agent to deploy")],
      agents: [],
    });

    const { ir: patched } = linkHarness(ir);

    expect(patched.commands[0].content).toBe("Ask ghost-agent to deploy");
    expect(patched.commands[0].content).not.toContain("@ghost-agent");
  });

  it("records auto-fix message when removing broken @agent mention", () => {
    const ir = buildIR({
      commands: [createCommandNode("deploy", "Delegate to @phantom")],
      agents: [],
    });

    const { report } = linkHarness(ir);

    expect(report.autoFixes.some((f) => f.includes("@phantom"))).toBe(true);
  });

  it("does NOT remove @existing-agent mentions from command content", () => {
    const ir = buildIR({
      commands: [createCommandNode("review", "Delegate to @reviewer for code review")],
      agents: [createAgentNode("reviewer", "Review code quality")],
    });

    const { ir: patched, report } = linkHarness(ir);

    expect(patched.commands[0].content).toContain("@reviewer");
    // No warnings about existing agents
    expect(report.warnings.some((w) => w.includes("reviewer"))).toBe(false);
  });

  it("handles multiple @mentions in one command, fixing only broken ones", () => {
    const ir = buildIR({
      commands: [
        createCommandNode("workflow", "Ask @real-agent and @fake-agent to collaborate"),
      ],
      agents: [createAgentNode("real-agent", "Real agent")],
    });

    const { ir: patched, report } = linkHarness(ir);

    expect(patched.commands[0].content).toContain("@real-agent");
    expect(patched.commands[0].content).not.toContain("@fake-agent");
    expect(patched.commands[0].content).toContain("fake-agent");
    expect(report.warnings.some((w) => w.includes("fake-agent"))).toBe(true);
    expect(report.warnings.some((w) => w.includes("real-agent"))).toBe(false);
  });

  // -------------------------------------------------------------------
  // /project:command-name detection in agent content
  // -------------------------------------------------------------------

  it("detects /project:command-name references in agent content where command does not exist", () => {
    const ir = buildIR({
      agents: [createAgentNode("builder", "Use /project:nonexistent-cmd to build")],
      commands: [],
    });

    const { report } = linkHarness(ir);

    expect(report.warnings.some((w) => w.includes("nonexistent-cmd"))).toBe(true);
  });

  it("does NOT warn about /project:command-name when the command exists", () => {
    const ir = buildIR({
      agents: [createAgentNode("builder", "Use /project:build to compile")],
      commands: [createCommandNode("build", "npm run build")],
    });

    const { report } = linkHarness(ir);

    expect(report.warnings.some((w) => w.includes("build"))).toBe(false);
  });

  // -------------------------------------------------------------------
  // Default help command injection
  // -------------------------------------------------------------------

  it("injects a default help command if none exists in ir.commands", () => {
    const ir = buildIR({ commands: [] });

    const { ir: patched, report } = linkHarness(ir);

    const helpCmd = patched.commands.find((c) => c.name === "help");
    expect(helpCmd).toBeDefined();
    expect(report.autoFixes.some((f) => f.includes("help"))).toBe(true);
  });

  it("does not inject help command if one already exists", () => {
    const ir = buildIR({
      commands: [createCommandNode("help", "Custom help content", "Custom help")],
    });

    const { ir: patched, report } = linkHarness(ir);

    const helpCommands = patched.commands.filter((c) => c.name === "help");
    expect(helpCommands).toHaveLength(1);
    expect(helpCommands[0].content).toBe("Custom help content");
    expect(report.autoFixes.some((f) => f.includes("help"))).toBe(false);
  });

  // -------------------------------------------------------------------
  // Security rule injection
  // -------------------------------------------------------------------

  it("injects security rule if missing from ir.rules", () => {
    const ir = buildIR({ rules: [] });

    const { ir: patched, report } = linkHarness(ir);

    const securityRule = patched.rules.find((r) => r.name === "security");
    expect(securityRule).toBeDefined();
    expect(securityRule!.content).toContain("NEVER");
    expect(report.autoFixes.some((f) => f.includes("security"))).toBe(true);
  });

  it("does not duplicate security rule if already present", () => {
    const ir = buildIR({
      rules: [createRuleNode("security", "Custom security rules")],
    });

    const { ir: patched, report } = linkHarness(ir);

    const securityRules = patched.rules.filter((r) => r.name === "security");
    expect(securityRules).toHaveLength(1);
    expect(securityRules[0].content).toBe("Custom security rules");
    expect(report.autoFixes.some((f) => f.includes("security"))).toBe(false);
  });

  // -------------------------------------------------------------------
  // Continuity rule injection
  // -------------------------------------------------------------------

  it("injects continuity rule if missing from ir.rules", () => {
    const ir = buildIR({ rules: [] });

    const { ir: patched, report } = linkHarness(ir);

    const continuityRule = patched.rules.find((r) => r.name === "continuity");
    expect(continuityRule).toBeDefined();
    expect(continuityRule!.content).toContain("Continuity");
    expect(report.autoFixes.some((f) => f.includes("continuity"))).toBe(true);
  });

  it("does not duplicate continuity rule if already present", () => {
    const ir = buildIR({
      rules: [createRuleNode("continuity", "Custom continuity rules")],
    });

    const { ir: patched, report } = linkHarness(ir);

    const continuityRules = patched.rules.filter((r) => r.name === "continuity");
    expect(continuityRules).toHaveLength(1);
    expect(continuityRules[0].content).toBe("Custom continuity rules");
    expect(report.autoFixes.some((f) => f.includes("continuity"))).toBe(false);
  });

  // -------------------------------------------------------------------
  // Clean IR — no warnings, no fixes
  // -------------------------------------------------------------------

  it("returns IR unchanged (no warnings, no fixes) when all references are valid", () => {
    const ir = buildIR({
      commands: [
        createCommandNode("help", "Show help", "Help"),
        createCommandNode("build", "Ask @reviewer to review", "Build"),
      ],
      agents: [createAgentNode("reviewer", "Review code")],
      rules: [
        createRuleNode("security", "Security rules"),
        createRuleNode("continuity", "Continuity rules"),
      ],
    });

    const { report } = linkHarness(ir);

    expect(report.warnings).toHaveLength(0);
    expect(report.autoFixes).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------

  it("handles commands with no @mentions gracefully", () => {
    const ir = buildIR({
      commands: [createCommandNode("simple", "Just a plain command")],
    });

    const { ir: patched } = linkHarness(ir);

    expect(patched.commands.find((c) => c.name === "simple")?.content).toBe(
      "Just a plain command",
    );
  });

  it("handles agents with no /project: references gracefully", () => {
    const ir = buildIR({
      agents: [createAgentNode("simple", "Just a plain agent")],
    });

    const { report } = linkHarness(ir);

    // Only auto-fixes for injected defaults, no agent-related warnings
    expect(report.warnings).toHaveLength(0);
  });

  it("handles empty IR with only default injections", () => {
    const ir = createEmptyIR();

    const { ir: patched, report } = linkHarness(ir);

    // Should inject help command + security rule + continuity rule
    expect(patched.commands.some((c) => c.name === "help")).toBe(true);
    expect(patched.rules.some((r) => r.name === "security")).toBe(true);
    expect(patched.rules.some((r) => r.name === "continuity")).toBe(true);
    expect(report.autoFixes).toHaveLength(3);
    expect(report.warnings).toHaveLength(0);
  });
});
