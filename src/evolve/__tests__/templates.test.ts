import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KairnConfig } from "../../types.js";
import type { EvalTemplate, ProjectProfileSummary, Task } from "../types.js";
import type { ProjectAnalysis } from "../../analyzer/types.js";

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
  it("has all fourteen eval template entries", () => {
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
    expect(keys).toContain("persistence-completion");
    expect(keys).toContain("real-bug-fix");
    expect(keys).toContain("real-feature-add");
    expect(keys).toContain("codebase-question");
    expect(keys).toHaveLength(14);
  });

  it("each template has required metadata fields including category", () => {
    for (const [key, meta] of Object.entries(EVAL_TEMPLATES)) {
      expect(meta.id).toBe(key);
      expect(meta.name).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(Array.isArray(meta.bestFor)).toBe(true);
      expect(meta.bestFor.length).toBeGreaterThan(0);
      expect(meta.category).toBeDefined();
      expect(['harness-sensitivity', 'substantive']).toContain(meta.category);
    }
  });

  it("existing templates have category harness-sensitivity", () => {
    const harnessSensitivityTemplates: EvalTemplate[] = [
      "add-feature", "fix-bug", "refactor", "test-writing", "config-change",
      "documentation", "convention-adherence", "workflow-compliance",
      "rule-compliance", "intent-routing", "persistence-completion",
    ];
    for (const id of harnessSensitivityTemplates) {
      expect(EVAL_TEMPLATES[id].category).toBe("harness-sensitivity");
    }
  });

  it("new SWE-bench templates have category substantive", () => {
    const substantiveTemplates: EvalTemplate[] = [
      "real-bug-fix", "real-feature-add", "codebase-question",
    ];
    for (const id of substantiveTemplates) {
      expect(EVAL_TEMPLATES[id].category).toBe("substantive");
    }
  });
});

