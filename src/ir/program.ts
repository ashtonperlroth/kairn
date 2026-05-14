/**
 * Target-neutral HarnessProgram IR.
 *
 * HarnessIR remains the compatibility representation for existing `.claude/`
 * harnesses. HarnessProgram is the semantic representation adapters can render
 * into runtime-specific files without coupling core compiler output to paths.
 */

import type { RuntimeTarget } from "../types.js";
import type {
  AgentNode,
  HarnessIR,
  HookEntry,
  HookNode,
  SettingsIR,
} from "./types.js";

export type HarnessProgramSource =
  | "claude-md"
  | "rule"
  | "command"
  | "agent"
  | "skill"
  | "hook"
  | "settings"
  | "mcp"
  | "doc";

export interface HarnessRepoFacts {
  summary: string;
  signals: Record<string, unknown>;
}

export interface InstructionBlock {
  id: string;
  title: string;
  body: string;
  audience: "runtime" | "agent" | "human";
  source: HarnessProgramSource;
}

export interface Workflow {
  id: string;
  name: string;
  summary: string;
  commandIds: string[];
  instructionIds: string[];
  verificationIds: string[];
}

export interface WorkflowCommand {
  id: string;
  name: string;
  summary: string;
  body: string;
  source: HarnessProgramSource;
}

export interface HarnessAgent {
  id: string;
  name: string;
  instructions: string;
  model?: string;
  disallowedTools: string[];
  modelRouting?: AgentNode["modelRouting"];
  metadata: Record<string, unknown>;
}

export interface HarnessSkill {
  id: string;
  name: string;
  instructions: string;
}

export interface ToolBinding {
  id: string;
  kind: "mcp-server" | "registry-tool" | "runtime";
  displayName: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  source: HarnessProgramSource;
}

export interface PermissionRule {
  effect: "allow" | "deny";
  value: string;
  source: HarnessProgramSource;
}

export interface PermissionPolicy {
  rules: PermissionRule[];
}

export interface HookHandler {
  type: HookNode["type"];
  command?: string;
  prompt?: string;
  timeout?: number;
  scriptId?: string;
  body?: string;
}

export interface HookPolicy {
  id: string;
  event?: keyof SettingsIR["hooks"];
  matcher?: string;
  handlers: HookHandler[];
  source: HarnessProgramSource;
}

export interface MemoryPolicy {
  mode: "none" | "documented" | "persistent";
  documents: string[];
  instructions: string[];
  hookIds: string[];
}

export interface VerificationCheck {
  id: string;
  name: string;
  commandId?: string;
  instructions?: string;
  source: HarnessProgramSource;
}

export interface VerificationPolicy {
  checks: VerificationCheck[];
  instructionIds: string[];
}

export interface HarnessDoc {
  id: string;
  title: string;
  body: string;
}

export interface HarnessProgram {
  version: 1;
  meta: HarnessIR["meta"];
  repo: HarnessRepoFacts;
  targets: RuntimeTarget[];
  instructions: InstructionBlock[];
  workflows: Workflow[];
  commands: WorkflowCommand[];
  agents: HarnessAgent[];
  skills: HarnessSkill[];
  tools: ToolBinding[];
  permissions: PermissionPolicy;
  hooks: HookPolicy[];
  memory: MemoryPolicy;
  verification: VerificationPolicy;
  docs: HarnessDoc[];
  compatibility: {
    source: "HarnessIR";
    version: 1;
  };
}

export interface HarnessProgramOptions {
  targets?: readonly RuntimeTarget[];
  repo?: Partial<HarnessRepoFacts>;
}

const DEFAULT_TARGETS: RuntimeTarget[] = ["claude-code"];

const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionStart",
  "PostCompact",
] as const satisfies ReadonlyArray<keyof SettingsIR["hooks"]>;

const VERIFICATION_COMMAND_NAMES = new Set([
  "build",
  "check",
  "ci",
  "e2e",
  "lint",
  "test",
  "typecheck",
  "verify",
]);

const MEMORY_DOC_NAMES = new Set([
  "DECISIONS",
  "LEARNINGS",
  "MEMORY",
  "PROGRESS",
  "TODO",
]);

