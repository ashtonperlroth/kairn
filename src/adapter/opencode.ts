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

type OpenCodePermissionAction = "allow" | "ask" | "deny";
type OpenCodePatternPermission = Record<string, OpenCodePermissionAction>;
type OpenCodePermissionValue = OpenCodePermissionAction | OpenCodePatternPermission;
type OpenCodePermission = Record<string, OpenCodePermissionValue>;

interface OpenCodeAgentProfile {
  readonly id: string;
  readonly description: string;
  readonly mode: "primary" | "subagent";
  readonly hidden?: boolean;
  readonly prompt: string;
  readonly permission: OpenCodePermission;
}

interface OpenCodeProgramAgentProfile {
  readonly id: string;
  readonly agent: HarnessProgram["agents"][number];
  readonly permission: OpenCodePermission;
}

const CONFIG_SCHEMA = "https://opencode.ai/config.json";
const BUILT_IN_AGENT_IDS = ["plan", "build", "review", "readonly"] as const;

function hasNonEmptyBody(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizeOpenCodeName(value: string, fallback: string): string {
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

function normalizeOpenCodeText(content: string): string {
  return content
    .replace(/\/project:([A-Za-z0-9_-]+)/g, 'workflow "$1"')
    .replace(/\.claude\/settings\.json/g, "opencode.json")
    .replace(/\.codex\/config\.toml/g, "opencode.json")
    .replace(/\.claude\/agents\//g, ".opencode/agents/")
    .replace(/\.claude\/skills\//g, ".opencode/skills/")
    .replace(/\.codex\/agents\//g, ".opencode/agents/")
    .replace(/\.agents\/skills\//g, ".opencode/skills/")
    .replace(/\.claude\//g, ".opencode/")
    .replace(/\.codex\//g, ".opencode/")
    .replace(/\bClaude Code\b/g, "OpenCode")
    .replace(/\bCodex\b/g, "OpenCode");
}

function jsonStringify(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function yamlString(value: string): string {
  return JSON.stringify(value);
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

function renderInstructions(program: HarnessProgram): string {
  const blocks: string[] = [`# ${program.meta.name || "Project"} OpenCode Instructions`];
  const purpose = normalizeOpenCodeText(program.meta.purpose || program.repo.summary);
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
        const body = normalizeOpenCodeText(instruction.body.trim());
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
      return `- ${workflow.name}: ${normalizeOpenCodeText(workflow.summary)}${suffix}`;
    });
    blocks.push(`## Workflows\n\n${workflowLines.join("\n")}`);
  }

  if (program.verification.checks.length > 0) {
    const checkLines = program.verification.checks.map((check) => {
      const command = check.commandId
        ? program.commands.find((candidate) => candidate.id === check.commandId)
        : undefined;
      if (command) return `- ${check.name}: use the ${command.name} workflow.`;
      if (check.instructions) return `- ${check.name}: ${normalizeOpenCodeText(check.instructions)}`;
      return `- ${check.name}`;
    });
    blocks.push(`## Validation\n\n${checkLines.join("\n")}`);
  }

  if (program.docs.length > 0) {
    blocks.push(`## Reference Docs\n\n${program.docs.map((doc) => `- ${doc.title}`).join("\n")}`);
  }

  return blocks.join("\n\n") + "\n";
}

function defaultGlobalPermission(): OpenCodePermission {
  return {
    read: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    lsp: "allow",
    skill: "allow",
    todowrite: "allow",
    question: "allow",
    task: "ask",
    edit: "ask",
    bash: {
      "*": "ask",
      "git status*": "allow",
      "git diff*": "allow",
      "git log*": "allow",
      "rm -rf *": "deny",
    },
    external_directory: "deny",
    webfetch: "ask",
    websearch: "ask",
    doom_loop: "ask",
  };
}

function planningPermission(): OpenCodePermission {
  return {
    read: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    lsp: "allow",
    skill: "allow",
    todowrite: "allow",
    question: "allow",
    task: {
      "*": "deny",
      "build": "ask",
      "review": "ask",
      "readonly": "allow",
    },
    edit: "deny",
    bash: "deny",
    external_directory: "deny",
    webfetch: "ask",
    websearch: "ask",
  };
}

function buildPermission(): OpenCodePermission {
  return {
    read: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    lsp: "allow",
    skill: "allow",
    todowrite: "allow",
    question: "allow",
    task: "ask",
    edit: "ask",
    bash: {
      "*": "ask",
      "git status*": "allow",
      "git diff*": "allow",
      "git log*": "allow",
      "npm test*": "ask",
      "npm run build*": "ask",
      "rm -rf *": "deny",
    },
    external_directory: "deny",
    webfetch: "ask",
    websearch: "ask",
  };
}

function reviewPermission(): OpenCodePermission {
  return {
    read: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    lsp: "allow",
    skill: "allow",
    todowrite: "allow",
    question: "allow",
    task: "deny",
    edit: "deny",
    bash: {
      "*": "ask",
      "git status*": "allow",
      "git diff*": "allow",
      "git log*": "allow",
      "npm test*": "ask",
    },
    external_directory: "deny",
    webfetch: "ask",
    websearch: "ask",
  };
}

function readOnlyPermission(): OpenCodePermission {
  return {
    read: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    lsp: "allow",
    skill: "allow",
    todowrite: "deny",
    question: "allow",
    task: "deny",
    edit: "deny",
    bash: "deny",
    external_directory: "deny",
    webfetch: "ask",
    websearch: "ask",
  };
}

function extractBashPattern(value: string): string | null {
  const match = value.match(/^Bash\((.*)\)$/i);
  return match?.[1]?.trim() || null;
}

function applyPermissionRule(permission: OpenCodePermission, rule: PermissionRule): void {
  const action = rule.effect === "allow" ? "allow" : "deny";
  const bashPattern = extractBashPattern(rule.value);
  if (bashPattern) {
    const current = permission["bash"];
    if (current === action) return;
    permission["bash"] = {
      ...(typeof current === "object" ? current : { "*": current ?? "ask" }),
      [bashPattern]: action,
    };
    return;
  }

  const normalized = rule.value.trim().toLowerCase();
  if (normalized in permission) {
    permission[normalized] = action;
  }
}

function mergeProgramPermissionRules(permission: OpenCodePermission, program: HarnessProgram): OpenCodePermission {
  const merged: OpenCodePermission = { ...permission };
  for (const rule of program.permissions.rules) {
    applyPermissionRule(merged, rule);
  }
  return merged;
}

function builtInAgentProfiles(program: HarnessProgram): OpenCodeAgentProfile[] {
  return [
    {
      id: "plan",
      description: "Plan work, inspect context, and delegate implementation only after the approach is clear.",
      mode: "primary",
      prompt: "You are the planning agent. Analyze the repository, identify risks, maintain TODOs, and avoid modifying files directly.",
      permission: mergeProgramPermissionRules(planningPermission(), program),
    },
    {
      id: "build",
      description: "Implement changes, run validation, and keep edits scoped to the requested work.",
      mode: "primary",
      prompt: "You are the build agent. Make focused code changes, run the documented validation commands, and keep generated files inside the project.",
      permission: mergeProgramPermissionRules(buildPermission(), program),
    },
    {
      id: "review",
      description: "Review code for regressions, security issues, and missing tests without editing files.",
      mode: "subagent",
      prompt: "You are the review agent. Inspect diffs and source files, report concrete findings first, and do not modify files.",
      permission: mergeProgramPermissionRules(reviewPermission(), program),
    },
    {
      id: "readonly",
      description: "Read repository context and answer questions without running shell commands or editing files.",
      mode: "subagent",
      hidden: true,
      prompt: "You are the read-only agent. Use only reading and search capabilities; do not run shell commands or modify files.",
      permission: mergeProgramPermissionRules(readOnlyPermission(), program),
    },
  ];
}

function uniqueOpenCodeName(value: string, fallback: string, used: Set<string>): string {
  const base = sanitizeOpenCodeName(value, fallback);
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = sanitizeOpenCodeName(`${base}-${index}`, fallback);
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function programAgentProfiles(program: HarnessProgram): OpenCodeProgramAgentProfile[] {
  const used = new Set<string>(BUILT_IN_AGENT_IDS);
  return program.agents.map((agent) => ({
    id: uniqueOpenCodeName(agent.name, "agent", used),
    agent,
    permission: classifyAgentPermission(agent),
  }));
}

function classifyAgentPermission(agent: HarnessProgram["agents"][number]): OpenCodePermission {
  const roleText = `${agent.name}\n${agent.instructions}`.toLowerCase();
  if (/\b(readonly|read-only|audit|analyst|research)\b/.test(roleText)) return readOnlyPermission();
  if (/\b(review|critic|qa|security)\b/.test(roleText)) return reviewPermission();
  if (/\b(plan|architect|design|strategy)\b/.test(roleText)) return planningPermission();
  return buildPermission();
}

function firstSentence(value: string, fallback: string): string {
  return normalizeOpenCodeText(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?.replace(/^#+\s*/, "")
    .slice(0, 240) || fallback;
}

function renderAgentMarkdown(profile: OpenCodeAgentProfile): string {
  const frontmatter = [
    "---",
    `description: ${yamlString(profile.description)}`,
    `mode: ${profile.mode}`,
    ...(profile.hidden ? ["hidden: true"] : []),
    "permission:",
    ...renderPermissionYaml(profile.permission, 2),
    "---",
  ];

  return [
    ...frontmatter,
    "",
    normalizeOpenCodeText(profile.prompt).trim(),
    "",
  ].join("\n");
}

function renderProgramAgent(profile: OpenCodeProgramAgentProfile): string {
  const { agent, permission } = profile;
  const frontmatter = [
    "---",
    `description: ${yamlString(firstSentence(agent.instructions, agent.name))}`,
    "mode: subagent",
    ...(agent.model ? [`model: ${yamlString(agent.model)}`] : []),
    "permission:",
    ...renderPermissionYaml(permission, 2),
    "---",
  ];
  const disallowedTools = agent.disallowedTools.length > 0
    ? `\n\nDo not use these tools in this role: ${agent.disallowedTools.join(", ")}.`
    : "";

  return [
    ...frontmatter,
    "",
    `${normalizeOpenCodeText(agent.instructions).trim()}${disallowedTools}`,
    "",
  ].join("\n");
}

function renderPermissionYaml(permission: OpenCodePermission, indent: number): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      lines.push(`${pad}${key}: ${value}`);
      continue;
    }

    lines.push(`${pad}${key}:`);
    for (const [pattern, action] of Object.entries(value)) {
      lines.push(`${pad}  ${yamlString(pattern)}: ${action}`);
    }
  }
  return lines;
}

function renderSkill(skill: HarnessProgram["skills"][number]): string {
  const name = sanitizeOpenCodeName(skill.name, "skill");
  const description = firstSentence(skill.instructions, `Use for ${skill.name} work.`);

  return [
    "---",
    `name: ${name}`,
    `description: ${yamlString(description)}`,
    "---",
    "",
    normalizeOpenCodeText(skill.instructions).trim(),
    "",
  ].join("\n");
}

function renderMcp(tool: ToolBinding): Record<string, unknown> | null {
  if (tool.kind !== "mcp-server" || !tool.command) return null;
  return {
    type: "local",
    command: [tool.command, ...tool.args],
    ...(Object.keys(tool.env).length > 0 ? { environment: tool.env } : {}),
    enabled: true,
  };
}

function renderOpenCodeConfig(program: HarnessProgram): string {
  const customAgents = programAgentProfiles(program);
  const agentConfig: Record<string, Record<string, unknown>> = Object.fromEntries(
    builtInAgentProfiles(program).map((profile) => [
      profile.id,
      {
        description: profile.description,
        mode: profile.mode,
        ...(profile.hidden ? { hidden: true } : {}),
        prompt: profile.prompt,
        permission: profile.permission,
      },
    ]),
  );

  for (const profile of customAgents) {
    agentConfig[profile.id] = {
      description: firstSentence(profile.agent.instructions, profile.agent.name),
      mode: "subagent",
      permission: profile.permission,
    };
  }

  const mcpEntries = Object.fromEntries(
    program.tools
      .map((tool) => [sanitizeOpenCodeName(tool.id.replace(/^tool:/, ""), "server"), renderMcp(tool)] as const)
      .filter((entry): entry is readonly [string, Record<string, unknown>] => entry[1] !== null),
  );

  const config: Record<string, unknown> = {
    "$schema": CONFIG_SCHEMA,
    default_agent: "plan",
    instructions: [".opencode/instructions.md"],
    permission: mergeProgramPermissionRules(defaultGlobalPermission(), program),
    agent: agentConfig,
  };

  if (Object.keys(mcpEntries).length > 0) {
    config["mcp"] = mcpEntries;
  }

  return jsonStringify(config);
}

export function buildOpenCodeFileMap(
  spec: EnvironmentSpec,
  registry: RegistryTool[] = [],
): Map<string, string> {
  return renderedHarnessContentMap(buildOpenCodeRenderedHarness(spec, registry));
}

export function buildOpenCodeRenderedHarness(
  spec: EnvironmentSpec,
  registry: RegistryTool[] = [],
): RenderedHarness {
  const program = resolveHarnessProgram(spec, registry, "opencode");
  const files: RenderedHarnessEntry[] = [
    {
      path: "opencode.json",
      content: renderOpenCodeConfig(program),
      source: "config",
    },
    {
      path: ".opencode/instructions.md",
      content: renderInstructions(program),
      source: "instructions",
    },
  ];

  for (const profile of builtInAgentProfiles(program)) {
    files.push({
      path: `.opencode/agents/${profile.id}.md`,
      content: renderAgentMarkdown(profile),
      source: "agents",
    });
  }

  for (const profile of programAgentProfiles(program)) {
    files.push({
      path: `.opencode/agents/${profile.id}.md`,
      content: renderProgramAgent(profile),
      source: "agents",
    });
  }

  for (const skill of program.skills) {
    const skillId = sanitizeOpenCodeName(skill.name, "skill");
    files.push({
      path: `.opencode/skills/${skillId}/SKILL.md`,
      content: renderSkill(skill),
      source: "skills",
    });
  }

  return createRenderedHarness(files, { target: "opencode", source: "environment-spec" });
}

export async function writeOpenCodeEnvironment(
  spec: EnvironmentSpec,
  registry: RegistryTool[],
  targetDir: string,
): Promise<string[]> {
  return writeRenderedHarness(buildOpenCodeRenderedHarness(spec, registry), targetDir);
}