describe("selectTemplatesForWorkflow", () => {
  const substantive: EvalTemplate[] = ["real-bug-fix", "real-feature-add", "codebase-question"];

  it("always includes all three substantive templates", () => {
    const workflows = [
      "feature-development", "api-building", "full-stack", "maintenance",
      "debugging", "qa", "architecture", "backend", "devops",
      "infrastructure", "tdd", "content", "research", "unknown-workflow",
    ];
    for (const wf of workflows) {
      const result = selectTemplatesForWorkflow(wf);
      for (const t of substantive) {
        expect(result, `${wf} should include ${t}`).toContain(t);
      }
    }
  });

  it("includes workflow-specific harness templates after the substantive floor", () => {
    const result = selectTemplatesForWorkflow("feature-development");
    expect(result).toContain("add-feature");
    expect(result).toContain("test-writing");
  });

  it("caps harness templates at 4", () => {
    const workflows = [
      "feature-development", "api-building", "full-stack", "maintenance",
      "debugging", "qa", "architecture", "backend", "devops",
      "infrastructure", "tdd", "content", "research", "unknown-workflow",
    ];
    for (const wf of workflows) {
      const result = selectTemplatesForWorkflow(wf);
      const harnessCount = result.filter(t => !substantive.includes(t)).length;
      expect(harnessCount, `${wf} should have at most 4 harness templates`).toBeLessThanOrEqual(4);
    }
  });

  it("returns 7 templates for workflows with enough harness options", () => {
    const result = selectTemplatesForWorkflow("feature-development");
    expect(result).toHaveLength(7);
  });

  it("returns default harness templates for unknown workflow types", () => {
    const result = selectTemplatesForWorkflow("unknown-workflow");
    expect(result).toContain("add-feature");
    expect(result).toContain("fix-bug");
    expect(result).toContain("test-writing");
    expect(result).toContain("convention-adherence");
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

  it("substantive templates come first in the returned array", () => {
    const result = selectTemplatesForWorkflow("feature-development");
    expect(result.slice(0, 3)).toEqual(substantive);
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

  it("preserves category field on generated tasks when present", async () => {
    const tasksWithCategory = JSON.stringify({
      tasks: [
        {
          id: "fix-swap-vars",
          template: "real-bug-fix",
          description: "Fix the swapped variable names in auth.ts",
          setup: "npm install",
          expected_outcome: "Test suite passes with correct variable names",
          scoring: "pass-fail",
          timeout: 300,
          category: "substantive",
        },
      ],
    });
    callLLMMock.mockResolvedValueOnce(tasksWithCategory);

    const result = await generateTasksFromTemplates(claudeMd, profile, ["real-bug-fix"] as EvalTemplate[], config);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("substantive");
  });
});

describe("real-bug-fix template", () => {
  it("exists in EVAL_TEMPLATES", () => {
    expect(EVAL_TEMPLATES["real-bug-fix"]).toBeDefined();
  });

  it("has correct metadata", () => {
    const meta = EVAL_TEMPLATES["real-bug-fix"];
    expect(meta.id).toBe("real-bug-fix");
    expect(meta.name).toBe("Real Bug Fix");
    expect(meta.category).toBe("substantive");
    expect(meta.description).toContain("bug");
  });

  it("description mentions injecting a known bug", () => {
    const meta = EVAL_TEMPLATES["real-bug-fix"];
    expect(meta.description.toLowerCase()).toMatch(/inject|known|bug/);
  });

  it("bestFor includes debugging and maintenance", () => {
    const meta = EVAL_TEMPLATES["real-bug-fix"];
    expect(meta.bestFor).toContain("debugging");
    expect(meta.bestFor).toContain("maintenance");
  });
});

describe("real-feature-add template", () => {
  it("exists in EVAL_TEMPLATES", () => {
    expect(EVAL_TEMPLATES["real-feature-add"]).toBeDefined();
  });

  it("has correct metadata", () => {
    const meta = EVAL_TEMPLATES["real-feature-add"];
    expect(meta.id).toBe("real-feature-add");
    expect(meta.name).toBe("Real Feature Add");
    expect(meta.category).toBe("substantive");
    expect(meta.description).toContain("feature");
  });

  it("description mentions acceptance criteria", () => {
    const meta = EVAL_TEMPLATES["real-feature-add"];
    expect(meta.description.toLowerCase()).toMatch(/acceptance|criteria|concrete/);
  });

  it("bestFor includes feature-development", () => {
    const meta = EVAL_TEMPLATES["real-feature-add"];
    expect(meta.bestFor).toContain("feature-development");
  });
});

describe("codebase-question template", () => {
  it("exists in EVAL_TEMPLATES", () => {
    expect(EVAL_TEMPLATES["codebase-question"]).toBeDefined();
  });

  it("has correct metadata", () => {
    const meta = EVAL_TEMPLATES["codebase-question"];
    expect(meta.id).toBe("codebase-question");
    expect(meta.name).toBe("Codebase Question");
    expect(meta.category).toBe("substantive");
    expect(meta.description).toContain("question");
  });

  it("description mentions factual or codebase understanding", () => {
    const meta = EVAL_TEMPLATES["codebase-question"];
    expect(meta.description.toLowerCase()).toMatch(/factual|understand|knowledge/);
  });

  it("bestFor includes research and architecture", () => {
    const meta = EVAL_TEMPLATES["codebase-question"];
    expect(meta.bestFor).toContain("research");
    expect(meta.bestFor).toContain("architecture");
  });
});

describe("selectTemplatesForWorkflow with substantive templates", () => {
  const substantive: EvalTemplate[] = ["real-bug-fix", "real-feature-add", "codebase-question"];

  it("includes all substantive templates for every workflow type", () => {
    const workflows = [
      "feature-development", "maintenance", "research", "unknown-workflow",
    ];
    for (const wf of workflows) {
      const result = selectTemplatesForWorkflow(wf);
      for (const t of substantive) {
        expect(result, `${wf} should include ${t}`).toContain(t);
      }
    }
  });
});

describe("TASK_GENERATION_PROMPT includes substantive template guidance", () => {
  it("mentions real-bug-fix template behavior", () => {
    expect(TASK_GENERATION_PROMPT.toLowerCase()).toMatch(/real.bug.fix|inject.*bug|known.*bug/);
  });

  it("mentions real-feature-add template behavior", () => {
    expect(TASK_GENERATION_PROMPT.toLowerCase()).toMatch(/real.feature.add|acceptance.*criteria|concrete.*feature/);
  });

  it("mentions codebase-question template behavior", () => {
    expect(TASK_GENERATION_PROMPT.toLowerCase()).toMatch(/codebase.question|factual.*question|codebase.*knowledge/);
  });

  it("mentions category field in task output", () => {
    expect(TASK_GENERATION_PROMPT).toContain("category");
  });
});

function makeSampleAnalysis(): ProjectAnalysis {
  return {
    purpose: "REST API for managing inventory",
    domain: "e-commerce",
    key_modules: [
      {
        name: "auth",
        path: "src/auth/",
        description: "Handles authentication and authorization",
        responsibilities: ["JWT tokens", "role-based access"],
      },
      {
        name: "inventory",
        path: "src/inventory/",
        description: "Core inventory management logic",
        responsibilities: ["stock tracking", "reorder alerts"],
      },
    ],
    workflows: [
      {
        name: "order-fulfillment",
        description: "Process customer orders and update stock",
        trigger: "POST /orders",
        steps: ["validate order", "check stock", "decrement inventory", "send confirmation"],
      },
    ],
    architecture_style: "REST-API",
    deployment_model: "docker-compose",
    dataflow: [
      { from: "auth", to: "inventory", data: "user context" },
    ],
    config_keys: [
      { name: "DATABASE_URL", purpose: "PostgreSQL connection string" },
      { name: "JWT_SECRET", purpose: "Token signing key" },
    ],
    sampled_files: ["src/auth/index.ts", "src/inventory/service.ts"],
    content_hash: "def456",
    analyzed_at: new Date().toISOString(),
  };
}

describe("generateTasksFromTemplates with analysis context", () => {
  const config = makeConfig();
  const profile = makeProfile();
  const templates: EvalTemplate[] = ["add-feature", "real-bug-fix", "codebase-question"];
  const claudeMd = "# Inventory API\nAn Express-based inventory management system.";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes module names from analysis in user message", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());
    const analysis = makeSampleAnalysis();

    await generateTasksFromTemplates(claudeMd, profile, templates, config, analysis);

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("auth");
    expect(userMessage).toContain("inventory");
  });

  it("includes module paths from analysis in user message", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());
    const analysis = makeSampleAnalysis();

    await generateTasksFromTemplates(claudeMd, profile, templates, config, analysis);

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("src/auth/");
    expect(userMessage).toContain("src/inventory/");
  });

  it("includes workflow names from analysis in user message", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());
    const analysis = makeSampleAnalysis();

    await generateTasksFromTemplates(claudeMd, profile, templates, config, analysis);

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("order-fulfillment");
  });

  it("includes project purpose and domain from analysis", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());
    const analysis = makeSampleAnalysis();

    await generateTasksFromTemplates(claudeMd, profile, templates, config, analysis);

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("REST API for managing inventory");
    expect(userMessage).toContain("e-commerce");
  });

  it("includes architecture style and deployment model", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());
    const analysis = makeSampleAnalysis();

    await generateTasksFromTemplates(claudeMd, profile, templates, config, analysis);

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("REST-API");
    expect(userMessage).toContain("docker-compose");
  });

  it("includes config keys from analysis", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());
    const analysis = makeSampleAnalysis();

    await generateTasksFromTemplates(claudeMd, profile, templates, config, analysis);

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("DATABASE_URL");
    expect(userMessage).toContain("JWT_SECRET");
  });

  it("works correctly without analysis (backward compatible)", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());

    const result = await generateTasksFromTemplates(claudeMd, profile, templates, config);

    expect(result.length).toBe(2);
    const userMessage = callLLMMock.mock.calls[0][1] as string;
    // Should not contain analysis section
    expect(userMessage).not.toContain("## Project Analysis");
  });

  it("includes module responsibilities for richer task generation", async () => {
    callLLMMock.mockResolvedValueOnce(makeValidTasksJson());
    const analysis = makeSampleAnalysis();

    await generateTasksFromTemplates(claudeMd, profile, templates, config, analysis);

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("JWT tokens");
    expect(userMessage).toContain("stock tracking");
  });
});
