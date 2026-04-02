import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import {
  renderHarness,
  renderHarnessToDir,
  renderClaudeMd,
  renderSettings,
  renderMcpConfig,
  renderRuleWithFrontmatter,
  renderAgentWithFrontmatter,
} from "../renderer.js";
import {
  createEmptyIR,
  createSection,
  createEmptySettings,
} from "../types.js";
import type {
  HarnessMeta,
  HarnessIR,
  SettingsIR,
  McpServerNode,
  RuleNode,
  AgentNode,
  Section,
} from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = path.join(
    "/tmp",
    `kairn-renderer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// renderClaudeMd
// ---------------------------------------------------------------------------

describe("renderClaudeMd", () => {
  it("renders meta name as # title and sections in order", () => {
    const meta: HarnessMeta = {
      name: "My Project",
      purpose: "Build things",
      techStack: { language: "TypeScript" },
      autonomyLevel: 2,
    };
    const sections: Section[] = [
      createSection("preamble", "# My Project", "Preamble text.", 0),
      createSection("purpose", "## Purpose", "Build great things.", 1),
      createSection("tech-stack", "## Tech Stack", "- TypeScript", 2),
    ];

    const result = renderClaudeMd(meta, sections);

    expect(result).toContain("# My Project");
    expect(result).toContain("## Purpose");
    expect(result).toContain("Build great things.");
    expect(result).toContain("## Tech Stack");
    expect(result).toContain("- TypeScript");
    // Ends with trailing newline
    expect(result.endsWith("\n")).toBe(true);
  });

  it("renders sections sorted by order regardless of input order", () => {
    const meta: HarnessMeta = {
      name: "Test",
      purpose: "",
      techStack: { language: "" },
      autonomyLevel: 2,
    };
    const sections: Section[] = [
      createSection("commands", "## Commands", "npm run build", 3),
      createSection("preamble", "# Test", "", 0),
      createSection("purpose", "## Purpose", "Do stuff.", 1),
    ];

    const result = renderClaudeMd(meta, sections);

    const preambleIdx = result.indexOf("# Test");
    const purposeIdx = result.indexOf("## Purpose");
    const commandsIdx = result.indexOf("## Commands");

    expect(preambleIdx).toBeLessThan(purposeIdx);
    expect(purposeIdx).toBeLessThan(commandsIdx);
  });

  it("omits title line when meta name is empty", () => {
    const meta: HarnessMeta = {
      name: "",
      purpose: "",
      techStack: { language: "" },
      autonomyLevel: 2,
    };
    const sections: Section[] = [
      createSection("preamble", "", "Just some content.", 0),
      createSection("purpose", "## Purpose", "A purpose.", 1),
    ];

    const result = renderClaudeMd(meta, sections);

    // Should not start with "# "
    expect(result.trimStart().startsWith("# ")).toBe(false);
    expect(result).toContain("Just some content.");
    expect(result).toContain("## Purpose");
  });

  it("handles sections with empty content", () => {
    const meta: HarnessMeta = {
      name: "Proj",
      purpose: "",
      techStack: { language: "" },
      autonomyLevel: 2,
    };
    const sections: Section[] = [
      createSection("preamble", "# Proj", "", 0),
      createSection("purpose", "## Purpose", "", 1),
    ];

    const result = renderClaudeMd(meta, sections);
    expect(result).toContain("# Proj");
    expect(result).toContain("## Purpose");
    expect(result.endsWith("\n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderSettings
// ---------------------------------------------------------------------------

describe("renderSettings", () => {
  it("renders valid JSON with hooks structure", () => {
    const settings: SettingsIR = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo check" }],
          },
        ],
      },
      raw: {},
    };

    const result = renderSettings(settings);
    const parsed = JSON.parse(result);

    expect(parsed.hooks).toBeDefined();
    expect(parsed.hooks.PreToolUse).toHaveLength(1);
    expect(parsed.hooks.PreToolUse[0].matcher).toBe("Bash");
    expect(result.endsWith("\n")).toBe(true);
  });

  it("includes permissions.deny when denyPatterns is set", () => {
    const settings: SettingsIR = {
      hooks: {},
      denyPatterns: ["Bash(rm -rf *)", "Bash(curl|sh)"],
      raw: {},
    };

    const result = renderSettings(settings);
    const parsed = JSON.parse(result);

    expect(parsed.permissions).toBeDefined();
    expect(parsed.permissions.deny).toEqual([
      "Bash(rm -rf *)",
      "Bash(curl|sh)",
    ]);
  });

  it("preserves raw fields in the output", () => {
    const settings: SettingsIR = {
      hooks: {},
      raw: {
        customField: "preserved",
        anotherField: 42,
      },
    };

    const result = renderSettings(settings);
    const parsed = JSON.parse(result);

    expect(parsed.customField).toBe("preserved");
    expect(parsed.anotherField).toBe(42);
  });

  it("includes statusLine when set", () => {
    const settings: SettingsIR = {
      statusLine: { command: "git branch --show-current" },
      hooks: {},
      raw: {},
    };

    const result = renderSettings(settings);
    const parsed = JSON.parse(result);

    expect(parsed.statusLine).toEqual({ command: "git branch --show-current" });
  });

  it("renders multiple hook event types", () => {
    const settings: SettingsIR = {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] },
        ],
        PostToolUse: [
          { matcher: "Edit", hooks: [{ type: "command", command: "echo post" }] },
        ],
        PostCompact: [
          { matcher: "", hooks: [{ type: "prompt", prompt: "Re-read CLAUDE.md" }] },
        ],
      },
      raw: {},
    };

    const result = renderSettings(settings);
    const parsed = JSON.parse(result);

    expect(parsed.hooks.PreToolUse).toHaveLength(1);
    expect(parsed.hooks.PostToolUse).toHaveLength(1);
    expect(parsed.hooks.PostCompact).toHaveLength(1);
  });

  it("does not include empty hook arrays in output", () => {
    const settings: SettingsIR = {
      hooks: {},
      raw: {},
    };

    const result = renderSettings(settings);
    const parsed = JSON.parse(result);

    // hooks key should not appear if empty
    expect(parsed.hooks).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// renderMcpConfig
// ---------------------------------------------------------------------------

describe("renderMcpConfig", () => {
  it("renders valid .mcp.json with servers", () => {
    const servers: McpServerNode[] = [
      {
        id: "context7",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
      },
      {
        id: "github",
        command: "npx",
        args: ["-y", "@github/mcp-server"],
        env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
      },
    ];

    const result = renderMcpConfig(servers);
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers["context7"]).toBeDefined();
    expect(parsed.mcpServers["context7"].command).toBe("npx");
    expect(parsed.mcpServers["context7"].args).toEqual([
      "-y",
      "@upstash/context7-mcp",
    ]);
    expect(parsed.mcpServers["context7"].env).toBeUndefined();

    expect(parsed.mcpServers["github"]).toBeDefined();
    expect(parsed.mcpServers["github"].env).toEqual({
      GITHUB_TOKEN: "${GITHUB_TOKEN}",
    });

    expect(result.endsWith("\n")).toBe(true);
  });

  it("returns empty string when no servers", () => {
    const result = renderMcpConfig([]);
    expect(result).toBe("");
  });
});

// ---------------------------------------------------------------------------
// renderRuleWithFrontmatter
// ---------------------------------------------------------------------------

describe("renderRuleWithFrontmatter", () => {
  it("prepends YAML frontmatter when paths are present", () => {
    const rule: RuleNode = {
      name: "security",
      content: "Never log secrets.",
      paths: ["src/auth/**", "src/secrets/**"],
    };

    const result = renderRuleWithFrontmatter(rule);

    expect(result).toContain("---");
    expect(result).toContain("paths:");
    expect(result).toContain("  - src/auth/**");
    expect(result).toContain("  - src/secrets/**");
    expect(result).toContain("Never log secrets.");

    // Body should be separated from frontmatter by a blank line
    const parts = result.split("---");
    // parts: ["", yamlBlock, rest]
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  it("returns just content when no paths are present", () => {
    const rule: RuleNode = {
      name: "general",
      content: "Always be consistent.",
    };

    const result = renderRuleWithFrontmatter(rule);

    expect(result).not.toContain("---");
    expect(result).toBe("Always be consistent.");
  });

  it("returns just content when paths array is empty", () => {
    const rule: RuleNode = {
      name: "general",
      content: "Always be consistent.",
      paths: [],
    };

    const result = renderRuleWithFrontmatter(rule);

    expect(result).not.toContain("---");
    expect(result).toBe("Always be consistent.");
  });
});

// ---------------------------------------------------------------------------
// renderAgentWithFrontmatter
// ---------------------------------------------------------------------------

describe("renderAgentWithFrontmatter", () => {
  it("prepends YAML frontmatter with model when present", () => {
    const agent: AgentNode = {
      name: "architect",
      content: "You are an architect agent.",
      model: "opus",
    };

    const result = renderAgentWithFrontmatter(agent);

    expect(result).toContain("---");
    expect(result).toContain("model: opus");
    expect(result).toContain("You are an architect agent.");
  });

  it("prepends YAML frontmatter with both model and disallowedTools", () => {
    const agent: AgentNode = {
      name: "reader",
      content: "Read-only agent.",
      model: "sonnet",
      disallowedTools: ["Write", "Edit", "Bash"],
    };

    const result = renderAgentWithFrontmatter(agent);

    expect(result).toContain("---");
    expect(result).toContain("model: sonnet");
    expect(result).toContain("disallowedTools:");
    expect(result).toContain("  - Write");
    expect(result).toContain("  - Edit");
    expect(result).toContain("  - Bash");
    expect(result).toContain("Read-only agent.");
  });

  it("returns just content when neither model nor disallowedTools present", () => {
    const agent: AgentNode = {
      name: "basic",
      content: "A basic agent.",
    };

    const result = renderAgentWithFrontmatter(agent);

    expect(result).not.toContain("---");
    expect(result).toBe("A basic agent.");
  });

  it("prepends frontmatter with only disallowedTools when model is absent", () => {
    const agent: AgentNode = {
      name: "restricted",
      content: "Limited agent.",
      disallowedTools: ["Bash"],
    };

    const result = renderAgentWithFrontmatter(agent);

    expect(result).toContain("---");
    expect(result).toContain("disallowedTools:");
    expect(result).toContain("  - Bash");
    expect(result).not.toContain("model:");
    expect(result).toContain("Limited agent.");
  });
});

// ---------------------------------------------------------------------------
// renderHarness
// ---------------------------------------------------------------------------

describe("renderHarness", () => {
  it("returns empty map for empty IR", () => {
    const ir = createEmptyIR();
    const result = renderHarness(ir);

    expect(result.size).toBe(0);
  });

  it("produces CLAUDE.md when sections exist", () => {
    const ir = createEmptyIR();
    ir.meta.name = "Test Project";
    ir.sections = [
      createSection("preamble", "# Test Project", "Preamble.", 0),
      createSection("purpose", "## Purpose", "Build things.", 1),
    ];

    const result = renderHarness(ir);

    expect(result.has("CLAUDE.md")).toBe(true);
    const claudeMd = result.get("CLAUDE.md")!;
    expect(claudeMd).toContain("# Test Project");
    expect(claudeMd).toContain("## Purpose");
  });

  it("maps commands to commands/{name}.md", () => {
    const ir = createEmptyIR();
    ir.commands = [
      { name: "build", description: "Build the project", content: "npm run build" },
      { name: "test", description: "Run tests", content: "npm test" },
    ];

    const result = renderHarness(ir);

    expect(result.has("commands/build.md")).toBe(true);
    expect(result.get("commands/build.md")).toBe("npm run build");
    expect(result.has("commands/test.md")).toBe(true);
    expect(result.get("commands/test.md")).toBe("npm test");
  });

  it("maps rules to rules/{name}.md with frontmatter", () => {
    const ir = createEmptyIR();
    ir.rules = [
      { name: "security", content: "Never log secrets.", paths: ["src/auth/**"] },
    ];

    const result = renderHarness(ir);

    expect(result.has("rules/security.md")).toBe(true);
    const ruleContent = result.get("rules/security.md")!;
    expect(ruleContent).toContain("---");
    expect(ruleContent).toContain("paths:");
    expect(ruleContent).toContain("Never log secrets.");
  });

  it("maps agents to agents/{name}.md with frontmatter", () => {
    const ir = createEmptyIR();
    ir.agents = [
      { name: "architect", content: "You are an architect.", model: "opus" },
    ];

    const result = renderHarness(ir);

    expect(result.has("agents/architect.md")).toBe(true);
    const agentContent = result.get("agents/architect.md")!;
    expect(agentContent).toContain("model: opus");
    expect(agentContent).toContain("You are an architect.");
  });

  it("maps skills to skills/{name}.md", () => {
    const ir = createEmptyIR();
    ir.skills = [{ name: "tdd", content: "TDD workflow instructions." }];

    const result = renderHarness(ir);

    expect(result.has("skills/tdd.md")).toBe(true);
    expect(result.get("skills/tdd.md")).toBe("TDD workflow instructions.");
  });

  it("maps docs to docs/{name}.md", () => {
    const ir = createEmptyIR();
    ir.docs = [{ name: "DECISIONS", content: "# Decisions\n\n- Decision 1." }];

    const result = renderHarness(ir);

    expect(result.has("docs/DECISIONS.md")).toBe(true);
    expect(result.get("docs/DECISIONS.md")).toContain("Decision 1.");
  });

  it("maps hooks to hooks/{name}.mjs", () => {
    const ir = createEmptyIR();
    ir.hooks = [
      { name: "lint", content: "export default function lint() {}", type: "command" },
    ];

    const result = renderHarness(ir);

    expect(result.has("hooks/lint.mjs")).toBe(true);
    expect(result.get("hooks/lint.mjs")).toContain("export default function lint()");
  });

  it("includes settings.json only when settings has content", () => {
    const ir = createEmptyIR();
    ir.settings = {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo check" }] },
        ],
      },
      raw: {},
    };

    const result = renderHarness(ir);

    expect(result.has("settings.json")).toBe(true);
    const settingsContent = result.get("settings.json")!;
    const parsed = JSON.parse(settingsContent);
    expect(parsed.hooks.PreToolUse).toBeDefined();
  });

  it("does not include settings.json for empty default settings", () => {
    const ir = createEmptyIR();
    // Default settings from createEmptyIR: { hooks: {}, raw: {} }

    const result = renderHarness(ir);

    expect(result.has("settings.json")).toBe(false);
  });

  it("includes .mcp.json when servers exist", () => {
    const ir = createEmptyIR();
    ir.mcpServers = [
      { id: "test-server", command: "node", args: ["server.js"] },
    ];

    const result = renderHarness(ir);

    expect(result.has(".mcp.json")).toBe(true);
    const mcpContent = result.get(".mcp.json")!;
    const parsed = JSON.parse(mcpContent);
    expect(parsed.mcpServers["test-server"]).toBeDefined();
  });

  it("does not include .mcp.json when no servers exist", () => {
    const ir = createEmptyIR();
    const result = renderHarness(ir);
    expect(result.has(".mcp.json")).toBe(false);
  });

  it("is deterministic: same IR produces same output twice", () => {
    const ir = createEmptyIR();
    ir.meta.name = "Deterministic";
    ir.sections = [
      createSection("preamble", "# Deterministic", "Preamble.", 0),
      createSection("purpose", "## Purpose", "Be consistent.", 1),
    ];
    ir.commands = [
      { name: "build", description: "Build", content: "npm run build" },
    ];
    ir.rules = [
      { name: "security", content: "No secrets.", paths: ["src/**"] },
    ];
    ir.agents = [
      { name: "reviewer", content: "Review code.", model: "sonnet" },
    ];

    const result1 = renderHarness(ir);
    const result2 = renderHarness(ir);

    expect(result1.size).toBe(result2.size);
    for (const [key, value] of result1) {
      expect(result2.get(key)).toBe(value);
    }
  });
});

// ---------------------------------------------------------------------------
// renderHarnessToDir
// ---------------------------------------------------------------------------

describe("renderHarnessToDir", () => {
  it("writes files to disk correctly", async () => {
    const ir = createEmptyIR();
    ir.meta.name = "Disk Test";
    ir.sections = [
      createSection("preamble", "# Disk Test", "Preamble.", 0),
      createSection("purpose", "## Purpose", "Write to disk.", 1),
    ];
    ir.commands = [
      { name: "build", description: "Build", content: "npm run build" },
    ];

    const written = await renderHarnessToDir(ir, tempDir);

    expect(written.length).toBeGreaterThan(0);

    // Verify CLAUDE.md was written
    const claudeMdPath = path.join(tempDir, "CLAUDE.md");
    const claudeMd = await fs.readFile(claudeMdPath, "utf-8");
    expect(claudeMd).toContain("# Disk Test");
    expect(claudeMd).toContain("## Purpose");

    // Verify command file
    const buildPath = path.join(tempDir, "commands", "build.md");
    const buildContent = await fs.readFile(buildPath, "utf-8");
    expect(buildContent).toBe("npm run build");
  });

  it("creates subdirectories as needed", async () => {
    const ir = createEmptyIR();
    ir.commands = [
      { name: "deploy", description: "Deploy", content: "Deploy script" },
    ];
    ir.rules = [
      { name: "safety", content: "Be safe." },
    ];
    ir.agents = [
      { name: "coder", content: "Write code." },
    ];
    ir.skills = [
      { name: "debug", content: "Debug skill." },
    ];
    ir.docs = [
      { name: "API", content: "API docs." },
    ];
    ir.hooks = [
      { name: "pre-commit", content: "console.log('hook');", type: "command" },
    ];

    const written = await renderHarnessToDir(ir, tempDir);

    // Verify directories were created
    const commandsStat = await fs.stat(path.join(tempDir, "commands"));
    expect(commandsStat.isDirectory()).toBe(true);

    const rulesStat = await fs.stat(path.join(tempDir, "rules"));
    expect(rulesStat.isDirectory()).toBe(true);

    const agentsStat = await fs.stat(path.join(tempDir, "agents"));
    expect(agentsStat.isDirectory()).toBe(true);

    const skillsStat = await fs.stat(path.join(tempDir, "skills"));
    expect(skillsStat.isDirectory()).toBe(true);

    const docsStat = await fs.stat(path.join(tempDir, "docs"));
    expect(docsStat.isDirectory()).toBe(true);

    const hooksStat = await fs.stat(path.join(tempDir, "hooks"));
    expect(hooksStat.isDirectory()).toBe(true);

    // Verify file count matches
    expect(written).toHaveLength(6);
  });

  it("returns array of written file paths", async () => {
    const ir = createEmptyIR();
    ir.meta.name = "PathTest";
    ir.sections = [
      createSection("preamble", "# PathTest", "", 0),
    ];
    ir.mcpServers = [
      { id: "server1", command: "node", args: ["s.js"] },
    ];

    const written = await renderHarnessToDir(ir, tempDir);

    expect(written).toContain("CLAUDE.md");
    expect(written).toContain(".mcp.json");
  });

  it("returns empty array for empty IR", async () => {
    const ir = createEmptyIR();
    const written = await renderHarnessToDir(ir, tempDir);
    expect(written).toEqual([]);
  });
});
