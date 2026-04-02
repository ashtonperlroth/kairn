import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import {
  parseHarness,
  parseClaudeMd,
  parseYamlFrontmatter,
  parseMcpConfig,
  parseSettings,
} from "../parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = path.join(
    "/tmp",
    `kairn-parser-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

/** Write a file inside the temp harness dir, creating parent dirs as needed. */
async function writeHarnessFile(
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = path.join(tempDir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// parseYamlFrontmatter
// ---------------------------------------------------------------------------

describe("parseYamlFrontmatter", () => {
  it("extracts frontmatter and body from content with --- delimiters", () => {
    const content = `---
name: architect
model: opus
---

Body content here.`;
    const result = parseYamlFrontmatter(content);
    expect(result.frontmatter).toEqual({ name: "architect", model: "opus" });
    expect(result.body.trim()).toBe("Body content here.");
  });

  it("returns empty frontmatter and full body when no frontmatter present", () => {
    const content = "Just plain markdown\nwith multiple lines.";
    const result = parseYamlFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(content);
  });

  it("parses paths as an array from YAML list items", () => {
    const content = `---
paths:
  - "src/compiler/**"
  - "src/adapter/**"
---

Rule body.`;
    const result = parseYamlFrontmatter(content);
    expect(result.frontmatter["paths"]).toEqual([
      "src/compiler/**",
      "src/adapter/**",
    ]);
    expect(result.body.trim()).toBe("Rule body.");
  });

  it("handles frontmatter with no body after it", () => {
    const content = `---
key: value
---`;
    const result = parseYamlFrontmatter(content);
    expect(result.frontmatter).toEqual({ key: "value" });
    expect(result.body).toBe("");
  });

  it("handles values with colons in them", () => {
    const content = `---
description: This is a test: with colons
---

Body.`;
    const result = parseYamlFrontmatter(content);
    expect(result.frontmatter["description"]).toBe(
      "This is a test: with colons",
    );
  });

  it("strips quotes from values", () => {
    const content = `---
name: "my-rule"
---

Body.`;
    const result = parseYamlFrontmatter(content);
    expect(result.frontmatter["name"]).toBe("my-rule");
  });
});

// ---------------------------------------------------------------------------
// parseClaudeMd
// ---------------------------------------------------------------------------

describe("parseClaudeMd", () => {
  it("parses minimal CLAUDE.md with just a title", () => {
    const content = "# My Project\n\nSome description.";
    const result = parseClaudeMd(content);

    expect(result.meta.name).toBe("My Project");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].id).toBe("preamble");
    expect(result.sections[0].content).toContain("Some description.");
  });

  it("extracts meta.name from the first # heading", () => {
    const content = "# Kairn CLI Tool\n\nDescription here.";
    const result = parseClaudeMd(content);
    expect(result.meta.name).toBe("Kairn CLI Tool");
  });

  it("parses a full CLAUDE.md with multiple sections", () => {
    const content = `# Test Project

Preamble text.

## Purpose
This project does things.

## Tech Stack
- TypeScript (strict, ESM), tsup bundler
- Commander.js (CLI)

