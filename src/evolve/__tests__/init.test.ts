import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { parse as yamlParse } from "yaml";
import type { KairnConfig } from "../../types.js";
import type { EvolveConfig, Task, ProjectProfileSummary } from "../types.js";
import type { ProjectAnalysis } from "../../analyzer/types.js";

// Mock loadConfig before importing the module under test
const loadConfigMock = vi.fn();
vi.mock("../../config.js", () => ({
  loadConfig: loadConfigMock,
}));

// Mock callLLM
const callLLMMock = vi.fn();
vi.mock("../../llm.js", () => ({
  callLLM: callLLMMock,
}));

// Import after mocks are registered
const { createEvolveWorkspace, writeTasksFile, autoGenerateTasks, buildProjectProfile } =
  await import("../init.js");

function makeEvolveConfig(overrides: Partial<EvolveConfig> = {}): EvolveConfig {
  return {
    model: "claude-sonnet-4-6",
    proposerModel: "claude-opus-4-6",
    scorer: "pass-fail",
    maxIterations: 5,
    parallelTasks: 1,
    runsPerTask: 1,
    maxMutationsPerIteration: 3,
    pruneThreshold: 95,
    maxTaskDrop: 20,
    usePrincipal: false,
    evalSampleSize: 0,
    samplingStrategy: 'thompson',
    klLambda: 0.1,
    pbtBranches: 3,
    architectEvery: 3,
    schedule: 'explore-exploit',
    architectModel: 'claude-sonnet-4-6',
    ...overrides,
  };
}

function makeSampleTasks(): Task[] {
  return [
    {
      id: "add-health-endpoint",
      template: "add-feature",
      description: "Add a /health endpoint that returns { status: 'ok' }",
      setup: "npm install",
      expected_outcome: "GET /health returns 200 with JSON body { status: 'ok' }",
      scoring: "pass-fail",
      timeout: 300,
    },
    {
      id: "fix-cors-bug",
      template: "fix-bug",
      description: "Fix CORS headers not being set on error responses",
      setup: "npm install",
      expected_outcome: "All error responses include Access-Control-Allow-Origin header",
      scoring: "rubric",
      rubric: [
        { criterion: "CORS headers present", weight: 0.7 },
        { criterion: "Tests pass", weight: 0.3 },
      ],
      timeout: 300,
    },
  ];
}

