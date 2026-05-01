import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";
import type { Task, TasksFile, Score, TaskResult } from "../../evolve/types.js";

// ---- Mocks ----

// Mock ora (spinner)
const spinnerMock = {
  start: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
};
vi.mock("ora", () => ({
  default: vi.fn(() => spinnerMock),
}));

// Mock @inquirer/prompts
const confirmMock = vi.fn();
const selectMock = vi.fn();
vi.mock("@inquirer/prompts", () => ({
  confirm: confirmMock,
  select: selectMock,
}));

// Mock autoGenerateTasks, createEvolveWorkspace, writeTasksFile, buildProjectProfile
const autoGenerateTasksMock = vi.fn();
const createEvolveWorkspaceMock = vi.fn();
const writeTasksFileMock = vi.fn();
const buildProjectProfileMock = vi.fn();
vi.mock("../../evolve/init.js", () => ({
  autoGenerateTasks: autoGenerateTasksMock,
  createEvolveWorkspace: createEvolveWorkspaceMock,
  writeTasksFile: writeTasksFileMock,
  buildProjectProfile: buildProjectProfileMock,
}));

// Mock templates
const generateTasksFromTemplatesMock = vi.fn();
vi.mock("../../evolve/templates.js", () => ({
  EVAL_TEMPLATES: {
    "add-feature": {
      id: "add-feature",
      name: "Add Feature",
      description: "Can the agent add a new capability?",
      bestFor: ["feature-development"],
    },
    "fix-bug": {
      id: "fix-bug",
      name: "Fix Bug",
      description: "Can the agent diagnose and fix a problem?",
      bestFor: ["maintenance"],
    },
    "refactor": {
      id: "refactor",
      name: "Refactor",
      description: "Can the agent restructure code?",
      bestFor: ["maintenance"],
    },
    "test-writing": {
      id: "test-writing",
      name: "Test Writing",
      description: "Can the agent write tests?",
      bestFor: ["tdd"],
    },
    "config-change": {
      id: "config-change",
      name: "Config Change",
      description: "Can the agent update configuration?",
      bestFor: ["devops"],
    },
    "documentation": {
      id: "documentation",
      name: "Documentation",
      description: "Can the agent write and update docs?",
      bestFor: ["content"],
    },
  },
  selectTemplatesForWorkflow: vi.fn().mockReturnValue(["add-feature", "test-writing"]),
  generateTasksFromTemplates: generateTasksFromTemplatesMock,
}));

// Mock snapshotBaseline
vi.mock("../../evolve/baseline.js", () => ({
  snapshotBaseline: vi.fn(),
}));

// Mock runner
const runTaskMock = vi.fn();
vi.mock("../../evolve/runner.js", () => ({
  runTask: runTaskMock,
}));

// Mock evolve loop
const evolveMock = vi.fn();
vi.mock("../../evolve/loop.js", () => ({
  evolve: evolveMock,
}));

// Mock loadConfig
const loadConfigMock = vi.fn();
vi.mock("../../config.js", () => ({
  loadConfig: loadConfigMock,
}));

// Import the command under test (after mocks)
const { evolveCommand } = await import("../evolve.js");

// ---- Helpers ----

function makeSampleTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "add-health-endpoint",
    template: "add-feature",
    description: "Add a /health endpoint",
    setup: "npm install",
    expected_outcome: "GET /health returns 200",
    scoring: "pass-fail",
    timeout: 300,
    ...overrides,
  };
}

function makeSampleTasksYaml(tasks: Task[]): string {
  return yamlStringify({ tasks });
}

function makeSampleScore(overrides: Partial<Score> = {}): Score {
  return {
    pass: true,
    score: 100,
    details: "All verification commands passed",
    ...overrides,
  };
}

function makeSampleTaskResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    taskId: "add-health-endpoint",
    score: makeSampleScore(),
    traceDir: "/tmp/trace-dir",
    ...overrides,
  };
}

// ---- Tests ----

