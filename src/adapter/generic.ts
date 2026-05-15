import type { HarnessProgram } from "../ir/program.js";
import {
  createRenderedHarness,
  renderedHarnessContentMap,
  writeRenderedHarness,
  type RenderedHarness,
  type RenderedHarnessEntry,
} from "../rendered-harness.js";
import type { EnvironmentSpec, RegistryTool } from "../types.js";
import { resolveHarnessProgram } from "./program.js";

function hasNonEmptyBody(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

function normalizePortableText(content: string): string {
  return content
    .replace(/\/project:([A-Za-z0-9_-]+)/g, 'workflow "$1"')
    .replace(/\.claude\/settings\.json/g, "runtime configuration")
    .replace(/\.codex\/config\.toml/g, "runtime configuration")
    .replace(/\.claude\//g, "runtime files/")
    .replace(/\.codex\//g, "runtime files/")
    .replace(/\bClaude Code\b/g, "the agent runtime")
    .replace(/\bCodex\b/g, "the agent runtime");
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
  const blocks: string[] = [`# ${program.meta.name || "Project"} Agent Guide`];
  const purpose = normalizePortableText(program.meta.purpose || program.repo.summary);

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
        const body = normalizePortableText(instruction.body.trim());
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
      return `- ${workflow.name}: ${normalizePortableText(workflow.summary)}${suffix}`;
    });
    blocks.push(`## Workflows\n\n${workflowLines.join("\n")}`);
  }

  const checks = program.verification.checks;
  if (checks.length > 0) {
    const checkLines = checks.map((check) => {
      const command = check.commandId
        ? program.commands.find((candidate) => candidate.id === check.commandId)
        : undefined;
      if (command) return `- ${check.name}: use the ${command.name} command reference.`;
      if (check.instructions) return `- ${check.name}: ${normalizePortableText(check.instructions)}`;
      return `- ${check.name}`;
    });
    blocks.push(`## Validation\n\n${checkLines.join("\n")}`);
  }

  const referenceLines = [
    program.commands.length > 0 ? "- Command references: `harness/commands/`" : undefined,
    program.workflows.length > 0 ? "- Workflow guide: `harness/workflows.md`" : undefined,
    program.permissions.rules.length > 0 ? "- Rule reference: `harness/rules.md`" : undefined,
    program.tools.length > 0 ? "- Tool guidance: `harness/tools.md`" : undefined,
    program.docs.length > 0 ? "- Project documents: `harness/docs/`" : undefined,
  ].filter(hasNonEmptyBody);
  if (referenceLines.length > 0) {
    blocks.push(`## Harness References\n\n${referenceLines.join("\n")}`);
  }

  return blocks.join("\n\n") + "\n";
}

