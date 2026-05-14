import { describe, expect, it } from "vitest";
import type { HarnessIR } from "../types.js";
import { createEmptyIR, createEmptySettings } from "../types.js";
import {
  convertHarnessIRToProgram,
  createHarnessProgramFromIR,
} from "../program.js";

function buildGeneratedClaudeIR(): HarnessIR {
  return {
    ...createEmptyIR(),
    meta: {
      name: "Kairn",
      purpose: "Compile agent harnesses",
      techStack: {
        language: "TypeScript",
        framework: "Commander.js",
        buildTool: "tsup",
        testRunner: "vitest",
        packageManager: "npm",
      },
      autonomyLevel: 3,
    },
    sections: [
      {
        id: "purpose",
        heading: "## Purpose",
        content: "Compile natural language intent into optimized harnesses.",
        order: 1,
      },
      {
        id: "verification",
        heading: "## Verification",
        content: "Run build, typecheck, and tests before handoff.",
        order: 2,
      },
    ],
    commands: [
      {
        name: "build",
        description: "Build the CLI",
        content: "Run the repository build.",
      },
      {
        name: "ship",
        description: "Prepare a release",
        content: "Run checks and prepare a release summary.",
      },
    ],
    rules: [
      {
        name: "security",
        content: "Never expose secrets.",
        paths: ["src/**"],
      },
    ],
    agents: [
      {
        name: "reviewer",
        content: "Review changes for correctness.",
        model: "sonnet",
        disallowedTools: ["Bash"],
        extraFrontmatter: { color: "blue" },
      },
    ],
    skills: [
      {
        name: "tdd",
        content: "Write failing tests first.",
      },
    ],
    docs: [
      {
        name: "DECISIONS",
        content: "# Decisions\n\nKeep design records here.",
      },
    ],
    hooks: [
      {
        name: "memory-loader",
        content: "export {};",
        type: "command",
      },
    ],
    settings: {
      ...createEmptySettings(),
      denyPatterns: ["Read(./.env)"],
      hooks: {
        PostToolUse: [
          {
            matcher: "Write|Edit",
            hooks: [
              {
                type: "prompt",
                prompt: "Consider whether docs should be updated.",
              },
            ],
          },
        ],
      },
    },
    mcpServers: [
      {
        id: "context7",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        env: { CONTEXT7_API_KEY: "env:CONTEXT7_API_KEY" },
      },
    ],
  };
}

describe("createHarnessProgramFromIR", () => {
  it("converts existing generated Claude HarnessIR into semantic categories", () => {
    const program = createHarnessProgramFromIR(buildGeneratedClaudeIR(), {
      targets: ["claude-code"],
    });

    expect(program.version).toBe(1);
    expect(program.compatibility).toEqual({ source: "HarnessIR", version: 1 });
    expect(program.targets).toEqual(["claude-code"]);

    expect(program.instructions.map((instruction) => instruction.id)).toEqual([
      "instruction:purpose",
      "instruction:verification",
      "rule:security",
    ]);
    expect(program.workflows.map((workflow) => workflow.id)).toEqual([
      "workflow:build",
      "workflow:ship",
    ]);
    expect(program.commands.map((command) => command.id)).toEqual([
      "command:build",
      "command:ship",
    ]);
    expect(program.agents[0]).toMatchObject({
      id: "agent:reviewer",
      name: "reviewer",
      model: "sonnet",
      disallowedTools: ["Bash"],
      metadata: { color: "blue" },
    });
    expect(program.skills[0]).toMatchObject({
      id: "skill:tdd",
      name: "tdd",
    });
    expect(program.tools[0]).toMatchObject({
      id: "tool:context7",
      kind: "mcp-server",
      displayName: "context7",
    });
    expect(program.permissions.rules).toEqual([
      {
        effect: "deny",
        value: "Read(./.env)",
        source: "settings",
      },
    ]);
    expect(program.hooks.map((hook) => hook.id)).toEqual([
      "hook:PostToolUse:0",
      "hook:memory-loader",
    ]);
    expect(program.memory).toMatchObject({
      mode: "persistent",
      documents: ["DECISIONS"],
      hookIds: ["hook:memory-loader"],
    });
    expect(program.verification.checks.map((check) => check.id)).toContain(
      "verification:build",
    );
    expect(program.verification.instructionIds).toEqual([
      "instruction:verification",
    ]);
    expect(program.docs[0]).toMatchObject({
      id: "doc:DECISIONS",
      title: "DECISIONS",
    });
  });

  it("keeps semantic structure free of adapter file path fields", () => {
    const program = convertHarnessIRToProgram(buildGeneratedClaudeIR());

    expect(Object.hasOwn(program.instructions[0], "path")).toBe(false);
    expect(Object.hasOwn(program.commands[0], "filePath")).toBe(false);
    expect(Object.hasOwn(program.hooks[0], "targetPath")).toBe(false);
  });

  it("accepts an empty HarnessIR for compatibility with existing saved data", () => {
    const program = createHarnessProgramFromIR(createEmptyIR());

    expect(program.compatibility.source).toBe("HarnessIR");
    expect(program.instructions).toEqual([]);
    expect(program.workflows).toEqual([]);
    expect(program.permissions.rules).toEqual([]);
    expect(program.memory.mode).toBe("none");
  });
});
