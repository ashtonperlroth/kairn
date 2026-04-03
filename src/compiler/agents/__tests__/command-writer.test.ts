import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTask } from "../types.js";
import type { CommandNode } from "../../../ir/types.js";
import type { KairnConfig, SkeletonSpec } from "../../../types.js";

// ─── Mock callLLM ──────────────────────────────────────────────────────────

const mockCallLLM = vi.fn<
  (...args: unknown[]) => Promise<string>
>();

vi.mock("../../../llm.js", () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
}));

// ─── Test helpers ──────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<KairnConfig> = {}): KairnConfig {
  return {
    provider: "anthropic" as const,
    api_key: "test-key",
    model: "claude-sonnet-4-6",
    default_runtime: "claude-code",
    created_at: "2026-01-01",
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
      workflow_type: "cli-development",
      key_commands: ["build", "test", "lint"],
      custom_rules: [],
      custom_agents: [],
      custom_skills: [],
    },
    ...overrides,
  };
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    agent: "command-writer",
    items: ["build", "test", "lint"],
    max_tokens: 4096,
    ...overrides,
  };
}

function makeLLMResponse(commands: Array<{ name: string; description: string; content: string }>): string {
  return JSON.stringify(commands);
}

function makeFencedResponse(commands: Array<{ name: string; description: string; content: string }>): string {
  return "```json\n" + JSON.stringify(commands) + "\n```";
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("generateCommands", () => {
  beforeEach(() => {
    mockCallLLM.mockReset();
  });

  it("returns an AgentResult with agent: 'command-writer' and commands array", async () => {
    const { generateCommands } = await import("../command-writer.js");

    mockCallLLM.mockResolvedValueOnce(
      makeLLMResponse([
        { name: "build", description: "Build the project", content: "Run the build\n\n!npm run build" },
        { name: "test", description: "Run tests", content: "Execute test suite\n\n!npm test" },
        { name: "help", description: "Show available commands", content: "List all commands" },
      ]),
    );

    const task = makeTask();
    const config = makeConfig();

    const result = await generateCommands("TypeScript CLI project with standard dev workflow", makeSkeleton(), task, config);

    expect(result.agent).toBe("command-writer");
    if (result.agent === "command-writer") {
      expect(result.commands).toBeDefined();
      expect(Array.isArray(result.commands)).toBe(true);
    }
  });

  it("returns CommandNode[] with name, description, and content fields", async () => {
    const { generateCommands } = await import("../command-writer.js");

    mockCallLLM.mockResolvedValueOnce(
      makeLLMResponse([
        { name: "build", description: "Build the project", content: "Run the build\n\n!npm run build" },
        { name: "help", description: "Show commands", content: "List commands" },
      ]),
    );

    const task = makeTask({ items: ["build"] });
    const config = makeConfig();

    const result = await generateCommands("TypeScript CLI project", makeSkeleton(), task, config);

    if (result.agent === "command-writer") {
      for (const cmd of result.commands) {
        expect(cmd).toHaveProperty("name");
        expect(cmd).toHaveProperty("description");
        expect(cmd).toHaveProperty("content");
        expect(typeof cmd.name).toBe("string");
        expect(typeof cmd.description).toBe("string");
        expect(typeof cmd.content).toBe("string");
      }
    }
  });

  it("always includes a help command even if LLM omits it", async () => {
    const { generateCommands } = await import("../command-writer.js");

    mockCallLLM.mockResolvedValueOnce(
      makeLLMResponse([
        { name: "build", description: "Build the project", content: "Run the build\n\n!npm run build" },
        { name: "test", description: "Run tests", content: "Execute tests\n\n!npm test" },
      ]),
    );

    const task = makeTask({ items: ["build", "test"] });
    const config = makeConfig();

    const result = await generateCommands("TypeScript CLI project", makeSkeleton(), task, config);

    if (result.agent === "command-writer") {
      const helpCmd = result.commands.find((c: CommandNode) => c.name === "help");
      expect(helpCmd).toBeDefined();
      expect(helpCmd!.content).toContain("slash commands");
    }
  });

  it("does not duplicate help if LLM already includes it", async () => {
    const { generateCommands } = await import("../command-writer.js");

    mockCallLLM.mockResolvedValueOnce(
      makeLLMResponse([
        { name: "build", description: "Build", content: "Build stuff" },
        { name: "help", description: "Help info", content: "Custom help content" },
      ]),
    );

    const task = makeTask({ items: ["build"] });
    const config = makeConfig();

    const result = await generateCommands("TypeScript CLI project", makeSkeleton(), task, config);

    if (result.agent === "command-writer") {
      const helpCommands = result.commands.filter((c: CommandNode) => c.name === "help");
      expect(helpCommands).toHaveLength(1);
      // Should keep the LLM's version, not inject default
      expect(helpCommands[0].content).toBe("Custom help content");
    }
  });

  it("calls callLLM with cacheControl: true", async () => {
    const { generateCommands } = await import("../command-writer.js");

    mockCallLLM.mockResolvedValueOnce(
      makeLLMResponse([
        { name: "build", description: "Build", content: "Build stuff" },
        { name: "help", description: "Help", content: "Help content" },
      ]),
    );

    const task = makeTask({ items: ["build"] });
    const config = makeConfig();

    await generateCommands("TypeScript CLI project", makeSkeleton(), task, config);

    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    const callOptions = mockCallLLM.mock.calls[0][2] as Record<string, unknown>;
    expect(callOptions.cacheControl).toBe(true);
  });

  it("parses JSON responses wrapped in code fences", async () => {
    const { generateCommands } = await import("../command-writer.js");

    mockCallLLM.mockResolvedValueOnce(
      makeFencedResponse([
        { name: "deploy", description: "Deploy app", content: "Deploy to production\n\n!npm run deploy" },
      ]),
    );

    const task = makeTask({ items: ["deploy"] });
    const config = makeConfig();

    const result = await generateCommands("TypeScript CLI project", makeSkeleton(), task, config);

    if (result.agent === "command-writer") {
      expect(result.commands.find((c: CommandNode) => c.name === "deploy")).toBeDefined();
    }
  });

  it("returns empty commands array without calling LLM when items is empty", async () => {
    const { generateCommands } = await import("../command-writer.js");

    const task = makeTask({ items: [] });
    const config = makeConfig();

    const result = await generateCommands("TypeScript CLI project", makeSkeleton(), task, config);

    expect(result.agent).toBe("command-writer");
    if (result.agent === "command-writer") {
      expect(result.commands).toEqual([]);
    }
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it("batches items when there are more than 10, making multiple LLM calls", async () => {
    const { generateCommands } = await import("../command-writer.js");

    const items = Array.from({ length: 18 }, (_, i) => `cmd-${i}`);

    // First batch (8 items)
    mockCallLLM.mockResolvedValueOnce(
      makeLLMResponse(
        Array.from({ length: 8 }, (_, i) => ({
          name: `cmd-${i}`,
          description: `Command ${i}`,
          content: `Run cmd-${i}`,
        })),
      ),
    );

    // Second batch (8 items)
    mockCallLLM.mockResolvedValueOnce(
      makeLLMResponse(
        Array.from({ length: 8 }, (_, i) => ({
          name: `cmd-${i + 8}`,
          description: `Command ${i + 8}`,
          content: `Run cmd-${i + 8}`,
        })),
      ),
    );

    // Third batch (2 items)
    mockCallLLM.mockResolvedValueOnce(
      makeLLMResponse(
        Array.from({ length: 2 }, (_, i) => ({
          name: `cmd-${i + 16}`,
          description: `Command ${i + 16}`,
          content: `Run cmd-${i + 16}`,
        })),
      ),
    );

    const task = makeTask({ items });
    const config = makeConfig();

    const result = await generateCommands("TypeScript CLI project", makeSkeleton(), task, config);

    expect(mockCallLLM).toHaveBeenCalledTimes(3);
    if (result.agent === "command-writer") {
      // 18 commands from LLM + 1 injected help = 19
      expect(result.commands.length).toBe(19);
    }
  });

  it("does not batch when items count is 10 or fewer", async () => {
    const { generateCommands } = await import("../command-writer.js");

    const items = Array.from({ length: 10 }, (_, i) => `cmd-${i}`);

    mockCallLLM.mockResolvedValueOnce(
      makeLLMResponse(
        items.map((name) => ({
          name,
          description: `Command ${name}`,
          content: `Run ${name}`,
        })),
      ),
    );

    const task = makeTask({ items });
    const config = makeConfig();

    const result = await generateCommands("TypeScript CLI project", makeSkeleton(), task, config);

    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    if (result.agent === "command-writer") {
      // 10 from LLM + 1 help = 11
      expect(result.commands.length).toBe(11);
    }
  });

  it("includes intent and tech stack in the user message", async () => {
    const { generateCommands } = await import("../command-writer.js");

    mockCallLLM.mockResolvedValueOnce(
      makeLLMResponse([
        { name: "build", description: "Build", content: "Build stuff" },
        { name: "help", description: "Help", content: "Help content" },
      ]),
    );

    const task = makeTask({ items: ["build"] });
    const config = makeConfig();
    const skeleton = makeSkeleton();

    await generateCommands("TypeScript microservices project", skeleton, task, config);

    const userMessage = mockCallLLM.mock.calls[0][1] as string;
    expect(userMessage).toContain("TypeScript microservices project");
    expect(userMessage).toContain("TypeScript");
    expect(userMessage).toContain("Node.js");
  });

  it("constructs commands using createCommandNode factory", async () => {
    const { generateCommands } = await import("../command-writer.js");

    mockCallLLM.mockResolvedValueOnce(
      makeLLMResponse([
        { name: "deploy", description: "Deploy to production", content: "Deploy the app\n\n!npm run deploy" },
      ]),
    );

    const task = makeTask({ items: ["deploy"] });
    const config = makeConfig();

    const result = await generateCommands("TypeScript CLI project", makeSkeleton(), task, config);

    if (result.agent === "command-writer") {
      const deploy = result.commands.find((c: CommandNode) => c.name === "deploy");
      expect(deploy).toEqual({
        name: "deploy",
        description: "Deploy to production",
        content: "Deploy the app\n\n!npm run deploy",
      });
    }
  });

  it("merges batched results and deduplicates by name", async () => {
    const { generateCommands } = await import("../command-writer.js");

    const items = Array.from({ length: 12 }, (_, i) => `cmd-${i}`);

    // First batch returns cmd-0 through cmd-7
    mockCallLLM.mockResolvedValueOnce(
      makeLLMResponse(
        Array.from({ length: 8 }, (_, i) => ({
          name: `cmd-${i}`,
          description: `Command ${i}`,
          content: `Run cmd-${i}`,
        })),
      ),
    );

    // Second batch returns cmd-8 through cmd-11, but also includes a duplicate cmd-7
    mockCallLLM.mockResolvedValueOnce(
      makeLLMResponse([
        { name: "cmd-7", description: "Duplicate cmd 7", content: "Duplicate" },
        { name: "cmd-8", description: "Command 8", content: "Run cmd-8" },
        { name: "cmd-9", description: "Command 9", content: "Run cmd-9" },
        { name: "cmd-10", description: "Command 10", content: "Run cmd-10" },
        { name: "cmd-11", description: "Command 11", content: "Run cmd-11" },
      ]),
    );

    const task = makeTask({ items });
    const config = makeConfig();

    const result = await generateCommands("TypeScript CLI project", makeSkeleton(), task, config);

    if (result.agent === "command-writer") {
      // Should have 12 unique commands from LLM + 1 help = 13
      const names = result.commands.map((c: CommandNode) => c.name);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    }
  });
});
