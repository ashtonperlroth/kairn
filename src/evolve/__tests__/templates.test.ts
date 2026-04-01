import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KairnConfig } from "../../types.js";
import type { EvalTemplate, ProjectProfileSummary, Task } from "../types.js";

// Mock callLLM before importing the module under test
const callLLMMock = vi.fn();
vi.mock("../../llm.js", () => ({
  callLLM: callLLMMock,
}));

// Import after mocks are registered
const { TASK_GENERATION_PROMPT, generateTasksFromTemplates, EVAL_TEMPLATES, selectTemplatesForWorkflow } =
  await import("../templates.js");

function makeConfig(overrides: Partial<KairnConfig> = {}): KairnConfig {
  return {
    provider: "anthropic",
    api_key: "test-key",
    model: "claude-sonnet-4-6",
    default_runtime: "claude-code",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeProfile(overrides: Partial<ProjectProfileSummary> = {}): ProjectProfileSummary {
  return {
    language: "TypeScript",
    framework: "Express",
    scripts: { build: "tsc", test: "vitest run", dev: "tsx watch src/index.ts" },
    keyFiles: ["src/index.ts", "package.json", "tsconfig.json"],
    ...overrides,
  };
}

function makeValidTasksJson(tasks: Partial<Task>[] = []): string {
  const defaults: Task[] = [
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
      scoring: "pass-fail",
      timeout: 300,
    },
  ];
  const finalTasks = tasks.length > 0 ? tasks : defaults;
  return JSON.stringify({ tasks: finalTasks });
}

describe("TASK_GENERATION_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof TASK_GENERATION_PROMPT).toBe("string");
    expect(TASK_GENERATION_PROMPT.length).toBeGreaterThan(0);
  });

  it("instructs the LLM to return JSON with a tasks array", () => {
    expect(TASK_GENERATION_PROMPT).toContain("tasks");
    expect(TASK_GENERATION_PROMPT).toContain("JSON");
  });

  it("specifies required task fields", () => {
    expect(TASK_GENERATION_PROMPT).toContain("id");
    expect(TASK_GENERATION_PROMPT).toContain("template");
    expect(TASK_GENERATION_PROMPT).toContain("description");
    expect(TASK_GENERATION_PROMPT).toContain("setup");
    expect(TASK_GENERATION_PROMPT).toContain("expected_outcome");
    expect(TASK_GENERATION_PROMPT).toContain("scoring");
    expect(TASK_GENERATION_PROMPT).toContain("timeout");
  });
});

describe("EVAL_TEMPLATES", () => {
  it("has all six eval template entries", () => {
    const keys = Object.keys(EVAL_TEMPLATES);
    expect(keys).toContain("add-feature");
    expect(keys).toContain("fix-bug");
    expect(keys).toContain("refactor");
    expect(keys).toContain("test-writing");
    expect(keys).toContain("config-change");
    expect(keys).toContain("documentation");
    expect(keys).toContain("convention-adherence");
    expect(keys).toContain("workflow-compliance");
    expect(keys).toContain("rule-compliance");
    expect(keys).toContain("intent-routing");
    expect(keys).toHaveLength(10);
  });

  it("each template has required metadata fields", () => {
    for (const [key, meta] of Object.entries(EVAL_TEMPLATES)) {
      expect(meta.id).toBe(key);
      expect(meta.name).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(Array.isArray(meta.bestFor)).toBe(true);
      expect(meta.bestFor.length).toBeGreaterThan(0);
    }
  });
});

describe("selectTemplatesForWorkflow", () => {
  it("returns templates for known workflow types", () => {
    const result = selectTemplatesForWorkflow("feature-development");
    expect(result).toContain("add-feature");
    expect(result).toContain("test-writing");
  });

  it("returns default templates for unknown workflow types", () => {
    const result = selectTemplatesForWorkflow("unknown-workflow");
    expect(result).toEqual(["add-feature", "fix-bug", "test-writing", "convention-adherence"]);
  });

  it("includes at least one harness-aware template for every workflow", () => {
    const harnessAware = ["convention-adherence", "workflow-compliance", "rule-compliance"];
    const workflows = [
      "feature-development", "api-building", "full-stack", "maintenance",
      "debugging", "qa", "architecture", "backend", "devops",
      "infrastructure", "tdd", "content", "research", "unknown",
    ];
    for (const wf of workflows) {
      const templates = selectTemplatesForWorkflow(wf);
      const hasHarnessAware = templates.some(t => harnessAware.includes(t));
      expect(hasHarnessAware, `${wf} should have a harness-aware template`).toBe(true);
    }
  });
});

