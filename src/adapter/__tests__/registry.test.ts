import { describe, expect, it } from "vitest";
import {
  AdapterCompatibilityError,
  UnknownRuntimeTargetError,
  assertRuntimeAdapterCompatibility,
  formatRuntimeTargetList,
  listRegisteredRuntimeAdapters,
  normalizeRuntimeTarget,
  resolveRuntimeAdapter,
  validateRuntimeAdapterCompatibility,
} from "../registry.js";
import type { EnvironmentSpec, RegistryTool } from "../../types.js";
import { RUNTIME_TARGETS } from "../../types.js";

function makeSpec(overrides: Partial<EnvironmentSpec> = {}): EnvironmentSpec {
  return {
    id: "env_test",
    name: "Test Harness",
    description: "Test harness",
    intent: "Test intent",
    created_at: "2026-05-15T00:00:00.000Z",
    autonomy_level: 1,
    tools: [],
    harness: {
      claude_md: "# Test",
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
    ...overrides,
  };
}

describe("runtime target registry", () => {
  it("lists the expanded runtime target model", () => {
    expect(RUNTIME_TARGETS).toEqual([
      "generic",
      "codex",
      "claude-code",
      "opencode",
      "forgecode",
      "hermes",
    ]);
    expect(formatRuntimeTargetList()).toBe("generic, codex, claude-code, opencode, forgecode, hermes");
  });

  it("normalizes runtime aliases", () => {
    expect(normalizeRuntimeTarget("claude")).toBe("claude-code");
    expect(normalizeRuntimeTarget("claude_code")).toBe("claude-code");
    expect(normalizeRuntimeTarget("codex-cli")).toBe("codex");
    expect(normalizeRuntimeTarget("open-code")).toBe("opencode");
    expect(normalizeRuntimeTarget("forge_code")).toBe("forgecode");
    expect(normalizeRuntimeTarget("hermes-agent")).toBe("hermes");
  });

  it("resolves registered adapters through the registry", () => {
    expect(resolveRuntimeAdapter("generic").target).toBe("generic");
    expect(resolveRuntimeAdapter("default").target).toBe("generic");
    expect(resolveRuntimeAdapter("claude").target).toBe("claude-code");
    expect(resolveRuntimeAdapter("codex-cli").target).toBe("codex");
    expect(resolveRuntimeAdapter("hermes-agent").target).toBe("hermes");
  });

  it("requires registered adapters to declare capabilities and limitations", () => {
    for (const adapter of listRegisteredRuntimeAdapters()) {
      expect(adapter.capabilities).toBeDefined();
      expect(adapter.capabilities.limitations).toBeDefined();
      expect(Array.isArray(adapter.capabilities.limitations)).toBe(true);
      expect(typeof adapter.capabilities.commands).toBe("boolean");
      expect(typeof adapter.capabilities.hooks.supported).toBe("boolean");
      expect(typeof adapter.capabilities.tools.mcpServers).toBe("boolean");
    }
  });

  it("reports unsupported soft features as compiler warnings", () => {
    const hermes = resolveRuntimeAdapter("hermes");
    const spec = makeSpec({
      harness: {
        ...makeSpec().harness,
        agents: { reviewer: "Review code." },
        docs: { DECISIONS: "# Decisions" },
      },
    });

    const issues = validateRuntimeAdapterCompatibility(hermes, spec);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "warning", feature: "agents" }),
        expect.objectContaining({ severity: "warning", feature: "docs" }),
      ]),
    );
  });

  it("rejects target-incompatible hooks", () => {
    const codex = resolveRuntimeAdapter("codex");
    const spec = makeSpec({
      harness: {
        ...makeSpec().harness,
        settings: {
          hooks: {
            PostToolUse: [
              {
                matcher: "Write|Edit",
                hooks: [{ type: "prompt", prompt: "Update docs when useful." }],
              },
            ],
          },
        },
      },
    });

    expect(() => assertRuntimeAdapterCompatibility(codex, spec)).toThrow(
      AdapterCompatibilityError,
    );
    expect(validateRuntimeAdapterCompatibility(codex, spec)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", feature: "hooks" }),
      ]),
    );
  });

  it("rejects target-incompatible commandless MCP tools", () => {
    const codex = resolveRuntimeAdapter("codex");
    const registry: RegistryTool[] = [
      {
        id: "broken-tool",
        name: "Broken Tool",
        description: "Missing command",
        category: "test",
        tier: 1,
        type: "mcp_server",
        auth: "none",
        best_for: ["tests"],
        install: { mcp_config: { broken: { args: ["serve"] } } },
      },
    ];
    const spec = makeSpec({
      tools: [{ tool_id: "broken-tool", reason: "Test validation" }],
    });

    expect(validateRuntimeAdapterCompatibility(codex, spec, registry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", feature: "tools" }),
      ]),
    );
  });

  it("rejects target-incompatible workflow commands", () => {
    const adapter = {
      ...resolveRuntimeAdapter("hermes"),
      capabilities: {
        ...resolveRuntimeAdapter("hermes").capabilities,
        commands: false,
      },
    };
    const spec = makeSpec({
      harness: {
        ...makeSpec().harness,
        commands: { build: "Run the build." },
      },
    });

    expect(validateRuntimeAdapterCompatibility(adapter, spec)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", feature: "commands" }),
      ]),
    );
  });

  it("rejects unknown runtime targets", () => {
    expect(() => normalizeRuntimeTarget("made-up-runtime")).toThrow(UnknownRuntimeTargetError);
  });
});