describe("evolve command YAML parsing", () => {
  it("parses tasks.yaml with yaml package instead of regex", () => {
    const tasks = [
      makeSampleTask({ id: "task-1" }),
      makeSampleTask({ id: "task-2", template: "fix-bug" }),
    ];
    const yamlContent = makeSampleTasksYaml(tasks);
    const parsed = yamlParse(yamlContent) as TasksFile;

    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.tasks[0].id).toBe("task-1");
    expect(parsed.tasks[1].id).toBe("task-2");
  });

  it("preserves full task objects including all fields", () => {
    const task = makeSampleTask({
      id: "add-health-endpoint",
      template: "add-feature",
      description: "Add a /health endpoint that returns { status: 'ok' }",
      setup: "npm install",
      expected_outcome: "GET /health returns 200 with JSON body",
      scoring: "rubric",
      rubric: [
        { criterion: "Endpoint exists", weight: 0.6 },
        { criterion: "Returns JSON", weight: 0.4 },
      ],
      timeout: 300,
    });
    const yamlContent = makeSampleTasksYaml([task]);
    const parsed = yamlParse(yamlContent) as TasksFile;

    const parsedTask = parsed.tasks[0];
    expect(parsedTask.id).toBe("add-health-endpoint");
    expect(parsedTask.template).toBe("add-feature");
    expect(parsedTask.description).toContain("health endpoint");
    expect(parsedTask.setup).toBe("npm install");
    expect(parsedTask.expected_outcome).toContain("200");
    expect(parsedTask.scoring).toBe("rubric");
    expect(parsedTask.rubric).toHaveLength(2);
    expect(parsedTask.timeout).toBe(300);
  });

  it("handles empty tasks array", () => {
    const yamlContent = yamlStringify({ tasks: [] });
    const parsed = yamlParse(yamlContent) as TasksFile;
    expect(parsed.tasks).toEqual([]);
  });

  it("handles tasks with array expected_outcome", () => {
    const task = makeSampleTask({
      expected_outcome: ["File created", "Tests pass", "No errors"],
    });
    const yamlContent = makeSampleTasksYaml([task]);
    const parsed = yamlParse(yamlContent) as TasksFile;

    expect(Array.isArray(parsed.tasks[0].expected_outcome)).toBe(true);
    expect(parsed.tasks[0].expected_outcome).toHaveLength(3);
  });
});

describe("evolve command structure", () => {
  it("has init subcommand", () => {
    const initCmd = evolveCommand.commands.find(
      (c) => c.name() === "init",
    );
    expect(initCmd).toBeDefined();
    expect(initCmd?.description()).toContain("auto-generated");
  });

  it("has baseline subcommand", () => {
    const baselineCmd = evolveCommand.commands.find(
      (c) => c.name() === "baseline",
    );
    expect(baselineCmd).toBeDefined();
  });

  it("has run subcommand", () => {
    const runCmd = evolveCommand.commands.find(
      (c) => c.name() === "run",
    );
    expect(runCmd).toBeDefined();
  });

  it("run subcommand has --task option", () => {
    const runCmd = evolveCommand.commands.find(
      (c) => c.name() === "run",
    );
    expect(runCmd).toBeDefined();
    const taskOption = runCmd?.options.find((o) => o.long === "--task");
    expect(taskOption).toBeDefined();
  });

  it("init subcommand has --workflow option", () => {
    const initCmd = evolveCommand.commands.find(
      (c) => c.name() === "init",
    );
    expect(initCmd).toBeDefined();
    const workflowOption = initCmd?.options.find((o) => o.long === "--workflow");
    expect(workflowOption).toBeDefined();
  });
});

describe("evolve command imports", () => {
  it("does not export parseTaskIds (removed in rewrite)", async () => {
    // parseTaskIds was the old regex-based parser; it should be removed
    // The module should use yaml.parse() instead
    const mod = await import("../evolve.js");
    const moduleExports = Object.keys(mod);
    // Exports should include evolveCommand and loadEvolveConfigFromWorkspace
    expect(moduleExports).toContain("evolveCommand");
    expect(moduleExports).toContain("loadEvolveConfigFromWorkspace");
    expect(moduleExports).not.toContain("parseTaskIds");
  });
});

