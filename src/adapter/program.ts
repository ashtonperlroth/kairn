import { createHarnessProgramFromIR, type HarnessProgram } from "../ir/program.js";
import type { EnvironmentSpec, RegistryTool, RuntimeTarget } from "../types.js";

function hasNonEmptyBody(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function collectRegistryToolBindings(
  spec: EnvironmentSpec,
  registry: RegistryTool[],
): HarnessProgram["tools"] {
  const tools: HarnessProgram["tools"] = [];

  for (const selected of spec.tools) {
    const tool = registry.find((candidate) => candidate.id === selected.tool_id);
    if (!tool) continue;

    for (const [serverName, serverConfig] of Object.entries(
      tool.install.mcp_config ?? {},
    )) {
      if (!serverConfig || typeof serverConfig !== "object") continue;
      const config = serverConfig as Record<string, unknown>;
      const command = typeof config["command"] === "string"
        ? config["command"]
        : undefined;
      const args = Array.isArray(config["args"])
        ? config["args"].filter((arg): arg is string => typeof arg === "string")
        : [];
      const env = config["env"] && typeof config["env"] === "object"
        ? Object.fromEntries(
          Object.entries(config["env"] as Record<string, unknown>)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
        : {};

      tools.push({
        id: `tool:${serverName}`,
        kind: "mcp-server",
        displayName: tool.name,
        command,
        args,
        env,
        source: "mcp",
      });
    }
  }

  return tools;
}

export function resolveHarnessProgram(
  spec: EnvironmentSpec,
  registry: RegistryTool[],
  target: RuntimeTarget,
): HarnessProgram {
  if (spec.program) {
    const registryTools = collectRegistryToolBindings(spec, registry);
    const program = registryTools.length === 0
      ? spec.program
      : {
          ...spec.program,
          tools: [...spec.program.tools, ...registryTools],
        };
    return {
      ...program,
      targets: [target],
    };
  }

  if (spec.ir) {
    const program = createHarnessProgramFromIR(spec.ir, { targets: [target] });
    const registryTools = collectRegistryToolBindings(spec, registry);
    return {
      ...program,
      tools: [...program.tools, ...registryTools],
    };
  }

  const instructions = hasNonEmptyBody(spec.harness.claude_md)
    ? [{
        id: "instruction:legacy",
        title: spec.name,
        body: spec.harness.claude_md,
        audience: "runtime" as const,
        source: "claude-md" as const,
      }]
    : [];

  const commands = Object.entries(spec.harness.commands ?? {}).map(
    ([name, body]) => ({
      id: `command:${name}`,
      name,
      summary: name,
      body,
      source: "command" as const,
    }),
  );

  const skills = Object.entries(spec.harness.skills ?? {}).map(
    ([name, instructions]) => ({
      id: `skill:${name}`,
      name,
      instructions,
    }),
  );

  const agents = Object.entries(spec.harness.agents ?? {}).map(
    ([name, instructions]) => ({
      id: `agent:${name}`,
      name,
      instructions,
      disallowedTools: [],
      metadata: {},
    }),
  );

  const tools = [
    ...Object.entries(spec.harness.mcp_config ?? {}).flatMap(([serverName, serverConfig]) => {
      if (!serverConfig || typeof serverConfig !== "object") return [];
      const config = serverConfig as Record<string, unknown>;
      return [{
        id: `tool:${serverName}`,
        kind: "mcp-server" as const,
        displayName: serverName,
        command: typeof config["command"] === "string" ? config["command"] : undefined,
        args: Array.isArray(config["args"])
          ? config["args"].filter((arg): arg is string => typeof arg === "string")
          : [],
        env: config["env"] && typeof config["env"] === "object"
          ? Object.fromEntries(
            Object.entries(config["env"] as Record<string, unknown>)
              .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          )
          : {},
        source: "mcp" as const,
      }];
    }),
    ...collectRegistryToolBindings(spec, registry),
  ];

  return {
    version: 1,
    meta: {
      name: spec.name,
      purpose: spec.description,
      techStack: { language: "" },
      autonomyLevel: spec.autonomy_level,
    },
    repo: { summary: spec.description, signals: {} },
    targets: [target],
    instructions,
    workflows: commands.map((command) => ({
      id: `workflow:${command.name}`,
      name: command.name,
      summary: command.summary,
      commandIds: [command.id],
      instructionIds: instructions.map((instruction) => instruction.id),
      verificationIds: [],
    })),
    commands,
    agents,
    skills,
    tools,
    permissions: { rules: [] },
    hooks: [],
    memory: { mode: "none", documents: [], instructions: [], hookIds: [] },
    verification: {
      checks: commands
        .filter((command) => /build|check|ci|e2e|lint|test|typecheck|verify/i.test(command.name))
        .map((command) => ({
          id: `verification:${command.name}`,
          name: command.name,
          commandId: command.id,
          source: "command" as const,
        })),
      instructionIds: [],
    },
    docs: Object.entries(spec.harness.docs ?? {}).map(([name, body]) => ({
      id: `doc:${name}`,
      title: name,
      body,
    })),
    compatibility: { source: "HarnessIR", version: 1 },
  };
}