function makeKairnConfig(overrides: Partial<KairnConfig> = {}): KairnConfig {
  return {
    provider: "anthropic",
    api_key: "test-key",
    model: "claude-sonnet-4-6",
    default_runtime: "claude-code",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeValidTasksJson(): string {
  return JSON.stringify({
    tasks: [
      {
        id: "add-health-endpoint",
        template: "add-feature",
        description: "Add a /health endpoint",
        setup: "npm install",
        expected_outcome: "GET /health returns 200",
        scoring: "pass-fail",
        timeout: 300,
      },
    ],
  });
}

describe("createEvolveWorkspace", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `kairn-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("creates .kairn-evolve directory structure", async () => {
    const config = makeEvolveConfig();

    const result = await createEvolveWorkspace(tempDir, config);

    expect(result).toBe(path.join(tempDir, ".kairn-evolve"));
    const stat = await fs.stat(path.join(result, "baseline"));
    expect(stat.isDirectory()).toBe(true);
    const tracesStat = await fs.stat(path.join(result, "traces"));
    expect(tracesStat.isDirectory()).toBe(true);
    const iterStat = await fs.stat(path.join(result, "iterations"));
    expect(iterStat.isDirectory()).toBe(true);
  });

  it("writes config.yaml with correct values using YAML serialization", async () => {
    const config = makeEvolveConfig({
      model: "test-model",
      proposerModel: "test-proposer",
      scorer: "llm-judge",
      maxIterations: 10,
      parallelTasks: 2,
    });

    const result = await createEvolveWorkspace(tempDir, config);
    const configContent = await fs.readFile(
      path.join(result, "config.yaml"),
      "utf-8",
    );

    // Parse with yaml package to verify it's valid YAML
    const parsed = yamlParse(configContent) as Record<string, unknown>;
    expect(parsed.model).toBe("test-model");
    expect(parsed.proposer_model).toBe("test-proposer");
    expect(parsed.scorer).toBe("llm-judge");
    expect(parsed.max_iterations).toBe(10);
    expect(parsed.parallel_tasks).toBe(2);
  });

  it("returns the workspace path", async () => {
    const config = makeEvolveConfig();
    const result = await createEvolveWorkspace(tempDir, config);
    expect(result).toBe(path.join(tempDir, ".kairn-evolve"));
  });
});

describe("writeTasksFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `kairn-tasks-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("writes tasks.yaml to the workspace", async () => {
    const tasks = makeSampleTasks();

    await writeTasksFile(tempDir, tasks);

    const content = await fs.readFile(path.join(tempDir, "tasks.yaml"), "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("includes a header comment", async () => {
    const tasks = makeSampleTasks();

    await writeTasksFile(tempDir, tasks);

    const content = await fs.readFile(path.join(tempDir, "tasks.yaml"), "utf-8");
    expect(content).toContain("# .kairn-evolve/tasks.yaml");
    expect(content).toContain("# Auto-generated by kairn evolve init");
  });

  it("produces valid YAML that can be parsed back", async () => {
    const tasks = makeSampleTasks();

    await writeTasksFile(tempDir, tasks);

    const content = await fs.readFile(path.join(tempDir, "tasks.yaml"), "utf-8");
    const parsed = yamlParse(content) as { tasks: Task[] };
    expect(parsed.tasks).toBeDefined();
    expect(Array.isArray(parsed.tasks)).toBe(true);
    expect(parsed.tasks).toHaveLength(2);
  });

  it("preserves all task fields in the YAML output", async () => {
    const tasks = makeSampleTasks();

    await writeTasksFile(tempDir, tasks);

    const content = await fs.readFile(path.join(tempDir, "tasks.yaml"), "utf-8");
    const parsed = yamlParse(content) as { tasks: Task[] };

    const first = parsed.tasks[0];
    expect(first.id).toBe("add-health-endpoint");
    expect(first.template).toBe("add-feature");
    expect(first.description).toBe("Add a /health endpoint that returns { status: 'ok' }");
    expect(first.setup).toBe("npm install");
    expect(first.expected_outcome).toBe("GET /health returns 200 with JSON body { status: 'ok' }");
    expect(first.scoring).toBe("pass-fail");
    expect(first.timeout).toBe(300);
  });

  it("includes rubric when present on a task", async () => {
    const tasks = makeSampleTasks();

    await writeTasksFile(tempDir, tasks);

    const content = await fs.readFile(path.join(tempDir, "tasks.yaml"), "utf-8");
    const parsed = yamlParse(content) as { tasks: Task[] };

    const second = parsed.tasks[1];
    expect(second.rubric).toBeDefined();
    expect(second.rubric).toHaveLength(2);
    expect(second.rubric![0].criterion).toBe("CORS headers present");
    expect(second.rubric![0].weight).toBe(0.7);
  });

  it("omits rubric key when not present on a task", async () => {
    const tasks = makeSampleTasks();

    await writeTasksFile(tempDir, tasks);

    const content = await fs.readFile(path.join(tempDir, "tasks.yaml"), "utf-8");
    const parsed = yamlParse(content) as { tasks: Record<string, unknown>[] };

    const first = parsed.tasks[0];
    expect("rubric" in first).toBe(false);
  });

  it("handles empty tasks array", async () => {
    await writeTasksFile(tempDir, []);

    const content = await fs.readFile(path.join(tempDir, "tasks.yaml"), "utf-8");
    const parsed = yamlParse(content) as { tasks: Task[] };
    expect(parsed.tasks).toEqual([]);
  });
});

describe("buildProjectProfile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `kairn-profile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("detects TypeScript language from package.json", async () => {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test", scripts: { build: "tsc" } }),
      "utf-8",
    );

    const profile = await buildProjectProfile(tempDir);

    expect(profile.language).toBe("typescript");
    expect(profile.languages).toEqual(["typescript"]);
  });

  it("detects framework from dependencies", async () => {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: { next: "^14.0.0" },
      }),
      "utf-8",
    );

    const profile = await buildProjectProfile(tempDir);

    expect(profile.framework).toBe("Next.js");
  });

  it("detects Express framework", async () => {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: { express: "^4.0.0" },
      }),
      "utf-8",
    );

    const profile = await buildProjectProfile(tempDir);

    expect(profile.framework).toBe("Express");
  });

  it("detects React framework", async () => {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: { react: "^18.0.0" },
      }),
      "utf-8",
    );

    const profile = await buildProjectProfile(tempDir);

    expect(profile.framework).toBe("React");
  });

  it("detects Vue framework", async () => {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: { vue: "^3.0.0" },
      }),
      "utf-8",
    );

    const profile = await buildProjectProfile(tempDir);

    expect(profile.framework).toBe("Vue");
  });

  it("detects Commander.js CLI framework", async () => {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: { commander: "^13.0.0" },
      }),
      "utf-8",
    );

    const profile = await buildProjectProfile(tempDir);

    expect(profile.framework).toBe("CLI (Commander.js)");
  });

  it("extracts scripts from package.json", async () => {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { build: "tsc", test: "vitest run" },
      }),
      "utf-8",
    );

    const profile = await buildProjectProfile(tempDir);

    expect(profile.scripts.build).toBe("tsc");
    expect(profile.scripts.test).toBe("vitest run");
  });

  it("detects Python from pyproject.toml", async () => {
    await fs.writeFile(path.join(tempDir, "pyproject.toml"), "[tool.poetry]", "utf-8");

    const profile = await buildProjectProfile(tempDir);

    expect(profile.language).toBe("python");
    expect(profile.languages).toEqual(["python"]);
  });

  it("detects Python from requirements.txt", async () => {
    await fs.writeFile(path.join(tempDir, "requirements.txt"), "flask==2.0", "utf-8");

    const profile = await buildProjectProfile(tempDir);

    expect(profile.language).toBe("python");
    expect(profile.languages).toEqual(["python"]);
  });

  it("detects key files in project root", async () => {
    await fs.writeFile(path.join(tempDir, "README.md"), "# Test", "utf-8");
    await fs.writeFile(path.join(tempDir, "Makefile"), "all:", "utf-8");
    await fs.writeFile(path.join(tempDir, "Dockerfile"), "FROM node", "utf-8");

    const profile = await buildProjectProfile(tempDir);

    expect(profile.keyFiles).toContain("README.md");
    expect(profile.keyFiles).toContain("Makefile");
    expect(profile.keyFiles).toContain("Dockerfile");
  });

  it("returns null language for empty directory", async () => {
    const profile = await buildProjectProfile(tempDir);

    expect(profile.language).toBeNull();
    expect(profile.languages).toEqual([]);
    expect(profile.framework).toBeNull();
  });

  it("returns empty scripts for empty directory", async () => {
    const profile = await buildProjectProfile(tempDir);

    expect(profile.scripts).toEqual({});
  });
});

