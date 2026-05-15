import fs from "fs/promises";
import path from "path";
import { createHarnessProgramFromIR, type HarnessProgram } from "../ir/program.js";
import type { EnvironmentSpec, RegistryTool } from "../types.js";

const DEFAULT_SANDBOX_MODE = "workspace-write";
const DEFAULT_APPROVAL_POLICY = "on-request";

function sanitizeIdentifier(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

function normalizeCodexText(content: string): string {
  return content
    .replace(/\/project:([A-Za-z0-9_-]+)/g, 'workflow "$1"')
    .replace(/\.claude\/settings\.json/g, ".codex/config.toml")
    .replace(/\.claude\//g, ".codex/");
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function renderMultilineTomlString(value: string): string {
  return `"""${value.replace(/"""/g, '\\"\\"\\"')}"""`;
}

function hasNonEmptyBody(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function collectRegistryToolBindings(
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

function resolveProgram(
  spec: EnvironmentSpec,
  registry: RegistryTool[],
): HarnessProgram {
  if (spec.program) {
    const registryTools = collectRegistryToolBindings(spec, registry);
    if (registryTools.length === 0) return spec.program;
    return {
      ...spec.program,
      tools: [...spec.program.tools, ...registryTools],
    };
  }

  if (spec.ir) {
    const program = createHarnessProgramFromIR(spec.ir, { targets: ["codex"] });
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
    targets: ["codex"],
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

function renderAgentsMd(program: HarnessProgram): string {
  const blocks: string[] = [];
  const projectName = program.meta.name || "Project";
  blocks.push(`# ${projectName} Agent Guide`);

  if (program.meta.purpose || program.repo.summary) {
    blocks.push(`## Purpose\n\n${normalizeCodexText(program.meta.purpose || program.repo.summary)}`);
  }

  const stack = program.meta.techStack;
  const stackLines = [
    stack.language && `- Language: ${stack.language}`,
    stack.framework && `- Framework: ${stack.framework}`,
    stack.buildTool && `- Build tool: ${stack.buildTool}`,
    stack.testRunner && `- Test runner: ${stack.testRunner}`,
    stack.packageManager && `- Package manager: ${stack.packageManager}`,
  ].filter(hasNonEmptyBody);
  if (stackLines.length > 0) {
    blocks.push(`## Stack\n\n${stackLines.join("\n")}`);
  }

  const runtimeInstructions = program.instructions.filter(
    (instruction) => instruction.audience === "runtime" || instruction.audience === "agent",
  );
  if (runtimeInstructions.length > 0) {
    const instructionBody = runtimeInstructions
      .map((instruction) => {
        const body = normalizeCodexText(instruction.body.trim());
        return body ? `### ${instruction.title}\n\n${body}` : "";
      })
      .filter(hasNonEmptyBody)
      .join("\n\n");
    if (instructionBody) {
      blocks.push(`## Instructions\n\n${instructionBody}`);
    }
  }

  if (program.commands.length > 0) {
    const workflowLines = program.commands.map((command) => {
      const summary = normalizeCodexText(command.summary || command.name);
      const body = normalizeCodexText(command.body.trim());
      return [
        `### ${command.name}`,
        "",
        summary,
        body ? `\n${body}` : "",
      ].join("\n").trim();
    });
    blocks.push(`## Workflows\n\n${workflowLines.join("\n\n")}`);
  }

  const checks = program.verification.checks;
  if (checks.length > 0) {
    const checkLines = checks.map((check) => {
      const command = check.commandId
        ? program.commands.find((candidate) => candidate.id === check.commandId)
        : undefined;
      if (command) return `- Run the ${command.name} workflow: ${normalizeCodexText(command.summary)}`;
      if (check.instructions) return `- ${check.name}: ${normalizeCodexText(check.instructions)}`;
      return `- ${check.name}`;
    });
    blocks.push(`## Validation\n\n${checkLines.join("\n")}`);
  }

  const allowRules = program.permissions.rules.filter((rule) => rule.effect === "allow");
  const denyRules = program.permissions.rules.filter((rule) => rule.effect === "deny");
  const policyLines = [
    `- Default sandbox: \`${DEFAULT_SANDBOX_MODE}\`. Stay inside the workspace unless the user explicitly changes the Codex sandbox.`,
    `- Default approval policy: \`${DEFAULT_APPROVAL_POLICY}\`. Request approval before commands that need elevated filesystem, network, or security-sensitive access.`,
    "- Treat destructive shell commands and secret exposure as blocked unless the repository instructions explicitly allow them.",
    ...allowRules.map((rule) => `- Allowed by policy: \`${normalizeCodexText(rule.value)}\``),
    ...denyRules.map((rule) => `- Denied by policy: \`${normalizeCodexText(rule.value)}\``),
  ];
  blocks.push(`## Sandbox And Approvals\n\n${policyLines.join("\n")}`);

  const toolLines = [
    "- Prefer fast local search such as `rg` before broad file reads.",
    "- Use structured project commands and package scripts when available.",
    "- Keep generated artifacts scoped to this repository unless a tool configuration below says otherwise.",
    ...program.tools.map((tool) => {
      const command = tool.command ? ` via \`${tool.command}${tool.args.length > 0 ? ` ${tool.args.join(" ")}` : ""}\`` : "";
      const envVars = Object.keys(tool.env);
      const envSuffix = envVars.length > 0 ? ` Env: ${envVars.map((name) => `\`${name}\``).join(", ")}.` : "";
      return `- ${tool.displayName}${command}.${envSuffix}`;
    }),
  ];
  blocks.push(`## Tool Usage\n\n${toolLines.join("\n")}`);

  if (program.agents.length > 0) {
    const agentLines = program.agents.map(
      (agent) => `- \`${agent.name}\`: ${normalizeCodexText(agent.instructions).split("\n")[0] ?? agent.name}`,
    );
    blocks.push(`## Subagents\n\n${agentLines.join("\n")}\n\nCustom agent definitions live in \`.codex/agents/\` for Codex subagent workflows.`);
  }

  if (program.skills.length > 0) {
    const skillLines = program.skills.map((skill) => `- \`${skill.name}\``);
    blocks.push(`## Skills\n\n${skillLines.join("\n")}\n\nRepository skills live in \`.agents/skills/\` and should be invoked when their descriptions match the task.`);
  }

  if (program.docs.length > 0) {
    const docLines = program.docs.map((doc) => `- ${doc.title}`);
    blocks.push(`## Reference Docs\n\n${docLines.join("\n")}`);
  }

  return blocks.join("\n\n") + "\n";
}

function renderCodexConfig(program: HarnessProgram): string {
  const lines: string[] = [
    `sandbox_mode = ${tomlString(DEFAULT_SANDBOX_MODE)}`,
    `approval_policy = ${tomlString(DEFAULT_APPROVAL_POLICY)}`,
    "",
    "[sandbox_workspace_write]",
    "network_access = false",
  ];

  if (program.agents.length > 0) {
    lines.push("", "[agents]", "max_threads = 6", "max_depth = 1");
    for (const agent of program.agents) {
      const agentId = sanitizeIdentifier(agent.name, "agent");
      lines.push(
        "",
        `[agents.${agentId}]`,
        `description = ${tomlString(normalizeCodexText(agent.instructions).split("\n")[0] || agent.name)}`,
        `config_file = ${tomlString(`agents/${agentId}.toml`)}`,
      );
    }
  }

  for (const tool of program.tools.filter((candidate) => candidate.kind === "mcp-server" && candidate.command)) {
    const serverId = sanitizeIdentifier(tool.id.replace(/^tool:/, ""), "server");
    lines.push("", `[mcp_servers.${serverId}]`, `command = ${tomlString(tool.command!)}`);
    if (tool.args.length > 0) {
      lines.push(`args = ${tomlStringArray(tool.args)}`);
    }
    const envEntries = Object.entries(tool.env);
    if (envEntries.length > 0) {
      lines.push(`[mcp_servers.${serverId}.env]`);
      for (const [name, value] of envEntries) {
        lines.push(`${name} = ${tomlString(value)}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

function renderSkill(skill: HarnessProgram["skills"][number]): string {
  const name = sanitizeIdentifier(skill.name, "skill");
  const description = normalizeCodexText(skill.instructions)
    .split("\n")
    .find((line) => line.trim().length > 0)
    ?.replace(/^#+\s*/, "")
    .slice(0, 180) || `Use for ${skill.name} work.`;

  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    normalizeCodexText(skill.instructions).trim(),
    "",
  ].join("\n");
}

function renderAgent(agent: HarnessProgram["agents"][number]): string {
  const lines = [
    `name = ${tomlString(sanitizeIdentifier(agent.name, "agent"))}`,
    `description = ${tomlString(normalizeCodexText(agent.instructions).split("\n")[0] || agent.name)}`,
  ];

  if (agent.model) {
    lines.push(`model = ${tomlString(agent.model)}`);
  }

  const disallowedTools = agent.disallowedTools.length > 0
    ? `\n\nDo not use these tools in this role: ${agent.disallowedTools.join(", ")}.`
    : "";

  lines.push(`developer_instructions = ${renderMultilineTomlString(`${normalizeCodexText(agent.instructions).trim()}${disallowedTools}`)}`);
  return lines.join("\n") + "\n";
}

function renderMcpJson(program: HarnessProgram): string | null {
  const servers: Record<string, unknown> = {};

  for (const tool of program.tools.filter((candidate) => candidate.kind === "mcp-server" && candidate.command)) {
    const serverId = sanitizeIdentifier(tool.id.replace(/^tool:/, ""), "server");
    servers[serverId] = {
      command: tool.command,
      args: tool.args,
      ...(Object.keys(tool.env).length > 0 ? { env: tool.env } : {}),
    };
  }

  if (Object.keys(servers).length === 0) return null;
  return JSON.stringify({ mcpServers: servers }, null, 2) + "\n";
}

export function buildCodexFileMap(
  spec: EnvironmentSpec,
  registry: RegistryTool[] = [],
): Map<string, string> {
  const program = resolveProgram(spec, registry);
  const files = new Map<string, string>();

  files.set("AGENTS.md", renderAgentsMd(program));
  files.set(".codex/config.toml", renderCodexConfig(program));

  for (const skill of program.skills) {
    const skillId = sanitizeIdentifier(skill.name, "skill");
    files.set(`.agents/skills/${skillId}/SKILL.md`, renderSkill(skill));
  }

  for (const agent of program.agents) {
    const agentId = sanitizeIdentifier(agent.name, "agent");
    files.set(`.codex/agents/${agentId}.toml`, renderAgent(agent));
  }

  const mcpJson = renderMcpJson(program);
  if (mcpJson) {
    files.set(".mcp.json", mcpJson);
  }

  return files;
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

export async function writeCodexEnvironment(
  spec: EnvironmentSpec,
  registry: RegistryTool[],
  targetDir: string,
): Promise<string[]> {
  const files = buildCodexFileMap(spec, registry);
  const written: string[] = [];

  for (const [relativePath, content] of files) {
    await writeFile(path.join(targetDir, relativePath), content);
    written.push(relativePath);
  }

  return written;
}
