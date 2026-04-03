import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KairnConfig, SkeletonSpec } from "../../../types.js";
import type { AgentTask } from "../types.js";

// ---------------------------------------------------------------------------
// Mock callLLM before importing the module under test
// ---------------------------------------------------------------------------

const callLLMMock = vi.fn<(...args: unknown[]) => Promise<string>>();

vi.mock("../../../llm.js", () => ({
  callLLM: (...args: unknown[]) => callLLMMock(...args),
}));

// Import after mock is established
const { generateSkills } = await import("../skill-writer.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeSkeleton(overrides: Partial<SkeletonSpec> = {}): SkeletonSpec {
  return {
    name: "test-project",
    description: "A test project",
    tools: [],
    outline: {
      tech_stack: ["TypeScript", "Node.js"],
      workflow_type: "development",
      key_commands: ["build", "test"],
      custom_rules: [],
      custom_agents: [],
      custom_skills: [],
    },
    ...overrides,
  };
}

function makeTask(items: string[]): AgentTask {
  return { agent: "skill-writer", items, max_tokens: 4096 };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { agent: 'skill-writer', skills: SkillNode[] }", async () => {
    const llmResponse = JSON.stringify([
      { name: "tdd", content: "# TDD Skill\n\n## Phase 1: RED\nWrite failing test.\n## Phase 2: GREEN\nMinimal implementation.\n## Phase 3: REFACTOR\nClean up." },
    ]);
    callLLMMock.mockResolvedValueOnce(llmResponse);

    const config = makeConfig();
    const task = makeTask(["tdd"]);
    const result = await generateSkills("Build a TypeScript project", makeSkeleton(), task, config);

    expect(result.agent).toBe("skill-writer");
    if (result.agent === "skill-writer") {
      expect(Array.isArray(result.skills)).toBe(true);
      expect(result.skills.length).toBe(1);
    }
  });

  it("skills have name and content fields", async () => {
    const skills = [
      { name: "tdd", content: "# TDD Skill\n\nContent here." },
      { name: "debugging", content: "# Debugging Skill\n\nContent here." },
    ];
    callLLMMock.mockResolvedValueOnce(JSON.stringify(skills));

    const config = makeConfig();
    const task = makeTask(["tdd", "debugging"]);
    const result = await generateSkills("Build a project", makeSkeleton(), task, config);

    if (result.agent === "skill-writer") {
      expect(result.skills).toHaveLength(2);
      for (const skill of result.skills) {
        expect(skill).toHaveProperty("name");
        expect(skill).toHaveProperty("content");
        expect(typeof skill.name).toBe("string");
        expect(typeof skill.content).toBe("string");
        expect(skill.name.length).toBeGreaterThan(0);
        expect(skill.content.length).toBeGreaterThan(0);
      }
    }
  });

  it("calls callLLM with cacheControl: true", async () => {
    callLLMMock.mockResolvedValueOnce(
      JSON.stringify([{ name: "test-skill", content: "content" }]),
    );

    const config = makeConfig();
    const task = makeTask(["test-skill"]);
    await generateSkills("Build a project", makeSkeleton(), task, config);

    expect(callLLMMock).toHaveBeenCalledTimes(1);
    const callArgs = callLLMMock.mock.calls[0];
    expect(callArgs[2]).toMatchObject({ cacheControl: true });
  });

  it("parses JSON response wrapped in code fences", async () => {
    const fencedResponse = '```json\n[{"name":"fenced-skill","content":"# Fenced\\n\\nContent."}]\n```';
    callLLMMock.mockResolvedValueOnce(fencedResponse);

    const config = makeConfig();
    const task = makeTask(["fenced-skill"]);
    const result = await generateSkills("Build a project", makeSkeleton(), task, config);

    if (result.agent === "skill-writer") {
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("fenced-skill");
      expect(result.skills[0].content).toContain("# Fenced");
    }
  });

  it("returns empty skills array without making LLM call when items is empty", async () => {
    const config = makeConfig();
    const task = makeTask([]);
    const result = await generateSkills("Build a project", makeSkeleton(), task, config);

    expect(result).toEqual({ agent: "skill-writer", skills: [] });
    expect(callLLMMock).not.toHaveBeenCalled();
  });

  it("TDD skill follows 3-phase pattern in content", async () => {
    const tddSkill = {
      name: "tdd",
      content: "# TDD Skill\n\n## Phase 1: RED\nWrite a failing test first.\n## Phase 2: GREEN\nWrite minimal code to pass.\n## Phase 3: REFACTOR\nClean up and improve.",
    };
    callLLMMock.mockResolvedValueOnce(JSON.stringify([tddSkill]));

    const config = makeConfig();
    const task = makeTask(["tdd"]);
    const result = await generateSkills("Build a project", makeSkeleton(), task, config);

    if (result.agent === "skill-writer") {
      const skill = result.skills[0];
      expect(skill.content).toContain("Phase 1: RED");
      expect(skill.content).toContain("Phase 2: GREEN");
      expect(skill.content).toContain("Phase 3: REFACTOR");
    }
  });

  it("passes skill names in the user message to callLLM", async () => {
    callLLMMock.mockResolvedValueOnce(
      JSON.stringify([
        { name: "deployment", content: "# Deployment" },
        { name: "code-review", content: "# Code Review" },
      ]),
    );

    const config = makeConfig();
    const task = makeTask(["deployment", "code-review"]);
    await generateSkills("Build a project", makeSkeleton(), task, config);

    const userMessage = callLLMMock.mock.calls[0][1] as string;
    expect(userMessage).toContain("deployment");
    expect(userMessage).toContain("code-review");
  });

  it("strips code fences with language identifier variations", async () => {
    const fenced = '```JSON\n[{"name":"stripped","content":"ok"}]\n```';
    callLLMMock.mockResolvedValueOnce(fenced);

    const config = makeConfig();
    const task = makeTask(["stripped"]);
    const result = await generateSkills("Build a project", makeSkeleton(), task, config);

    if (result.agent === "skill-writer") {
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("stripped");
    }
  });

  it("throws on malformed JSON from LLM", async () => {
    callLLMMock.mockResolvedValueOnce("not valid json at all");

    const config = makeConfig();
    const task = makeTask(["broken"]);

    await expect(generateSkills("Build a project", makeSkeleton(), task, config)).rejects.toThrow();
  });
});