function renderWorkflowGuide(program: HarnessProgram): string {
  const blocks = ["# Workflow Guide"];

  for (const workflow of program.workflows) {
    const commands = workflow.commandIds
      .map((id) => program.commands.find((command) => command.id === id))
      .filter((command): command is HarnessProgram["commands"][number] => command !== undefined);
    const checks = workflow.verificationIds
      .map((id) => program.verification.checks.find((check) => check.id === id))
      .filter((check): check is HarnessProgram["verification"]["checks"][number] => check !== undefined);
    const lines = [
      `## ${workflow.name}`,
      "",
      normalizePortableText(workflow.summary),
      commands.length > 0 ? `\nCommand references:\n${commands.map((command) => `- ${command.name}: harness/commands/${sanitizePathSegment(command.name, "command")}.md`).join("\n")}` : "",
      checks.length > 0 ? `\nValidation:\n${checks.map((check) => `- ${check.name}`).join("\n")}` : "",
    ].filter(hasNonEmptyBody);
    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n") + "\n";
}

function renderCommandReference(command: HarnessProgram["commands"][number]): string {
  return [
    `# ${command.name}`,
    "",
    "## Summary",
    "",
    normalizePortableText(command.summary || command.name),
    "",
    "## Procedure",
    "",
    normalizePortableText(command.body.trim()),
    "",
  ].join("\n");
}

function renderRules(program: HarnessProgram): string {
  const lines = ["# Rules", ""];

  const allowRules = program.permissions.rules.filter((rule) => rule.effect === "allow");
  const denyRules = program.permissions.rules.filter((rule) => rule.effect === "deny");
  if (allowRules.length > 0) {
    lines.push("## Allow", "", ...allowRules.map((rule) => `- ${normalizePortableText(rule.value)}`), "");
  }
  if (denyRules.length > 0) {
    lines.push("## Deny", "", ...denyRules.map((rule) => `- ${normalizePortableText(rule.value)}`), "");
  }

  for (const instruction of program.instructions.filter((candidate) => candidate.source === "rule")) {
    lines.push(`## ${instruction.title}`, "", normalizePortableText(instruction.body.trim()), "");
  }

  return lines.join("\n");
}

function renderTools(program: HarnessProgram): string {
  const lines = [
    "# Tool Guidance",
    "",
    "- Prefer repository-local commands and documented package scripts.",
    "- Keep generated files inside the project unless a tool description explicitly scopes output elsewhere.",
    "- Do not expose secret values; refer only to required environment variable names.",
  ];

  for (const tool of program.tools) {
    const details = [
      `- ${tool.displayName}`,
      tool.command ? `command: ${tool.command}` : "",
      tool.args.length > 0 ? `args: ${tool.args.join(" ")}` : "",
      Object.keys(tool.env).length > 0 ? `env: ${Object.keys(tool.env).join(", ")}` : "",
    ].filter(hasNonEmptyBody);
    lines.push(details.join("; "));
  }

  return lines.join("\n") + "\n";
}

function renderPeople(program: HarnessProgram): string | null {
  if (program.agents.length === 0 && program.skills.length === 0) return null;

  const lines = ["# Agent Roles And Skills", ""];
  if (program.agents.length > 0) {
    lines.push("## Roles", "", ...program.agents.map((agent) => `- ${agent.name}: ${normalizePortableText(agent.instructions).split("\n")[0] ?? agent.name}`), "");
  }
  if (program.skills.length > 0) {
    lines.push("## Skills", "", ...program.skills.map((skill) => `- ${skill.name}: ${normalizePortableText(skill.instructions).split("\n")[0] ?? skill.name}`), "");
  }

  return lines.join("\n");
}

export function buildGenericFileMap(
  spec: EnvironmentSpec,
  registry: RegistryTool[] = [],
): Map<string, string> {
  return renderedHarnessContentMap(buildGenericRenderedHarness(spec, registry));
}

export function buildGenericRenderedHarness(
  spec: EnvironmentSpec,
  registry: RegistryTool[] = [],
): RenderedHarness {
  const program = resolveHarnessProgram(spec, registry, "generic");
  const files: RenderedHarnessEntry[] = [{
    path: "AGENTS.md",
    content: renderAgentsMd(program),
    source: "instructions",
  }];

  if (program.workflows.length > 0) {
    files.push({
      path: "harness/workflows.md",
      content: renderWorkflowGuide(program),
      source: "workflows",
    });
  }

  for (const command of program.commands) {
    files.push({
      path: `harness/commands/${sanitizePathSegment(command.name, "command")}.md`,
      content: renderCommandReference(command),
      source: "commands",
    });
  }

  if (program.permissions.rules.length > 0 || program.instructions.some((instruction) => instruction.source === "rule")) {
    files.push({
      path: "harness/rules.md",
      content: renderRules(program),
      source: "rules",
    });
  }

  if (program.tools.length > 0) {
    files.push({
      path: "harness/tools.md",
      content: renderTools(program),
      source: "tools",
    });
  }

  const people = renderPeople(program);
  if (people) {
    files.push({
      path: "harness/roles-and-skills.md",
      content: people,
      source: "agents",
    });
  }

  for (const doc of program.docs) {
    files.push({
      path: `harness/docs/${sanitizePathSegment(doc.title, "doc")}.md`,
      content: normalizePortableText(doc.body.trim()) + "\n",
      source: "docs",
    });
  }

  return createRenderedHarness(files, { target: "generic", source: "environment-spec" });
}

export async function writeGenericEnvironment(
  spec: EnvironmentSpec,
  registry: RegistryTool[],
  targetDir: string,
): Promise<string[]> {
  return writeRenderedHarness(buildGenericRenderedHarness(spec, registry), targetDir);
}
