import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildOpenCodeFileMap, writeOpenCodeEnvironment } from "../opencode.js";
import type { HarnessProgram } from "../../ir/program.js";
import type { EnvironmentSpec } from "../../types.js";

function makeSpec(program: HarnessProgram): EnvironmentSpec {
  return {
    id: "env_test",
    name: program.meta.name,
    description: program.meta.purpose,
    intent: "Generate an OpenCode harness",
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
    targets: ["opencode"],
    instructions: [
      {
        id: "instruction:conventions",
        title: "Conventions",
        body: "Use async/await. Run /project:test before handoff. Do not edit .claude/settings.json.",
        audience: "runtime",
        source: "claude-md",
      },
    ],
    workflows: [
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
        id: "agent:code-reviewer",
        name: "Code Reviewer",
        instructions: "Review TypeScript CLI changes for regressions and missing tests.",
        model: "anthropic/claude-sonnet-4-5",
        disallowedTools: ["edit"],
        metadata: {},
      },
    ],
    skills: [
      {
        id: "skill:release-check",
        name: "Release Check",
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

async function readWrittenFiles(root: string, relativePaths: string[]): Promise<Map<string, string>> {
  const entries = await Promise.all(
    relativePaths.map(async (relativePath) => [
      relativePath,
      await fs.readFile(path.join(root, relativePath), "utf-8"),
    ] as const),
  );
  return new Map(entries);
}

describe("OpenCode adapter", () => {
  it("renders opencode.json plus project-local agents and skills", () => {
    const files = buildOpenCodeFileMap(makeSpec(baseProgram()));

    expect([...files.keys()]).toEqual([
      ".opencode/agents/build.md",
      ".opencode/agents/code-reviewer.md",
      ".opencode/agents/plan.md",
      ".opencode/agents/readonly.md",
      ".opencode/agents/review.md",
      ".opencode/instructions.md",
      ".opencode/skills/release-check/SKILL.md",
      "opencode.json",
    ]);

    const config = JSON.parse(files.get("opencode.json") ?? "{}") as {
      $schema: string;
      default_agent: string;
      instructions: string[];
      permission: Record<string, unknown>;
      agent: Record<string, { mode: string; permission: Record<string, unknown> }>;
      mcp: Record<string, unknown>;
    };

    expect(config.$schema).toBe("https://opencode.ai/config.json");
    expect(config.default_agent).toBe("plan");
    expect(config.instructions).toEqual([".opencode/instructions.md"]);
    expect(config.permission["external_directory"]).toBe("deny");
    expect(config.agent["plan"]?.mode).toBe("primary");
    expect(config.agent["build"]?.mode).toBe("primary");
    expect(config.agent["review"]?.mode).toBe("subagent");
    expect(config.agent["readonly"]?.mode).toBe("subagent");
    expect(config.agent["plan"]?.permission["edit"]).toBe("deny");
    expect(config.agent["build"]?.permission["edit"]).toBe("ask");
    expect(config.agent["review"]?.permission["edit"]).toBe("deny");
    expect(config.agent["readonly"]?.permission["bash"]).toBe("deny");
    expect(config.agent["code-reviewer"]?.permission["edit"]).toBe("deny");
    expect(config.mcp["linear"]).toEqual({
      type: "local",
      command: ["npx", "-y", "linear-mcp"],
      environment: { LINEAR_API_KEY: "${LINEAR_API_KEY}" },
      enabled: true,
    });

    expect(files.get(".opencode/skills/release-check/SKILL.md")).toContain("name: release-check");
    expect(files.get(".opencode/agents/code-reviewer.md")).toContain("mode: subagent");
    expect(files.get(".opencode/instructions.md")).toContain('Run workflow "test" before handoff');
    expect(files.get(".opencode/instructions.md")).not.toContain("/project:");
    expect(files.get(".opencode/instructions.md")).not.toContain(".claude/settings.json");
  });

  it("produces deterministic rendered and written file output", async () => {
    const spec = makeSpec(baseProgram());
    const first = buildOpenCodeFileMap(spec);
    const second = buildOpenCodeFileMap(spec);
    expect([...first.entries()]).toEqual([...second.entries()]);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kairn-opencode-"));
    const written = await writeOpenCodeEnvironment(spec, [], tempDir);
    expect(written).toEqual([...first.keys()]);
    await expect(readWrittenFiles(tempDir, written)).resolves.toEqual(first);
  });
});
