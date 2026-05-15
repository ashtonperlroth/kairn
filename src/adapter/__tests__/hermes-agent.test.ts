import { describe, expect, it } from "vitest";
import type { EnvironmentSpec } from "../../types.js";
import { InvalidRenderedHarnessPathError } from "../../rendered-harness.js";
import { buildHermesRenderedHarness } from "../hermes-agent.js";

function makeSpec(overrides: Partial<EnvironmentSpec> = {}): EnvironmentSpec {
  return {
    id: "env_test-123",
    name: "test-project",
    description: "A test project",
    intent: "Build a test project",
    created_at: new Date().toISOString(),
    autonomy_level: 1,
    tools: [],
    harness: {
      claude_md: "# Test\n",
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

describe("buildHermesRenderedHarness", () => {
  it("returns sorted files with deterministic metadata", () => {
    const spec = makeSpec({
      harness: {
        ...makeSpec().harness,
        commands: {
          test: "Run tests",
          build: "Run build",
        },
      },
    });

    const rendered = buildHermesRenderedHarness(spec, []);

    expect(rendered.metadata).toMatchObject({
      schemaVersion: 1,
      target: "hermes",
      source: "environment-spec",
    });
    expect([...rendered.files.keys()]).toEqual([
      ".hermes/skills/build.md",
      ".hermes/skills/test.md",
    ]);
    expect(rendered.files.get(".hermes/skills/build.md")?.metadata).toMatchObject(
      {
        byteLength: "Run build".length,
        lineCount: 1,
        source: "commands",
      },
    );
  });

  it("rejects path traversal before writing", () => {
    const spec = makeSpec({
      harness: {
        ...makeSpec().harness,
        skills: {
          "../../escape": "escaped",
        },
      },
    });

    expect(() => buildHermesRenderedHarness(spec, [])).toThrow(
      InvalidRenderedHarnessPathError,
    );
  });
});
