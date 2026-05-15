import { describe, expect, it } from "vitest";
import { buildGenericFileMap } from "../generic.js";
import type { HarnessProgram } from "../../ir/program.js";
import type { EnvironmentSpec } from "../../types.js";

function makeSpec(program: HarnessProgram): EnvironmentSpec {
  return {
    id: "env_test",
    name: program.meta.name,
    description: program.meta.purpose,
    intent: "Generate a portable harness",
    created_at: "2026-05-15T00:00:00.000Z",
    autonomy_level: program.meta.autonomyLevel,
    tools: [],
    program,
    harness: {
      claude_md: "",
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
  };
}

function baseProgram(overrides: Partial<HarnessProgram> = {}): HarnessProgram {
  return {
    version: 1,
    meta: {
      name: "Inventory CLI",
      purpose: "Maintain the inventory TypeScript CLI.",
      techStack: {
        language: "TypeScript",
        buildTool: "tsup",
        testRunner: "vitest",
        packageManager: "npm",
      },
      autonomyLevel: 3,
    },
    repo: {
      summary: "A strict TypeScript command line application.",
      signals: {},
    },
    targets: ["generic"],
    instructions: [
      {
        id: "instruction:conventions",
        title: "Conventions",
        body: "Use async/await. Run /project:test before handoff. Do not edit .claude/settings.json or .codex/config.toml.",
        audience: "runtime",
        source: "claude-md",
      },
      {
        id: "instruction:security",
        title: "Security",
        body: "Never log secrets.",
        audience: "agent",
        source: "rule",
      },
    ],
    workflows: [
      {
        id: "workflow:build",
        name: "build",
        summary: "Compile the CLI.",
        commandIds: ["command:build"],
        instructionIds: ["instruction:conventions"],
        verificationIds: ["verification:build"],
      },
      {
        id: "workflow:test",
        name: "test",
        summary: "Run the test suite.",
        commandIds: ["command:test"],
        instructionIds: ["instruction:conventions"],
        verificationIds: ["verification:test"],
      },
    ],
    commands: [
      {
        id: "command:build",
        name: "build",
        summary: "Compile the CLI.",
        body: "Run npm run build.",
        source: "command",
      },
      {
        id: "command:test",
        name: "test",
        summary: "Run the test suite.",
        body: "Run npm test.",
        source: "command",
      },
    ],
    agents: [
      {
        id: "agent:reviewer",
        name: "reviewer",
        instructions: "Review TypeScript CLI changes for regressions and missing tests.",
        disallowedTools: [],
        metadata: {},
      },
    ],
    skills: [
      {
        id: "skill:release-check",
        name: "release-check",
        instructions: "Check package metadata, build output, and changelog consistency.",
      },
    ],
    tools: [
      {
        id: "tool:linear",
        kind: "mcp-server",
        displayName: "Linear",
        command: "npx",
        args: ["-y", "linear-mcp"],
        env: { LINEAR_API_KEY: "${LINEAR_API_KEY}" },
        source: "mcp",
      },
    ],
    permissions: {
      rules: [
        { effect: "deny", value: "Bash(rm -rf *)", source: "settings" },
      ],
    },
    hooks: [],
    memory: {
      mode: "documented",
      documents: ["DECISIONS"],
      instructions: [],
      hookIds: [],
    },
    verification: {
      checks: [
        { id: "verification:build", name: "build", commandId: "command:build", source: "command" },
        { id: "verification:test", name: "test", commandId: "command:test", source: "command" },
      ],
      instructionIds: [],
    },
    docs: [
      {
        id: "doc:DECISIONS",
        title: "DECISIONS",
        body: "Record architectural decisions here.",
      },
    ],
    compatibility: { source: "HarnessIR", version: 1 },
    ...overrides,
  };
}

function expectNoTargetSpecificSyntax(files: Map<string, string>): void {
  for (const [filePath, content] of files) {
    expect(filePath).not.toContain(".claude");
    expect(filePath).not.toContain(".codex");
    expect(content).not.toContain("/project:");
    expect(content).not.toContain(".claude");
    expect(content).not.toContain(".codex");
    expect(content).not.toContain("Claude Code");
    expect(content).not.toContain("Codex");
  }
}

describe("Generic adapter", () => {
  it("renders a deterministic portable harness for a TypeScript CLI repo", () => {
    const files = buildGenericFileMap(makeSpec(baseProgram()));

    expect([...files.keys()]).toEqual([
      "AGENTS.md",
      "harness/commands/build.md",
      "harness/commands/test.md",
      "harness/docs/decisions.md",
      "harness/roles-and-skills.md",
      "harness/rules.md",
      "harness/tools.md",
      "harness/workflows.md",
    ]);
    expect(files.get("AGENTS.md")).toMatchInlineSnapshot(`
      "# Inventory CLI Agent Guide

      ## Purpose

      Maintain the inventory TypeScript CLI.

      ## Stack

      - Language: TypeScript
      - Build tool: tsup
      - Test runner: vitest
      - Package manager: npm

      ## Operating Rules

      ### Conventions

      Use async/await. Run workflow "test" before handoff. Do not edit runtime configuration or runtime configuration.

      ### Security

      Never log secrets.

      ## Workflows

      - build: Compile the CLI. Command references: build.
      - test: Run the test suite. Command references: test.

      ## Validation

      - build: use the build command reference.
      - test: use the test command reference.

      ## Harness References

      - Command references: \`harness/commands/\`
      - Workflow guide: \`harness/workflows.md\`
      - Rule reference: \`harness/rules.md\`
      - Tool guidance: \`harness/tools.md\`
      - Project documents: \`harness/docs/\`
      "
    `);
    expect(files.get("harness/commands/build.md")).toMatchInlineSnapshot(`
      "# build

      ## Summary

      Compile the CLI.

      ## Procedure

      Run npm run build.
      "
    `);
    expect(files.get("harness/tools.md")).toMatchInlineSnapshot(`
      "# Tool Guidance

      - Prefer repository-local commands and documented package scripts.
      - Keep generated files inside the project unless a tool description explicitly scopes output elsewhere.
      - Do not expose secret values; refer only to required environment variable names.
      - Linear; command: npx; args: -y linear-mcp; env: LINEAR_API_KEY
      "
    `);
    expect(files.get("harness/rules.md")).toContain("Never log secrets.");
    expect(files.get("harness/docs/decisions.md")).toBe("Record architectural decisions here.\n");
    expectNoTargetSpecificSyntax(files);
  });

  it("renders a deterministic portable harness for a monorepo", () => {
    const files = buildGenericFileMap(makeSpec(baseProgram({
      meta: {
        name: "Acme Monorepo",
        purpose: "Coordinate apps and packages in a TypeScript monorepo.",
        techStack: {
          language: "TypeScript",
          framework: "Next.js",
          buildTool: "turborepo",
          testRunner: "vitest",
          packageManager: "pnpm",
        },
        autonomyLevel: 2,
      },
      instructions: [
        {
          id: "instruction:monorepo",
          title: "Monorepo Rules",
          body: "Use pnpm filters for package-scoped work. Validate affected apps before handoff.",
          audience: "runtime",
          source: "claude-md",
        },
      ],
      workflows: [
        {
          id: "workflow:affected",
          name: "affected",
          summary: "Run checks for affected packages.",
          commandIds: ["command:affected"],
          instructionIds: ["instruction:monorepo"],
          verificationIds: ["verification:affected"],
        },
      ],
      commands: [
        {
          id: "command:affected",
          name: "affected",
          summary: "Run checks for affected packages.",
          body: "Run pnpm turbo run lint test build --filter=...[HEAD^].",
          source: "command",
        },
      ],
      verification: {
        checks: [
          {
            id: "verification:affected",
            name: "affected",
            commandId: "command:affected",
            source: "command",
          },
        ],
        instructionIds: [],
      },
      agents: [],
      skills: [],
      tools: [],
      permissions: { rules: [] },
      docs: [],
    })));

    expect([...files.keys()]).toEqual([
      "AGENTS.md",
      "harness/commands/affected.md",
      "harness/workflows.md",
    ]);
    expect(files.get("AGENTS.md")).toMatchInlineSnapshot(`
      "# Acme Monorepo Agent Guide

      ## Purpose

      Coordinate apps and packages in a TypeScript monorepo.

      ## Stack

      - Language: TypeScript
      - Framework: Next.js
      - Build tool: turborepo
      - Test runner: vitest
      - Package manager: pnpm

      ## Operating Rules

      ### Monorepo Rules

      Use pnpm filters for package-scoped work. Validate affected apps before handoff.

      ## Workflows

      - affected: Run checks for affected packages. Command references: affected.

      ## Validation

      - affected: use the affected command reference.

      ## Harness References

      - Command references: \`harness/commands/\`
      - Workflow guide: \`harness/workflows.md\`
      "
    `);
    expect(files.get("harness/workflows.md")).toContain("harness/commands/affected.md");
    expectNoTargetSpecificSyntax(files);
  });
});