describe("generateTasksFromTemplates", () => {
  const config = makeConfig();
  const profile = makeProfile();
  const templates: EvalTemplate[] = ["add-feature", "fix-bug"];
  const claudeMd = "# My Project\nA sample Express API project.";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an array of Task objects", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());

    const result = await generateTasksFromTemplates(claudeMd, profile, templates, config);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
  });

  it("each returned task has all required fields", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());

    const result = await generateTasksFromTemplates(claudeMd, profile, templates, config);

    for (const task of result) {
      expect(typeof task.id).toBe("string");
      expect(typeof task.template).toBe("string");
      expect(typeof task.description).toBe("string");
      expect(typeof task.setup).toBe("string");
      expect(task.expected_outcome).toBeTruthy();
      expect(typeof task.scoring).toBe("string");
      expect(typeof task.timeout).toBe("number");
    }
  });

  it("calls callLLM with correct systemPrompt and maxTokens", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());

    await generateTasksFromTemplates(claudeMd, profile, templates, config);

    expect(callLLMMock).toHaveBeenCalledTimes(1);
    expect(callLLMMock).toHaveBeenCalledWith(
      config,
      expect.any(String),
      expect.objectContaining({
        systemPrompt: TASK_GENERATION_PROMPT,
        maxTokens: 4096,
      }),
    );
  });

  it("includes CLAUDE.md content in user message", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());

    await generateTasksFromTemplates(claudeMd, profile, templates, config);

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain(claudeMd);
  });

  it("includes project profile details in user message", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());

    await generateTasksFromTemplates(claudeMd, profile, templates, config);

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("TypeScript");
    expect(userMessage).toContain("Express");
    expect(userMessage).toContain("src/index.ts");
  });

  it("includes template descriptions in user message", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());

    await generateTasksFromTemplates(claudeMd, profile, templates, config);

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("add-feature");
    expect(userMessage).toContain("fix-bug");
    expect(userMessage).toContain("Can the agent add a new capability?");
  });

  it("strips markdown fences from LLM response", async () => {
    const wrapped = "```json\n" + makeValidTasksJson() + "\n```";
    callLLMMock.mockResolvedValueOnce(wrapped);

    const result = await generateTasksFromTemplates(claudeMd, profile, templates, config);

    expect(result.length).toBe(2);
    expect(result[0].id).toBe("add-health-endpoint");
  });

  it("extracts JSON from surrounding text", async () => {
    const withText = "Here are the tasks:\n" + makeValidTasksJson() + "\nDone!";
    callLLMMock.mockResolvedValueOnce(withText);

    const result = await generateTasksFromTemplates(claudeMd, profile, templates, config);

    expect(result.length).toBe(2);
  });

  it("throws on invalid JSON response", async () => {
    callLLMMock.mockResolvedValueOnce("this is not json at all");

    await expect(
      generateTasksFromTemplates(claudeMd, profile, templates, config),
    ).rejects.toThrow();
  });

  it("throws when tasks array is missing from response", async () => {
    callLLMMock.mockResolvedValueOnce(JSON.stringify({ notTasks: [] }));

    await expect(
      generateTasksFromTemplates(claudeMd, profile, templates, config),
    ).rejects.toThrow();
  });

  it("throws when a task is missing required fields", async () => {
    const badTasks = JSON.stringify({
      tasks: [{ id: "incomplete-task" }],
    });
    callLLMMock.mockResolvedValueOnce(badTasks);

    await expect(
      generateTasksFromTemplates(claudeMd, profile, templates, config),
    ).rejects.toThrow();
  });

  it("handles null language and framework in profile", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());
    const nullProfile = makeProfile({ language: null, framework: null });

    const result = await generateTasksFromTemplates(claudeMd, nullProfile, templates, config);

    expect(result.length).toBe(2);
    const userMessage = callLLMMock.mock.calls[0][1] as string;
    // Should still include the profile section even with nulls
    expect(userMessage).toContain("Key files");
  });

  it("propagates LLM errors", async () => {
    callLLMMock.mockRejectedValueOnce(new Error("Rate limited by Anthropic"));

    await expect(
      generateTasksFromTemplates(claudeMd, profile, templates, config),
    ).rejects.toThrow("Rate limited by Anthropic");
  });
});
