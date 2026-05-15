import { describe, expect, it } from "vitest";
import { buildCodexFileMap } from "../codex.js";
import type { EnvironmentSpec } from "../../types.js";
import type { HarnessProgram } from "../../ir/program.js";

function makeSpec(program: HarnessProgram): EnvironmentSpec {
  return {
    id: "env_test",
    name: program.meta.name,
    description: program.meta.purpose,
    intent: "Generate a Codex harness",
    created_at: "2026-05-14T00:00:00.000Z",
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
    targets: ["codex"],
    instructions: [
      {
        id: "instruction:conventions",
        title: "Conventions",
        body: "Use async/await. Run /project:test before handoff. Do not edit .claude/settings.json.",
        audience: "runtime",
        source: "claude-md",
      },
    ],
    workflows: [],
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
        model: "gpt-5.3-codex",
        disallowedTools: ["shell"],
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

function expectNoClaudeSyntax(files: Map<string, string>): void {
  for (const [filePath, content] of files) {
    expect(filePath).not.toContain(".claude");
    expect(content).not.toContain("/project:");
    expect(content).not.toContain(".claude/settings.json");
  }
}

describe("Codex adapter", () => {
  it("renders a golden Codex harness for a TypeScript CLI repo", () => {
    const files = buildCodexFileMap(makeSpec(baseProgram()));

    expect([...files.keys()]).toEqual([
      ".agents/skills/release-check/SKILL.md",
      ".codex/agents/reviewer.toml",
      ".codex/config.toml",
      ".mcp.json",
      "AGENTS.md",
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

      ## Instructions

      ### Conventions

      Use async/await. Run workflow "test" before handoff. Do not edit .codex/config.toml.

      ## Workflows

      ### build

      Compile the CLI.

      Run npm run build.

      ### test

      Run the test suite.

      Run npm test.

      ## Validation

      - Run the build workflow: Compile the CLI.
      - Run the test workflow: Run the test suite.

      ## Sandbox And Approvals

      - Default sandbox: \`workspace-write\`. Stay inside the workspace unless the user explicitly changes the Codex sandbox.
      - Default approval policy: \`on-request\`. Request approval before commands that need elevated filesystem, network, or security-sensitive access.
      - Treat destructive shell commands and secret exposure as blocked unless the repository instructions explicitly allow them.
      - Denied by policy: \`Bash(rm -rf *)\`

      ## Tool Usage

      - Prefer fast local search such as \`rg\` before broad file reads.
      - Use structured project commands and package scripts when available.
      - Keep generated artifacts scoped to this repository unless a tool configuration below says otherwise.
      - Linear via \`npx -y linear-mcp\`. Env: \`LINEAR_API_KEY\`.

      ## Subagents

      - \`reviewer\`: Review TypeScript CLI changes for regressions and missing tests.

      Custom agent definitions live in \`.codex/agents/\` for Codex subagent workflows.

      ## Skills

      - \`release-check\`

      Repository skills live in \`.agents/skills/\` and should be invoked when their descriptions match the task.

      ## Reference Docs

      - DECISIONS
      "
    `);
    expect(files.get(".codex/config.toml")).toContain('sandbox_mode = "workspace-write"');
    expect(files.get(".codex/config.toml")).toContain('approval_policy = "on-request"');
    expect(files.get(".agents/skills/release-check/SKILL.md")).toContain("name: release-check");
    expect(files.get(".codex/agents/reviewer.toml")).toContain('name = "reviewer"');
    expectNoClaudeSyntax(files);
  });

  it("renders a golden Codex harness for a monorepo", () => {
    const files = buildCodexFileMap(makeSpec(baseProgram({
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
      docs: [],
    })));

    expect([...files.keys()]).toEqual([
      ".codex/config.toml",
      "AGENTS.md",
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

      ## Instructions

      ### Monorepo Rules

      Use pnpm filters for package-scoped work. Validate affected apps before handoff.

      ## Workflows

      ### affected

      Run checks for affected packages.

      Run pnpm turbo run lint test build --filter=...[HEAD^].

      ## Validation

      - Run the affected workflow: Run checks for affected packages.

      ## Sandbox And Approvals

      - Default sandbox: \`workspace-write\`. Stay inside the workspace unless the user explicitly changes the Codex sandbox.
      - Default approval policy: \`on-request\`. Request approval before commands that need elevated filesystem, network, or security-sensitive access.
      - Treat destructive shell commands and secret exposure as blocked unless the repository instructions explicitly allow them.
      - Denied by policy: \`Bash(rm -rf *)\`

      ## Tool Usage

      - Prefer fast local search such as \`rg\` before broad file reads.
      - Use structured project commands and package scripts when available.
      - Keep generated artifacts scoped to this repository unless a tool configuration below says otherwise.
      "
    `);
    expectNoClaudeSyntax(files);
  });
});