## Commands
\`\`\`bash
npm run build
npm test
\`\`\`

## Architecture
Standard layout.

## Conventions
- Use async/await
- chalk colors

## Verification
Run npm test.

## Known Gotchas
- ESM only

## Debugging
Paste raw errors.

## Git Workflow
Use conventional commits.`;

    const result = parseClaudeMd(content);

    expect(result.meta.name).toBe("Test Project");
    expect(result.meta.purpose).toBe("This project does things.");

    // Check section IDs
    const sectionIds = result.sections.map((s) => s.id);
    expect(sectionIds).toContain("preamble");
    expect(sectionIds).toContain("purpose");
    expect(sectionIds).toContain("tech-stack");
    expect(sectionIds).toContain("commands");
    expect(sectionIds).toContain("architecture");
    expect(sectionIds).toContain("conventions");
    expect(sectionIds).toContain("verification");
    expect(sectionIds).toContain("gotchas");
    expect(sectionIds).toContain("debugging");
    expect(sectionIds).toContain("git");
  });

  it("assigns custom-* IDs to unrecognized sections", () => {
    const content = `# Project

## My Special Section
Custom content.

## Another Weird One
More custom content.`;

    const result = parseClaudeMd(content);
    const sectionIds = result.sections.map((s) => s.id);
    expect(sectionIds).toContain("custom-my-special-section");
    expect(sectionIds).toContain("custom-another-weird-one");
  });

  it("extracts techStack from tech-stack section bullets", () => {
    const content = `# Project

## Tech Stack
- TypeScript (strict, ESM), tsup bundler
- Commander.js (CLI), @inquirer/prompts (interactive)
- vitest for testing
- npm as package manager`;

    const result = parseClaudeMd(content);
    expect(result.meta.techStack?.language).toBe("TypeScript");
    expect(result.meta.techStack?.buildTool).toBe("tsup");
    expect(result.meta.techStack?.testRunner).toBe("vitest");
  });

  it("assigns incrementing order to sections", () => {
    const content = `# Project

Preamble.

## Purpose
Purpose.

## Architecture
Arch.`;

    const result = parseClaudeMd(content);
    expect(result.sections[0].order).toBe(0);
    expect(result.sections[1].order).toBe(1);
    expect(result.sections[2].order).toBe(2);
  });

  it("handles CLAUDE.md with no title line gracefully", () => {
    const content = "Just some content without a heading.";
    const result = parseClaudeMd(content);
    expect(result.meta.name).toBe("");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].id).toBe("preamble");
  });

  it("extracts purpose from the first paragraph of the purpose section", () => {
    const content = `# Project

## Purpose
First paragraph of purpose.

Second paragraph is ignored for meta.`;

    const result = parseClaudeMd(content);
    expect(result.meta.purpose).toBe("First paragraph of purpose.");
  });

  it("maps heading variants to known section IDs", () => {
    const content = `# X

## About
About section.

## Technology
Tech section.

## Key Commands
Commands section.`;

    const result = parseClaudeMd(content);
    const sectionIds = result.sections.map((s) => s.id);
    expect(sectionIds).toContain("purpose");
    expect(sectionIds).toContain("tech-stack");
    expect(sectionIds).toContain("commands");
  });
});

// ---------------------------------------------------------------------------
// parseSettings
// ---------------------------------------------------------------------------

describe("parseSettings", () => {
  it("extracts hooks by event type", () => {
    const settingsJson = JSON.stringify({
      permissions: {
        allow: ["Bash(npm run *)"],
        deny: ["Bash(rm -rf *)"],
      },
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo test" }],
          },
        ],
        PostToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [{ type: "command", command: "npx eslint --fix" }],
          },
        ],
      },
      statusLine: {
        command: "git branch --show-current",
      },
    });

    const result = parseSettings(settingsJson);
    expect(result.hooks.PreToolUse).toHaveLength(1);
    expect(result.hooks.PreToolUse![0].matcher).toBe("Bash");
    expect(result.hooks.PostToolUse).toHaveLength(1);
    expect(result.denyPatterns).toEqual(["Bash(rm -rf *)"]);
    expect(result.statusLine?.command).toBe("git branch --show-current");
  });

  it("preserves raw settings data", () => {
    const settingsJson = JSON.stringify({
      permissions: { allow: [], deny: [] },
      hooks: {},
      customField: "preserved",
    });

    const result = parseSettings(settingsJson);
    expect(result.raw["customField"]).toBe("preserved");
  });

  it("handles settings with no hooks or permissions", () => {
    const settingsJson = JSON.stringify({});
    const result = parseSettings(settingsJson);
    expect(result.hooks).toEqual({});
    expect(result.denyPatterns).toBeUndefined();
  });

  it("handles PostCompact hook type", () => {
    const settingsJson = JSON.stringify({
      hooks: {
        PostCompact: [
          {
            matcher: "",
            hooks: [{ type: "prompt", prompt: "Re-read CLAUDE.md" }],
          },
        ],
      },
    });

    const result = parseSettings(settingsJson);
    expect(result.hooks.PostCompact).toHaveLength(1);
    expect(result.hooks.PostCompact![0].hooks[0].type).toBe("prompt");
  });
});

// ---------------------------------------------------------------------------
// parseMcpConfig
// ---------------------------------------------------------------------------

