import type { HarnessProgram, PermissionRule, ToolBinding } from "../ir/program.js";
import {
  createRenderedHarness,
  renderedHarnessContentMap,
  writeRenderedHarness,
  type RenderedHarness,
  type RenderedHarnessEntry,
} from "../rendered-harness.js";
import type { EnvironmentSpec, RegistryTool } from "../types.js";
import { resolveHarnessProgram } from "./program.js";

type ForgeTool = "read" | "search" | "write" | "patch" | "shell" | "fetch";

const READ_ONLY_TOOLS: readonly ForgeTool[] = ["read", "search"];
const PLANNING_TOOLS: readonly ForgeTool[] = ["read", "search"];
const REVIEW_TOOLS: readonly ForgeTool[] = ["read", "search"];
const BUILD_TOOLS: readonly ForgeTool[] = ["read", "search", "write", "patch", "shell"];

function hasNonEmptyBody(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizeForgeId(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return sanitized || fallback;
}

function normalizeForgeText(content: string): string {
  return content
    .replace(/\/project:([A-Za-z0-9_-]+)/g, 'the "$1" workflow')
    .replace(/\.claude\/settings\.json/g, "forge.yaml")
    .replace(/\.codex\/config\.toml/g, "forge.yaml")
    .replace(/\.opencode\/agents\//g, ".forge/agents/")
    .replace(/\.claude\/agents\//g, ".forge/agents/")
    .replace(/\.codex\/agents\//g, ".forge/agents/")
    .replace(/\.opencode\/skills\//g, ".forge/skills/")
    .replace(/\.claude\/skills\//g, ".forge/skills/")
    .replace(/\.agents\/skills\//g, ".forge/skills/")
    .replace(/\.opencode\//g, ".forge/")
    .replace(/\.claude\//g, ".forge/")
    .replace(/\.codex\//g, ".forge/")
    .replace(/\bClaude Code\b/g, "ForgeCode")
    .replace(/\bCodex\b/g, "ForgeCode")
    .replace(/\bOpenCode\b/g, "ForgeCode");
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlBlock(key: string, value: string, indent = 0): string[] {
  const pad = " ".repeat(indent);
  const bodyPad = " ".repeat(indent + 2);
  const normalized = normalizeForgeText(value).trim();
  if (!normalized) return [`${pad}${key}: ""`];
  return [
    `${pad}${key}: |-`,
    ...normalized.split("\n").map((line) => `${bodyPad}${line}`),
  ];
}

function firstSentence(value: string, fallback: string): string {
  return normalizeForgeText(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?.replace(/^#+\s*/, "")
    .slice(0, 240) || fallback;
}

function renderStack(program: HarnessProgram): string {
  const stack = program.meta.techStack;
  return [
    stack.language && `- Language: ${stack.language}`,
    stack.framework && `- Framework: ${stack.framework}`,
    stack.buildTool && `- Build tool: ${stack.buildTool}`,
    stack.testRunner && `- Test runner: ${stack.testRunner}`,
    stack.packageManager && `- Package manager: ${stack.packageManager}`,
  ].filter(hasNonEmptyBody).join("\n");
}

function renderAgentsMd(program: HarnessProgram): string {
  const blocks: string[] = [`# ${program.meta.name || "Project"} ForgeCode Guide`];
  const purpose = normalizeForgeText(program.meta.purpose || program.repo.summary);
  if (purpose) {
    blocks.push(`## Purpose\n\n${purpose}`);
  }

  const stack = renderStack(program);
  if (stack) {
    blocks.push(`## Stack\n\n${stack}`);
  }

  const runtimeInstructions = program.instructions.filter(
    (instruction) => instruction.audience === "runtime" || instruction.audience === "agent",
  );
  if (runtimeInstructions.length > 0) {
    const instructionBody = runtimeInstructions
      .map((instruction) => {
        const body = normalizeForgeText(instruction.body.trim());
        return body ? `### ${instruction.title}\n\n${body}` : "";
      })
      .filter(hasNonEmptyBody)
      .join("\n\n");
    if (instructionBody) {
      blocks.push(`## Operating Rules\n\n${instructionBody}`);
    }
  }

  if (program.workflows.length > 0) {
    const workflowLines = program.workflows.map((workflow) => {
      const commands = workflow.commandIds
        .map((id) => program.commands.find((command) => command.id === id)?.name)
        .filter(hasNonEmptyBody);
      const suffix = commands.length > 0 ? ` Command references: ${commands.join(", ")}.` : "";
      return `- ${workflow.name}: ${normalizeForgeText(workflow.summary)}${suffix}`;
    });
    blocks.push(`## Workflows\n\n${workflowLines.join("\n")}`);
  }

  if (program.verification.checks.length > 0) {
    const checkLines = program.verification.checks.map((check) => {
      const command = check.commandId
        ? program.commands.find((candidate) => candidate.id === check.commandId)
        : undefined;
      if (command) return `- ${check.name}: use the ${command.name} workflow.`;
      if (check.instructions) return `- ${check.name}: ${normalizeForgeText(check.instructions)}`;
      return `- ${check.name}`;
    });
    blocks.push(`## Validation\n\n${checkLines.join("\n")}`);
  }

  if (program.agents.length > 0) {
    blocks.push(
      [
        "## Agents",
        "",
        ...program.agents.map((agent) => {
          const agentId = sanitizeForgeId(agent.name, "agent");
          return `- \`${agentId}\`: ${firstSentence(agent.instructions, agent.name)}`;
        }),
        "",
        "Project-specific ForgeCode agents live in `.forge/agents/`.",
      ].join("\n"),
    );
  }

  if (program.docs.length > 0) {
    blocks.push(`## Reference Docs\n\n${program.docs.map((doc) => `- ${doc.title}`).join("\n")}`);
  }

  return blocks.join("\n\n") + "\n";
}

function renderPermissionGuidance(rule: PermissionRule): string {
  const verb = rule.effect === "allow" ? "Allowed" : "Denied";
  return `- ${verb} by policy: \`${normalizeForgeText(rule.value)}\``;
}

function renderCustomRules(program: HarnessProgram): string {
  const blocks: string[] = [
    `Follow the project guidelines in AGENTS.md for ${program.meta.name || "this repository"}.`,
    "Keep file changes scoped to the current project unless explicit instructions say otherwise.",
    "Treat destructive shell commands and secret exposure as blocked by default.",
  ];

  if (program.permissions.rules.length > 0) {
    blocks.push(program.permissions.rules.map(renderPermissionGuidance).join("\n"));
  }

  if (program.memory.mode !== "none") {
    const docs = program.memory.documents.length > 0
      ? ` Documents: ${program.memory.documents.join(", ")}.`
      : "";
    blocks.push(`Memory policy is ${program.memory.mode}.${docs}`);
  }

  return blocks.join("\n\n");
}

function renderForgeYaml(program: HarnessProgram): string {
  const lines: string[] = [
    "# Generated by Kairn. Project-specific ForgeCode configuration.",
    ...yamlBlock("custom_rules", renderCustomRules(program)),
    "tool_supported: true",
  ];

  if (program.commands.length > 0) {
    lines.push("commands:");
    for (const command of program.commands) {
      lines.push(
        `  - name: ${yamlString(sanitizeForgeId(command.name, "command"))}`,
        `    description: ${yamlString(normalizeForgeText(command.summary || command.name))}`,
        ...yamlBlock("prompt", command.body, 4),
      );
    }
  }

  return lines.join("\n") + "\n";
}

function classifyAgentTools(agent: HarnessProgram["agents"][number]): readonly ForgeTool[] {
  const roleText = `${agent.name}\n${agent.instructions}`.toLowerCase();
  if (/\b(readonly|read-only|audit|analyst|research)\b/.test(roleText)) return READ_ONLY_TOOLS;
  if (/\b(review|critic|qa|security)\b/.test(roleText)) return REVIEW_TOOLS;
  if (/\b(plan|architect|design|strategy)\b/.test(roleText)) return PLANNING_TOOLS;
  return BUILD_TOOLS;
}

function removeDisallowedTools(
  allowedTools: readonly ForgeTool[],
  disallowedTools: readonly string[],
): ForgeTool[] {
  const disallowed = new Set(disallowedTools.map((tool) => tool.toLowerCase()));
  return allowedTools.filter((tool) => !disallowed.has(tool));
}

function renderAgent(agent: HarnessProgram["agents"][number]): string {
  const agentId = sanitizeForgeId(agent.name, "agent");
  const tools = removeDisallowedTools(classifyAgentTools(agent), agent.disallowedTools);
  const frontmatter = [
    "---",
    `id: ${yamlString(agentId)}`,
    `title: ${yamlString(agent.name)}`,
    `description: ${yamlString(firstSentence(agent.instructions, agent.name))}`,
    ...(agent.model ? [`model: ${yamlString(agent.model)}`] : []),
    "tools:",
    ...tools.map((tool) => `  - ${tool}`),
    "---",
  ];

  const disallowedTools = agent.disallowedTools.length > 0
    ? `\n\nDo not use these tools in this role: ${agent.disallowedTools.join(", ")}.`
    : "";

  return [
    ...frontmatter,
    "",
    `${normalizeForgeText(agent.instructions).trim()}${disallowedTools}`,
    "",
  ].join("\n");
}

function renderMcpReference(tool: ToolBinding): string | null {
  if (tool.kind !== "mcp-server" || !tool.command) return null;
  const args = tool.args.length > 0 ? ` ${tool.args.join(" ")}` : "";
  const env = Object.keys(tool.env).length > 0
    ? ` Env: ${Object.keys(tool.env).map((name) => `\`${name}\``).join(", ")}.`
    : "";
  return `- ${tool.displayName}: configure via \`${tool.command}${args}\`.${env}`;
}

function renderToolingDoc(program: HarnessProgram): string | null {
  const lines = program.tools
    .map(renderMcpReference)
    .filter((line): line is string => line !== null && line.trim().length > 0);
  if (lines.length === 0) return null;
  return [
    "# ForgeCode Tooling",
    "",
    "ForgeCode discovers available runtime tools from the active session. Configure these project MCP servers when available:",
    "",
    ...lines,
    "",
  ].join("\n");
}

export function buildForgeCodeFileMap(
  spec: EnvironmentSpec,
  registry: RegistryTool[] = [],
): Map<string, string> {
  return renderedHarnessContentMap(buildForgeCodeRenderedHarness(spec, registry));
}

export function buildForgeCodeRenderedHarness(
  spec: EnvironmentSpec,
  registry: RegistryTool[] = [],
): RenderedHarness {
  const program = resolveHarnessProgram(spec, registry, "forgecode");
  const files: RenderedHarnessEntry[] = [
    {
      path: "AGENTS.md",
      content: renderAgentsMd(program),
      source: "instructions",
    },
    {
      path: "forge.yaml",
      content: renderForgeYaml(program),
      source: "config",
    },
  ];

  for (const agent of program.agents) {
    const agentId = sanitizeForgeId(agent.name, "agent");
    files.push({
      path: `.forge/agents/${agentId}.md`,
      content: renderAgent(agent),
      source: "agents",
    });
  }

  const toolingDoc = renderToolingDoc(program);
  if (toolingDoc) {
    files.push({
      path: ".forge/TOOLING.md",
      content: toolingDoc,
      source: "mcp",
    });
  }

  return createRenderedHarness(files, { target: "forgecode", source: "environment-spec" });
}

export async function writeForgeCodeEnvironment(
  spec: EnvironmentSpec,
  registry: RegistryTool[],
  targetDir: string,
): Promise<string[]> {
  return writeRenderedHarness(buildForgeCodeRenderedHarness(spec, registry), targetDir);
}