describe("evolve init action", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const rawTmpDir = path.join(
      os.tmpdir(),
      `kairn-evolve-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(rawTmpDir, { recursive: true });
    // Resolve symlinks (macOS /var -> /private/var) so process.cwd() matches
    tempDir = await fs.realpath(rawTmpDir);
    await fs.mkdir(path.join(tempDir, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, ".claude", "CLAUDE.md"),
      "# Test Project",
      "utf-8",
    );

    originalCwd = process.cwd();
    process.chdir(tempDir);

    originalExit = process.exit;
    process.exit = vi.fn() as never;

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.clearAllMocks();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    consoleLogSpy.mockRestore();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("calls autoGenerateTasks during init", async () => {
    const tasks = [makeSampleTask()];
    autoGenerateTasksMock.mockResolvedValueOnce(tasks);
    createEvolveWorkspaceMock.mockResolvedValueOnce(
      path.join(tempDir, ".kairn-evolve"),
    );
    writeTasksFileMock.mockResolvedValueOnce(undefined);
    confirmMock.mockRejectedValueOnce(new Error("non-interactive")); // Exit the "add more" loop

    const initCmd = evolveCommand.commands.find((c) => c.name() === "init");
    await initCmd?.parseAsync(["node", "init", "--workflow", "feature-development"]);

    expect(autoGenerateTasksMock).toHaveBeenCalledWith(
      tempDir,
      "feature-development",
    );
  });

  it("uses spinner during LLM task generation", async () => {
    const tasks = [makeSampleTask()];
    autoGenerateTasksMock.mockResolvedValueOnce(tasks);
    createEvolveWorkspaceMock.mockResolvedValueOnce(
      path.join(tempDir, ".kairn-evolve"),
    );
    writeTasksFileMock.mockResolvedValueOnce(undefined);
    confirmMock.mockRejectedValueOnce(new Error("non-interactive"));

    const ora = (await import("ora")).default;

    const initCmd = evolveCommand.commands.find((c) => c.name() === "init");
    await initCmd?.parseAsync(["node", "init"]);

    expect(ora).toHaveBeenCalledWith(
      expect.stringContaining("Generating"),
    );
    expect(spinnerMock.succeed).toHaveBeenCalled();
  });

  it("falls back to template placeholders when LLM fails", async () => {
    autoGenerateTasksMock.mockRejectedValueOnce(new Error("LLM failed"));
    createEvolveWorkspaceMock.mockResolvedValueOnce(
      path.join(tempDir, ".kairn-evolve"),
    );
    writeTasksFileMock.mockResolvedValueOnce(undefined);
    confirmMock.mockRejectedValueOnce(new Error("non-interactive"));

    const initCmd = evolveCommand.commands.find((c) => c.name() === "init");
    await initCmd?.parseAsync(["node", "init"]);

    expect(spinnerMock.fail).toHaveBeenCalledWith(
      expect.stringContaining("failed"),
    );
    // writeTasksFile should still be called with fallback tasks
    expect(writeTasksFileMock).toHaveBeenCalled();
    const writtenTasks = writeTasksFileMock.mock.calls[0][1] as Task[];
    expect(writtenTasks.length).toBeGreaterThan(0);
  });

  it("writes tasks file after generation", async () => {
    const tasks = [makeSampleTask()];
    autoGenerateTasksMock.mockResolvedValueOnce(tasks);
    createEvolveWorkspaceMock.mockResolvedValueOnce(
      path.join(tempDir, ".kairn-evolve"),
    );
    writeTasksFileMock.mockResolvedValueOnce(undefined);
    confirmMock.mockRejectedValueOnce(new Error("non-interactive"));

    const initCmd = evolveCommand.commands.find((c) => c.name() === "init");
    await initCmd?.parseAsync(["node", "init"]);

    expect(writeTasksFileMock).toHaveBeenCalledWith(
      path.join(tempDir, ".kairn-evolve"),
      expect.arrayContaining([expect.objectContaining({ id: "add-health-endpoint" })]),
    );
  });

  it("supports interactive add-another-eval loop", async () => {
    const tasks = [makeSampleTask()];
    autoGenerateTasksMock.mockResolvedValueOnce(tasks);
    createEvolveWorkspaceMock.mockResolvedValueOnce(
      path.join(tempDir, ".kairn-evolve"),
    );
    writeTasksFileMock.mockResolvedValueOnce(undefined);
    loadConfigMock.mockResolvedValueOnce({
      provider: "anthropic",
      api_key: "test-key",
      model: "claude-sonnet-4-6",
      default_runtime: "claude-code",
      created_at: new Date().toISOString(),
    });
    buildProjectProfileMock.mockResolvedValueOnce({
      language: "typescript",
      framework: null,
      scripts: {},
      keyFiles: [],
    });

    // First confirm: yes, add more
    confirmMock.mockResolvedValueOnce(true);
    selectMock.mockResolvedValueOnce("fix-bug");
    generateTasksFromTemplatesMock.mockResolvedValueOnce([
      makeSampleTask({ id: "fix-cors-bug", template: "fix-bug" }),
    ]);
    // Second confirm: no, stop
    confirmMock.mockResolvedValueOnce(false);

    const initCmd = evolveCommand.commands.find((c) => c.name() === "init");
    await initCmd?.parseAsync(["node", "init"]);

    expect(selectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("eval template"),
      }),
    );
    // Should have written initial + added task
    expect(writeTasksFileMock).toHaveBeenCalled();
    const writtenTasks = writeTasksFileMock.mock.calls[0][1] as Task[];
    expect(writtenTasks).toHaveLength(2);
    expect(writtenTasks[1].id).toBe("fix-cors-bug");
  });
});

describe("evolve run action", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const rawTmpDir = path.join(
      os.tmpdir(),
      `kairn-evolve-run-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(rawTmpDir, { recursive: true });
    // Resolve symlinks (macOS /var -> /private/var) so process.cwd() matches
    tempDir = await fs.realpath(rawTmpDir);
    const workspace = path.join(tempDir, ".kairn-evolve");
    await fs.mkdir(path.join(workspace, "traces", "0"), { recursive: true });

    // Write a valid tasks.yaml
    const tasks = [
      makeSampleTask({ id: "task-1" }),
      makeSampleTask({ id: "task-2", template: "fix-bug" }),
    ];
    await fs.writeFile(
      path.join(workspace, "tasks.yaml"),
      yamlStringify({ tasks }),
      "utf-8",
    );

    // Create .claude directory
    await fs.mkdir(path.join(tempDir, ".claude"), { recursive: true });

    originalCwd = process.cwd();
    process.chdir(tempDir);

    originalExit = process.exit;
    process.exit = vi.fn() as never;

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.clearAllMocks();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    consoleLogSpy.mockRestore();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("parses tasks.yaml with yaml package and runs a single task with --task", async () => {
    const score = makeSampleScore();
    runTaskMock.mockResolvedValue(makeSampleTaskResult({ score }));
    loadConfigMock.mockResolvedValue({
      provider: "anthropic",
      api_key: "test-key",
      model: "claude-sonnet-4-6",
      default_runtime: "claude-code",
      created_at: new Date().toISOString(),
    });

    const runCmd = evolveCommand.commands.find((c) => c.name() === "run");
    await runCmd?.parseAsync(["node", "run", "--task", "task-1"]);

    // Single task should be run
    expect(runTaskMock).toHaveBeenCalledTimes(1);
  });

  it("filters to specific task with --task option", async () => {
    const score = makeSampleScore();
    runTaskMock.mockResolvedValue(makeSampleTaskResult({ score }));
    loadConfigMock.mockResolvedValue({
      provider: "anthropic",
      api_key: "test-key",
      model: "claude-sonnet-4-6",
      default_runtime: "claude-code",
      created_at: new Date().toISOString(),
    });

    const runCmd = evolveCommand.commands.find((c) => c.name() === "run");
    await runCmd?.parseAsync(["node", "run", "--task", "task-1"]);

    expect(runTaskMock).toHaveBeenCalledTimes(1);
    expect(runTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1" }),
      expect.any(String),
      expect.any(String),
      0,
      expect.objectContaining({
        config: expect.objectContaining({ api_key: "test-key" }),
      }),
    );
  });

  it("passes loaded config into runTask for live-workspace scoring", async () => {
    const score = makeSampleScore();
    runTaskMock.mockResolvedValue(makeSampleTaskResult({ score }));
    loadConfigMock.mockResolvedValue({
      provider: "anthropic",
      api_key: "test-key",
      model: "claude-sonnet-4-6",
      default_runtime: "claude-code",
      created_at: new Date().toISOString(),
    });

    const runCmd = evolveCommand.commands.find((c) => c.name() === "run");
    await runCmd?.parseAsync(["node", "run", "--task", "task-1"]);

    expect(runTaskMock.mock.calls[0][4]).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({ api_key: "test-key" }),
      }),
    );
  });

  it("uses the score returned by runTask for the specified task", async () => {
    const score = makeSampleScore();
    runTaskMock.mockResolvedValue(makeSampleTaskResult({ score }));
    loadConfigMock.mockResolvedValue({
      provider: "anthropic",
      api_key: "test-key",
      model: "claude-sonnet-4-6",
      default_runtime: "claude-code",
      created_at: new Date().toISOString(),
    });

    const runCmd = evolveCommand.commands.find((c) => c.name() === "run");
    await runCmd?.parseAsync(["node", "run", "--task", "task-1"]);

    const logCalls = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(logCalls.some((line: string) => line.includes("task-1"))).toBe(true);
  });

  it("uses ora spinner for --task single-task run", async () => {
    const score = makeSampleScore();
    runTaskMock.mockResolvedValue(makeSampleTaskResult({ score }));
    loadConfigMock.mockResolvedValue({
      provider: "anthropic",
      api_key: "test-key",
      model: "claude-sonnet-4-6",
      default_runtime: "claude-code",
      created_at: new Date().toISOString(),
    });

    const ora = (await import("ora")).default;

    const runCmd = evolveCommand.commands.find((c) => c.name() === "run");
    await runCmd?.parseAsync(["node", "run", "--task", "task-1"]);

    // ora should be called once for the single task
    expect(ora).toHaveBeenCalledTimes(1);
    expect(spinnerMock.stop).toHaveBeenCalledTimes(1);
  });

  it("passes full Task objects from YAML to runTask (not just IDs)", async () => {
    const score = makeSampleScore();
    runTaskMock.mockResolvedValue(makeSampleTaskResult({ score }));
    loadConfigMock.mockResolvedValue({
      provider: "anthropic",
      api_key: "test-key",
      model: "claude-sonnet-4-6",
      default_runtime: "claude-code",
      created_at: new Date().toISOString(),
    });

    const runCmd = evolveCommand.commands.find((c) => c.name() === "run");
    await runCmd?.parseAsync(["node", "run", "--task", "task-1"]);

    // The first argument to runTask should be a full Task object
    const firstCallTask = runTaskMock.mock.calls[0][0] as Task;
    expect(firstCallTask.id).toBe("task-1");
    expect(firstCallTask.template).toBe("add-feature");
    expect(firstCallTask.description).toBe("Add a /health endpoint");
    expect(firstCallTask.scoring).toBe("pass-fail");
    expect(firstCallTask.timeout).toBe(300);
  });

  it("displays summary with pass/fail counts in single-task mode", async () => {
    const passScore = makeSampleScore({ pass: true });

    runTaskMock
      .mockResolvedValueOnce(makeSampleTaskResult({ taskId: "task-1", score: passScore }));
    loadConfigMock.mockResolvedValue({
      provider: "anthropic",
      api_key: "test-key",
      model: "claude-sonnet-4-6",
      default_runtime: "claude-code",
      created_at: new Date().toISOString(),
    });

    const runCmd = evolveCommand.commands.find((c) => c.name() === "run");
    await runCmd?.parseAsync(["node", "run", "--task", "task-1"]);

    // Check that summary line with "1/1 passed" was logged
    const logCalls = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const summaryLine = logCalls.find((line: string) => line.includes("1") && line.includes("passed"));
    expect(summaryLine).toBeDefined();
  });
});
