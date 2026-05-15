import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildForgeCodeFileMap, writeForgeCodeEnvironment } from "../forgecode.js";
import type { HarnessProgram } from "../../ir/program.js";
import type { EnvironmentSpec } from "../../types.js";

function makeSpec(program: HarnessProgram): EnvironmentSpec {
  return {
    id: "env_test",
    name: program.meta.name,
    description: program.meta.purpose,
    intent: "Generate a ForgeCode harness",
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
    targets: ["forgecode"],
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
        disallowedTools: ["shell"],
        metadata: {},
      },
      {
        id: "agent:feature-builder",
        name: "Feature Builder",
        instructions: "Implement scoped TypeScript CLI features and run validation.",
        disallowedTools: [],
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

describe("ForgeCode adapter", () => {
  it("renders AGENTS.md, forge.yaml, and project-local agent frontmatter", () => {
    const files = buildForgeCodeFileMap(makeSpec(baseProgram()));

    expect([...files.keys()]).toEqual([
      ".forge/TOOLING.md",
      ".forge/agents/code-reviewer.md",
      ".forge/agents/feature-builder.md",
      "AGENTS.md",
      "forge.yaml",
    ]);

    expect(files.get("AGENTS.md")).toContain("# Inventory CLI ForgeCode Guide");
    expect(files.get("AGENTS.md")).toContain('Run the "test" workflow before handoff');
    expect(files.get("AGENTS.md")).not.toContain("/project:");
    expect(files.get("AGENTS.md")).not.toContain(".claude/settings.json");

    const forgeYaml = files.get("forge.yaml") ?? "";
    expect(forgeYaml).toContain("custom_rules: |-");
    expect(forgeYaml).toContain("tool_supported: true");
    expect(forgeYaml).toContain("commands:");
    expect(forgeYaml).toContain('name: "build"');
    expect(forgeYaml).toContain("prompt: |-");

    const reviewAgent = files.get(".forge/agents/code-reviewer.md") ?? "";
    expect(reviewAgent).toContain('id: "code-reviewer"');
    expect(reviewAgent).toContain('title: "Code Reviewer"');
    expect(reviewAgent).toContain('description: "Review TypeScript CLI changes for regressions and missing tests."');
    expect(reviewAgent).toContain("model: \"anthropic/claude-sonnet-4-5\"");
    expect(reviewAgent).toContain("tools:\n  - read\n  - search\n---");
    expect(reviewAgent).not.toContain("  - shell");

    const buildAgent = files.get(".forge/agents/feature-builder.md") ?? "";
    expect(buildAgent).toContain("tools:\n  - read\n  - search\n  - write\n  - patch\n  - shell\n---");
  });

  it("produces deterministic rendered and written file output", async () => {
    const spec = makeSpec(baseProgram());
    const first = buildForgeCodeFileMap(spec);
    const second = buildForgeCodeFileMap(spec);
    expect([...first.entries()]).toEqual([...second.entries()]);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kairn-forgecode-"));
    const written = await writeForgeCodeEnvironment(spec, [], tempDir);
    expect(written).toEqual([...first.keys()]);
    await expect(readWrittenFiles(tempDir, written)).resolves.toEqual(first);
  });
});