function titleFromHeading(heading: string, fallback: string): string {
  const title = heading.replace(/^#+\s*/, "").trim();
  return title || fallback;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function cloneMeta(meta: HarnessIR["meta"]): HarnessIR["meta"] {
  return {
    ...meta,
    techStack: { ...meta.techStack },
  };
}

function collectPermissionRules(settings: SettingsIR): PermissionRule[] {
  const rules: PermissionRule[] = [];
  const rawPermissions = settings.raw["permissions"];
  const raw =
    rawPermissions && typeof rawPermissions === "object"
      ? (rawPermissions as Record<string, unknown>)
      : {};

  for (const value of asStringArray(raw["allow"])) {
    rules.push({ effect: "allow", value, source: "settings" });
  }

  for (const value of uniqueValues([
    ...asStringArray(raw["deny"]),
    ...(settings.denyPatterns ?? []),
  ])) {
    rules.push({ effect: "deny", value, source: "settings" });
  }

  return rules;
}

function convertHookEntry(
  event: keyof SettingsIR["hooks"],
  entry: HookEntry,
  index: number,
): HookPolicy {
  return {
    id: `hook:${event}:${index}`,
    event,
    matcher: entry.matcher,
    handlers: entry.hooks.map((handler) => ({
      type: handler.type,
      command: handler.command,
      prompt: handler.prompt,
      timeout: handler.timeout,
    })),
    source: "settings",
  };
}

function isVerificationCommand(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    VERIFICATION_COMMAND_NAMES.has(normalized) ||
    normalized.includes("test") ||
    normalized.includes("lint")
  );
}

function inferMemoryPolicy(
  ir: HarnessIR,
  instructions: InstructionBlock[],
  hooks: HookPolicy[],
): MemoryPolicy {
  const documents = ir.docs
    .map((doc) => doc.name)
    .filter((name) => MEMORY_DOC_NAMES.has(name.toUpperCase()));

  const memoryInstructions = instructions
    .filter((instruction) => /memory|continuity|decision|learning|todo/i.test(
      `${instruction.id}\n${instruction.title}\n${instruction.body}`,
    ))
    .map((instruction) => instruction.id);

  const hookIds = hooks
    .filter((hook) =>
      /memory|persist|SessionStart|PostCompact/i.test(
        `${hook.id}\n${hook.event ?? ""}\n${hook.matcher ?? ""}`,
      ),
    )
    .map((hook) => hook.id);

  const mode =
    hookIds.length > 0
      ? "persistent"
      : documents.length > 0 || memoryInstructions.length > 0
        ? "documented"
        : "none";

  return {
    mode,
    documents,
    instructions: memoryInstructions,
    hookIds,
  };
}

/**
 * Convert the compatibility HarnessIR shape into target-neutral HarnessProgram.
 *
 * The conversion is intentionally loss-tolerant: legacy target-specific details
 * are preserved as semantic bodies or handler commands, while the program's
 * structure avoids file path fields so adapters choose their own layout.
 */
export function createHarnessProgramFromIR(
  ir: HarnessIR,
  options: HarnessProgramOptions = {},
): HarnessProgram {
  const targets =
    options.targets && options.targets.length > 0
      ? [...options.targets]
      : [...DEFAULT_TARGETS];

  const instructions: InstructionBlock[] = [
    ...ir.sections.map((section) => ({
      id: `instruction:${section.id}`,
      title: titleFromHeading(section.heading, section.id),
      body: section.content,
      audience: "runtime" as const,
      source: "claude-md" as const,
    })),
    ...ir.rules.map((rule) => ({
      id: `rule:${rule.name}`,
      title: rule.name,
      body: rule.content,
      audience: "agent" as const,
      source: "rule" as const,
    })),
  ];

  const commands: WorkflowCommand[] = ir.commands.map((command) => ({
    id: `command:${command.name}`,
    name: command.name,
    summary: command.description || command.name,
    body: command.content,
    source: "command",
  }));

  const verificationChecks: VerificationCheck[] = [];
  for (const command of commands) {
    if (isVerificationCommand(command.name)) {
      verificationChecks.push({
        id: `verification:${command.name}`,
        name: command.name,
        commandId: command.id,
        source: "command",
      });
    }
  }

  const verificationInstructionIds = instructions
    .filter((instruction) => /verification|test|lint|build|check/i.test(
      `${instruction.id}\n${instruction.title}`,
    ))
    .map((instruction) => instruction.id);

  for (const instructionId of verificationInstructionIds) {
    const instruction = instructions.find((candidate) => candidate.id === instructionId);
    if (instruction) {
      verificationChecks.push({
        id: `verification:${instruction.id}`,
        name: instruction.title,
        instructions: instruction.body,
        source: instruction.source,
      });
    }
  }

  const workflows: Workflow[] = commands.map((command) => ({
    id: `workflow:${command.name}`,
    name: command.name,
    summary: command.summary,
    commandIds: [command.id],
    instructionIds: instructions
      .filter((instruction) => instruction.source === "claude-md")
      .map((instruction) => instruction.id),
    verificationIds: verificationChecks
      .filter((check) => check.commandId === command.id)
      .map((check) => check.id),
  }));

  const agents: HarnessAgent[] = ir.agents.map((agent) => ({
    id: `agent:${agent.name}`,
    name: agent.name,
    instructions: agent.content,
    model: agent.model,
    disallowedTools: agent.disallowedTools ?? [],
    modelRouting: agent.modelRouting,
    metadata: { ...(agent.extraFrontmatter ?? {}) },
  }));

  const skills: HarnessSkill[] = ir.skills.map((skill) => ({
    id: `skill:${skill.name}`,
    name: skill.name,
    instructions: skill.content,
  }));

  const tools: ToolBinding[] = ir.mcpServers.map((server) => ({
    id: `tool:${server.id}`,
    kind: "mcp-server",
    displayName: server.id,
    command: server.command,
    args: [...server.args],
    env: { ...(server.env ?? {}) },
    source: "mcp",
  }));

  const hooks: HookPolicy[] = [];
  for (const event of HOOK_EVENTS) {
    const entries = ir.settings.hooks[event] ?? [];
    entries.forEach((entry, index) => {
      hooks.push(convertHookEntry(event, entry, index));
    });
  }
  for (const hook of ir.hooks) {
    hooks.push({
      id: `hook:${hook.name}`,
      handlers: [
        {
          type: hook.type,
          scriptId: hook.name,
          body: hook.content,
        },
      ],
      source: "hook",
    });
  }

  const docs: HarnessDoc[] = ir.docs.map((doc) => ({
    id: `doc:${doc.name}`,
    title: doc.name,
    body: doc.content,
  }));

  return {
    version: 1,
    meta: cloneMeta(ir.meta),
    repo: {
      summary: options.repo?.summary ?? "",
      signals: options.repo?.signals ?? {},
    },
    targets,
    instructions,
    workflows,
    commands,
    agents,
    skills,
    tools,
    permissions: {
      rules: collectPermissionRules(ir.settings),
    },
    hooks,
    memory: inferMemoryPolicy(ir, instructions, hooks),
    verification: {
      checks: verificationChecks,
      instructionIds: verificationInstructionIds,
    },
    docs,
    compatibility: {
      source: "HarnessIR",
      version: 1,
    },
  };
}

export const convertHarnessIRToProgram = createHarnessProgramFromIR;