describe("parseMcpConfig", () => {
  it("parses .mcp.json into McpServerNode array", () => {
    const mcpJson = JSON.stringify({
      mcpServers: {
        "context7": {
          command: "npx",
          args: ["-y", "@upstash/context7-mcp"],
          env: {},
        },
        "github": {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
        },
      },
    });

    const result = parseMcpConfig(mcpJson);
    expect(result).toHaveLength(2);

    const ctx7 = result.find((n) => n.id === "context7");
    expect(ctx7).toBeDefined();
    expect(ctx7!.command).toBe("npx");
    expect(ctx7!.args).toEqual(["-y", "@upstash/context7-mcp"]);

    const gh = result.find((n) => n.id === "github");
    expect(gh).toBeDefined();
    expect(gh!.env).toEqual({ GITHUB_TOKEN: "${GITHUB_TOKEN}" });
  });

  it("returns empty array for empty mcpServers", () => {
    const result = parseMcpConfig(JSON.stringify({ mcpServers: {} }));
    expect(result).toEqual([]);
  });

  it("returns empty array for missing mcpServers key", () => {
    const result = parseMcpConfig(JSON.stringify({}));
    expect(result).toEqual([]);
  });

  it("handles servers with no env field", () => {
    const mcpJson = JSON.stringify({
      mcpServers: {
        "my-server": {
          command: "node",
          args: ["server.js"],
        },
      },
    });

    const result = parseMcpConfig(mcpJson);
    expect(result).toHaveLength(1);
    expect(result[0].env).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseHarness (integration)
// ---------------------------------------------------------------------------

describe("parseHarness", () => {
  it("returns empty IR for an empty directory", async () => {
    const ir = await parseHarness(tempDir);
    expect(ir.meta.name).toBe("");
    expect(ir.sections).toEqual([]);
    expect(ir.commands).toEqual([]);
    expect(ir.rules).toEqual([]);
    expect(ir.agents).toEqual([]);
    expect(ir.skills).toEqual([]);
    expect(ir.docs).toEqual([]);
    expect(ir.hooks).toEqual([]);
    expect(ir.mcpServers).toEqual([]);
  });

  it("parses CLAUDE.md into meta and sections", async () => {
    await writeHarnessFile(
      "CLAUDE.md",
      `# Test Project

A test project.

## Purpose
Build great things.

## Tech Stack
- TypeScript (strict), tsup bundler
- vitest for testing`,
    );

    const ir = await parseHarness(tempDir);
    expect(ir.meta.name).toBe("Test Project");
    expect(ir.meta.purpose).toBe("Build great things.");
    expect(ir.meta.techStack.language).toBe("TypeScript");
    expect(ir.meta.techStack.buildTool).toBe("tsup");
    expect(ir.meta.techStack.testRunner).toBe("vitest");
    expect(ir.sections.length).toBeGreaterThanOrEqual(3);
  });

  it("parses command files from commands/ directory", async () => {
    await writeHarnessFile(
      "commands/build.md",
      "Run the build pipeline.\n\n```bash\nnpm run build\n```",
    );
    await writeHarnessFile(
      "commands/test.md",
      "Run tests.\n\n```bash\nnpm test\n```",
    );

    const ir = await parseHarness(tempDir);
    expect(ir.commands).toHaveLength(2);

    const buildCmd = ir.commands.find((c) => c.name === "build");
    expect(buildCmd).toBeDefined();
    expect(buildCmd!.description).toBe("Run the build pipeline.");
    expect(buildCmd!.content).toContain("npm run build");

    const testCmd = ir.commands.find((c) => c.name === "test");
    expect(testCmd).toBeDefined();
  });

  it("parses rule files with YAML frontmatter", async () => {
    await writeHarnessFile(
      "rules/security.md",
      `---
paths:
  - "src/auth/**"
  - "src/secrets/**"
---

# Security Rules

Never log secrets.`,
    );

    const ir = await parseHarness(tempDir);
    expect(ir.rules).toHaveLength(1);
    expect(ir.rules[0].name).toBe("security");
    expect(ir.rules[0].paths).toEqual(["src/auth/**", "src/secrets/**"]);
    expect(ir.rules[0].content).toContain("Never log secrets.");
  });

  it("parses agent files with model frontmatter", async () => {
    await writeHarnessFile(
      "agents/architect.md",
      `---
name: architect
model: opus
---

You are an architect agent.`,
    );

    const ir = await parseHarness(tempDir);
    expect(ir.agents).toHaveLength(1);
    expect(ir.agents[0].name).toBe("architect");
    expect(ir.agents[0].model).toBe("opus");
    expect(ir.agents[0].content).toContain("You are an architect agent.");
  });

  it("parses agent files with disallowedTools", async () => {
    await writeHarnessFile(
      "agents/reader.md",
      `---
name: reader
model: sonnet
disallowedTools:
  - Write
  - Edit
  - Bash
---

Read-only agent.`,
    );

    const ir = await parseHarness(tempDir);
    expect(ir.agents[0].disallowedTools).toEqual(["Write", "Edit", "Bash"]);
  });

  it("parses skill files", async () => {
    await writeHarnessFile(
      "skills/tdd/skill.md",
      "# TDD Skill\n\nTest-driven development workflow.",
    );

    const ir = await parseHarness(tempDir);
    expect(ir.skills).toHaveLength(1);
    expect(ir.skills[0].name).toBe("tdd");
    expect(ir.skills[0].content).toContain("TDD Skill");
  });

  it("parses doc files", async () => {
    await writeHarnessFile(
      "docs/DECISIONS.md",
      "# Decisions\n\n- Decision 1.",
    );

    const ir = await parseHarness(tempDir);
    expect(ir.docs).toHaveLength(1);
    expect(ir.docs[0].name).toBe("DECISIONS");
    expect(ir.docs[0].content).toContain("Decision 1.");
  });

  it("parses hook files", async () => {
    await writeHarnessFile(
      "hooks/lint.mjs",
      'export default function lint() { return "ok"; }',
    );

    const ir = await parseHarness(tempDir);
    expect(ir.hooks).toHaveLength(1);
    expect(ir.hooks[0].name).toBe("lint");
    expect(ir.hooks[0].type).toBe("command");
  });

  it("parses settings.json", async () => {
    await writeHarnessFile(
      "settings.json",
      JSON.stringify({
        permissions: {
          allow: ["Read"],
          deny: ["Bash(rm -rf *)"],
        },
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "echo check" }],
            },
          ],
        },
      }),
    );

    const ir = await parseHarness(tempDir);
    expect(ir.settings.denyPatterns).toEqual(["Bash(rm -rf *)"]);
    expect(ir.settings.hooks.PreToolUse).toHaveLength(1);
  });

  it("parses .mcp.json from parent directory", async () => {
    // Write .mcp.json in the parent of tempDir
    const parentDir = path.dirname(tempDir);
    const mcpPath = path.join(parentDir, ".mcp.json");
    await fs.writeFile(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      }),
    );

    try {
      const ir = await parseHarness(tempDir);
      expect(ir.mcpServers).toHaveLength(1);
      expect(ir.mcpServers[0].id).toBe("test-server");
    } finally {
      await fs.rm(mcpPath, { force: true });
    }
  });

  it("parses .mcp.json from within the harness directory itself", async () => {
    await writeHarnessFile(
      ".mcp.json",
      JSON.stringify({
        mcpServers: {
          "inner-server": {
            command: "npx",
            args: ["-y", "inner-mcp"],
          },
        },
      }),
    );

    const ir = await parseHarness(tempDir);
    const innerServer = ir.mcpServers.find((s) => s.id === "inner-server");
    expect(innerServer).toBeDefined();
  });

  it("handles directory with only CLAUDE.md and nothing else", async () => {
    await writeHarnessFile(
      "CLAUDE.md",
      "# Minimal Project\n\nJust a CLAUDE.md.",
    );

    const ir = await parseHarness(tempDir);
    expect(ir.meta.name).toBe("Minimal Project");
    expect(ir.commands).toEqual([]);
    expect(ir.rules).toEqual([]);
    expect(ir.agents).toEqual([]);
    expect(ir.skills).toEqual([]);
    expect(ir.docs).toEqual([]);
    expect(ir.hooks).toEqual([]);
  });

  it("handles non-existent directory gracefully", async () => {
    const nonExistent = path.join(tempDir, "does-not-exist");
    const ir = await parseHarness(nonExistent);
    expect(ir.meta.name).toBe("");
    expect(ir.sections).toEqual([]);
  });

  it("ignores non-.md files in commands directory", async () => {
    await writeHarnessFile("commands/valid.md", "A valid command.");
    await writeHarnessFile("commands/.DS_Store", "junk");
    await writeHarnessFile("commands/backup.bak", "backup");

    const ir = await parseHarness(tempDir);
    expect(ir.commands).toHaveLength(1);
    expect(ir.commands[0].name).toBe("valid");
  });

  it("uses filename as agent name when frontmatter has no name", async () => {
    await writeHarnessFile(
      "agents/debugger.md",
      "You are a debugging agent.",
    );

    const ir = await parseHarness(tempDir);
    expect(ir.agents).toHaveLength(1);
    expect(ir.agents[0].name).toBe("debugger");
  });

  it("parses rules without frontmatter", async () => {
    await writeHarnessFile(
      "rules/simple.md",
      "# Simple Rule\n\nAlways be consistent.",
    );

    const ir = await parseHarness(tempDir);
    expect(ir.rules).toHaveLength(1);
    expect(ir.rules[0].name).toBe("simple");
    expect(ir.rules[0].paths).toBeUndefined();
    expect(ir.rules[0].content).toContain("Always be consistent.");
  });

  it("handles skills that are directories with a skill.md inside", async () => {
    await writeHarnessFile(
      "skills/compiler-design/skill.md",
      "# Compiler Design\n\nA skill for compiler work.",
    );

    const ir = await parseHarness(tempDir);
    expect(ir.skills).toHaveLength(1);
    expect(ir.skills[0].name).toBe("compiler-design");
  });
});