describe("autoGenerateTasks", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `kairn-autogen-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("throws when no config is found", async () => {
    loadConfigMock.mockResolvedValueOnce(null);

    await expect(autoGenerateTasks(tempDir, "feature-development")).rejects.toThrow(
      "No config found",
    );
  });

  it("returns tasks generated by the LLM", async () => {
    loadConfigMock.mockResolvedValueOnce(makeKairnConfig());
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());

    // Create package.json so buildProjectProfile finds something
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test", scripts: { build: "tsc" } }),
      "utf-8",
    );

    const result = await autoGenerateTasks(tempDir, "feature-development");

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("add-health-endpoint");
  });

  it("reads CLAUDE.md when present", async () => {
    loadConfigMock.mockResolvedValueOnce(makeKairnConfig());
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());

    const claudeDir = path.join(tempDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(
      path.join(claudeDir, "CLAUDE.md"),
      "# My Project\nSome instructions.",
      "utf-8",
    );

    await autoGenerateTasks(tempDir, "feature-development");

    // Verify the LLM was called with the CLAUDE.md content
    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("My Project");
    expect(userMessage).toContain("Some instructions");
  });

  it("works when CLAUDE.md is absent", async () => {
    loadConfigMock.mockResolvedValueOnce(makeKairnConfig());
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());

    const result = await autoGenerateTasks(tempDir, "feature-development");

    expect(result.length).toBe(1);
  });

  it("passes the correct workflow type to template selection", async () => {
    loadConfigMock.mockResolvedValueOnce(makeKairnConfig());
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());

    await autoGenerateTasks(tempDir, "maintenance");

    // maintenance maps to fix-bug, refactor, test-writing
    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("fix-bug");
    expect(userMessage).toContain("refactor");
    expect(userMessage).toContain("test-writing");
  });

  it("propagates LLM errors", async () => {
    loadConfigMock.mockResolvedValueOnce(makeKairnConfig());
    callLLMMock.mockRejectedValueOnce(new Error("API rate limited"));

    await expect(autoGenerateTasks(tempDir, "feature-development")).rejects.toThrow(
      "API rate limited",
    );
  });
});

function makeSampleAnalysis(): ProjectAnalysis {
  return {
    purpose: "CLI tool for compiling agent environments",
    domain: "developer-tools",
    key_modules: [
      {
        name: "compiler",
        path: "src/compiler/",
        description: "Compiles natural language intent into agent harnesses",
        responsibilities: ["orchestration", "LLM dispatch", "IR generation"],
      },
      {
        name: "analyzer",
        path: "src/analyzer/",
        description: "Analyzes project structure and architecture",
        responsibilities: ["code sampling", "LLM analysis", "caching"],
      },
      {
        name: "evolve",
        path: "src/evolve/",
        description: "Evolutionary optimization loop for harness quality",
        responsibilities: ["proposal generation", "mutation application", "scoring"],
      },
    ],
    workflows: [
      {
        name: "compilation",
        description: "Transform intent into a Claude Code environment",
        trigger: "kairn describe or kairn optimize",
        steps: ["gather intent", "compile via LLM", "write harness files"],
      },
      {
        name: "evolution",
        description: "Iteratively improve harness quality via automated eval",
        trigger: "kairn evolve run",
        steps: ["baseline eval", "propose mutations", "apply and score", "select best"],
      },
    ],
    architecture_style: "modular-cli",
    deployment_model: "npm-package",
    dataflow: [
      { from: "analyzer", to: "compiler", data: "ProjectAnalysis" },
      { from: "compiler", to: "adapter", data: "HarnessIR" },
    ],
    config_keys: [
      { name: "ANTHROPIC_API_KEY", purpose: "Authentication for Claude API" },
    ],
    sampled_files: ["src/cli.ts", "src/compiler/compile.ts"],
    content_hash: "abc123",
    analyzed_at: new Date().toISOString(),
  };
}

function makeValidTasksJsonWithCategories(): string {
  return JSON.stringify({
    tasks: [
      {
        id: "convention-check-imports",
        template: "convention-adherence",
        description: "Verify all imports use .js extensions",
        setup: "npm install",
        expected_outcome: "All imports use .js extensions per CLAUDE.md conventions",
        scoring: "pass-fail",
        timeout: 180,
        category: "harness-sensitivity",
      },
      {
        id: "fix-compiler-off-by-one",
        template: "real-bug-fix",
        description: "When compiling with more than 5 sections, the compiler module skips the last section due to an off-by-one error",
        setup: "npm install && node scripts/inject-bug.js",
        expected_outcome: "All sections are compiled correctly, test suite passes",
        scoring: "pass-fail",
        timeout: 300,
        category: "substantive",
      },
      {
        id: "add-verbose-flag",
        template: "real-feature-add",
        description: "Add a --verbose flag to the analyzer module that prints debug output during code sampling",
        setup: "npm install",
        expected_outcome: "The --verbose flag is accepted and produces debug output",
        scoring: "pass-fail",
        timeout: 300,
        category: "substantive",
      },
      {
        id: "what-handles-caching",
        template: "codebase-question",
        description: "What module handles analysis caching and what file stores the cache?",
        setup: "",
        expected_outcome: "The analyzer module handles caching via src/analyzer/cache.ts, storing results in .kairn-analysis.json",
        scoring: "llm-judge",
        timeout: 180,
        category: "substantive",
      },
    ],
  });
}

describe("autoGenerateTasks with analysis context", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `kairn-analysis-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("includes project analysis context in LLM prompt when .kairn-analysis.json exists", async () => {
    loadConfigMock.mockResolvedValueOnce(makeKairnConfig());
    callLLMMock.mockResolvedValueOnce(makeValidTasksJsonWithCategories());

    // Write analysis cache file
    const analysis = makeSampleAnalysis();
    await fs.writeFile(
      path.join(tempDir, ".kairn-analysis.json"),
      JSON.stringify({ analysis, content_hash: analysis.content_hash, kairn_version: "2.14.0" }),
      "utf-8",
    );

    // Create package.json so buildProjectProfile works
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test", scripts: { build: "tsc" } }),
      "utf-8",
    );

    await autoGenerateTasks(tempDir, "feature-development");

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    // Should include key modules from analysis
    expect(userMessage).toContain("compiler");
    expect(userMessage).toContain("analyzer");
    expect(userMessage).toContain("evolve");
    // Should include purpose
    expect(userMessage).toContain("CLI tool for compiling agent environments");
  });

  it("includes workflow names from analysis in the LLM prompt", async () => {
    loadConfigMock.mockResolvedValueOnce(makeKairnConfig());
    callLLMMock.mockResolvedValueOnce(makeValidTasksJsonWithCategories());

    const analysis = makeSampleAnalysis();
    await fs.writeFile(
      path.join(tempDir, ".kairn-analysis.json"),
      JSON.stringify({ analysis, content_hash: analysis.content_hash, kairn_version: "2.14.0" }),
      "utf-8",
    );
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test", scripts: { build: "tsc" } }),
      "utf-8",
    );

    await autoGenerateTasks(tempDir, "feature-development");

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("compilation");
    expect(userMessage).toContain("evolution");
  });

  it("includes module paths from analysis for real-bug-fix task specificity", async () => {
    loadConfigMock.mockResolvedValueOnce(makeKairnConfig());
    callLLMMock.mockResolvedValueOnce(makeValidTasksJsonWithCategories());

    const analysis = makeSampleAnalysis();
    await fs.writeFile(
      path.join(tempDir, ".kairn-analysis.json"),
      JSON.stringify({ analysis, content_hash: analysis.content_hash, kairn_version: "2.14.0" }),
      "utf-8",
    );
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test", scripts: { build: "tsc" } }),
      "utf-8",
    );

    await autoGenerateTasks(tempDir, "feature-development");

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    // Should include module paths so LLM can reference actual files
    expect(userMessage).toContain("src/compiler/");
    expect(userMessage).toContain("src/analyzer/");
    expect(userMessage).toContain("src/evolve/");
  });

  it("falls back to existing behavior when .kairn-analysis.json is missing", async () => {
    loadConfigMock.mockResolvedValueOnce(makeKairnConfig());
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());

    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test", scripts: { build: "tsc" } }),
      "utf-8",
    );

    const result = await autoGenerateTasks(tempDir, "feature-development");

    expect(result.length).toBe(1);
    // Should not contain analysis-specific sections
    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).not.toContain("## Project Analysis");
  });

  it("falls back when .kairn-analysis.json contains invalid JSON", async () => {
    loadConfigMock.mockResolvedValueOnce(makeKairnConfig());
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());

    await fs.writeFile(
      path.join(tempDir, ".kairn-analysis.json"),
      "this is not json",
      "utf-8",
    );
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test", scripts: { build: "tsc" } }),
      "utf-8",
    );

    const result = await autoGenerateTasks(tempDir, "feature-development");

    // Should still work, falling back to no-analysis behavior
    expect(result.length).toBe(1);
  });

  it("includes architecture style and deployment model from analysis", async () => {
    loadConfigMock.mockResolvedValueOnce(makeKairnConfig());
    callLLMMock.mockResolvedValueOnce(makeValidTasksJsonWithCategories());

    const analysis = makeSampleAnalysis();
    await fs.writeFile(
      path.join(tempDir, ".kairn-analysis.json"),
      JSON.stringify({ analysis, content_hash: analysis.content_hash, kairn_version: "2.14.0" }),
      "utf-8",
    );
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test", scripts: { build: "tsc" } }),
      "utf-8",
    );

    await autoGenerateTasks(tempDir, "feature-development");

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("modular-cli");
    expect(userMessage).toContain("npm-package");
  });

  it("includes config keys from analysis for codebase-question specificity", async () => {
    loadConfigMock.mockResolvedValueOnce(makeKairnConfig());
    callLLMMock.mockResolvedValueOnce(makeValidTasksJsonWithCategories());

    const analysis = makeSampleAnalysis();
    await fs.writeFile(
      path.join(tempDir, ".kairn-analysis.json"),
      JSON.stringify({ analysis, content_hash: analysis.content_hash, kairn_version: "2.14.0" }),
      "utf-8",
    );
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test", scripts: { build: "tsc" } }),
      "utf-8",
    );

    await autoGenerateTasks(tempDir, "feature-development");

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("ANTHROPIC_API_KEY");
  });
});
