import os from "os";
import type { EnvironmentSpec, RegistryTool, RuntimeTarget } from "../types.js";
import { RUNTIME_TARGETS } from "../types.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { buildCodexFileMap, buildCodexRenderedHarness, writeCodexEnvironment } from "./codex.js";
import { buildGenericFileMap, buildGenericRenderedHarness, writeGenericEnvironment } from "./generic.js";
import { buildHermesRenderedHarness, writeHermesEnvironment } from "./hermes-agent.js";
import { buildOpenCodeFileMap, buildOpenCodeRenderedHarness, writeOpenCodeEnvironment } from "./opencode.js";
import type { RenderedHarness } from "../rendered-harness.js";

export type EnvSetupStrategy = "project-env-file" | "external";
export type PluginInstructionStrategy = "project-cli" | "external";
export type AdapterValidationSeverity = "warning" | "error";

export interface RuntimeWriteContext {
  spec: EnvironmentSpec;
  registry: RegistryTool[];
  targetDir: string;
}

export interface RuntimeAdapterCapabilities {
  commands: boolean;
  hooks: {
    supported: boolean;
    events?: string[];
    handlerTypes?: Array<"command" | "prompt">;
  };
  tools: {
    mcpServers: boolean;
    commandRequired?: boolean;
  };
  agents: boolean;
  skills: boolean;
  docs: boolean;
  permissions: boolean;
  memory: boolean;
  limitations: string[];
}

export interface AdapterValidationIssue {
  severity: AdapterValidationSeverity;
  target: RuntimeTarget;
  feature: string;
  message: string;
}

export interface RuntimeAdapter {
  target: RuntimeTarget;
  displayName: string;
  aliases: string[];
  launchCommand: string;
  envSetupStrategy: EnvSetupStrategy;
  pluginInstructionStrategy: PluginInstructionStrategy;
  capabilities: RuntimeAdapterCapabilities;
  render: (context: RuntimeWriteContext) => RenderedHarness;
  resolveTargetRoot?: (context: RuntimeWriteContext) => string;
  buildFileMap?: (context: RuntimeWriteContext) => Map<string, string>;
  write: (context: RuntimeWriteContext) => Promise<string[]>;
}

export class AdapterCompatibilityError extends Error {
  constructor(
    public readonly adapter: RuntimeAdapter,
    public readonly issues: AdapterValidationIssue[],
  ) {
    super(
      `Runtime target "${adapter.target}" does not support this harness: ${issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
    this.name = "AdapterCompatibilityError";
  }
}

export class UnknownRuntimeTargetError extends Error {
  constructor(
    public readonly input: string,
    public readonly knownTargets: readonly RuntimeTarget[],
  ) {
    super(
      `Unknown runtime target "${input}". Supported targets: ${knownTargets.join(", ")}.`,
    );
    this.name = "UnknownRuntimeTargetError";
  }
}

export class UnsupportedRuntimeTargetError extends Error {
  constructor(
    public readonly target: RuntimeTarget,
    public readonly registeredTargets: readonly RuntimeTarget[],
  ) {
    super(
      `Runtime target "${target}" is recognized, but no adapter is registered yet. Registered adapters: ${registeredTargets.join(", ")}.`,
    );
    this.name = "UnsupportedRuntimeTargetError";
  }
}

const RUNTIME_ALIASES: ReadonlyArray<readonly [string, RuntimeTarget]> = [
  ["default", "generic"],
  ["claude", "claude-code"],
  ["claude-code", "claude-code"],
  ["claude_code", "claude-code"],
  ["claudecode", "claude-code"],
  ["cc", "claude-code"],
  ["codex-cli", "codex"],
  ["openai-codex", "codex"],
  ["open-code", "opencode"],
  ["open_code", "opencode"],
  ["opencode", "opencode"],
  ["forge-code", "forgecode"],
  ["forge_code", "forgecode"],
  ["forgecode", "forgecode"],
  ["hermes-agent", "hermes"],
];

const aliasToTarget = new Map<string, RuntimeTarget>();
const adapterRegistry = new Map<RuntimeTarget, RuntimeAdapter>();

function canonicalizeRuntimeInput(input: string): string {
  return input.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function compactRuntimeInput(input: string): string {
  return canonicalizeRuntimeInput(input).replace(/-/g, "");
}

function registerAlias(alias: string, target: RuntimeTarget): void {
  aliasToTarget.set(canonicalizeRuntimeInput(alias), target);
  aliasToTarget.set(compactRuntimeInput(alias), target);
}

for (const target of RUNTIME_TARGETS) {
  registerAlias(target, target);
}

for (const [alias, target] of RUNTIME_ALIASES) {
  registerAlias(alias, target);
}

export function isRuntimeTarget(value: string): value is RuntimeTarget {
  return RUNTIME_TARGETS.includes(value as RuntimeTarget);
}

export function normalizeRuntimeTarget(input: string | undefined): RuntimeTarget {
  const raw = input?.trim() || "claude-code";
  const canonical = canonicalizeRuntimeInput(raw);
  const compact = compactRuntimeInput(raw);
  const target = aliasToTarget.get(canonical) ?? aliasToTarget.get(compact);

  if (!target) {
    throw new UnknownRuntimeTargetError(raw, RUNTIME_TARGETS);
  }

  return target;
}

export function registerRuntimeAdapter(adapter: RuntimeAdapter): void {
  adapterRegistry.set(adapter.target, adapter);
  for (const alias of adapter.aliases) {
    registerAlias(alias, adapter.target);
  }
}

export function listRegisteredRuntimeAdapters(): RuntimeAdapter[] {
  return [...adapterRegistry.values()];
}

export function formatRuntimeTargetList(): string {
  return RUNTIME_TARGETS.join(", ");
}

export function resolveRuntimeAdapter(input: string | undefined): RuntimeAdapter {
  const target = normalizeRuntimeTarget(input);
  const adapter = adapterRegistry.get(target);

  if (!adapter) {
    throw new UnsupportedRuntimeTargetError(
      target,
      listRegisteredRuntimeAdapters().map((registered) => registered.target),
    );
  }

  return adapter;
}

function hasRecords(value: Record<string, unknown> | undefined): boolean {
  return value !== undefined && Object.keys(value).length > 0;
}

function collectHarnessHookEntries(spec: EnvironmentSpec): Array<{
  event?: string;
  type?: "command" | "prompt";
}> {
  const hooks: Array<{ event?: string; type?: "command" | "prompt" }> = [];
  const rawSettings = spec.harness.settings;
  const rawHooks =
    rawSettings["hooks"] && typeof rawSettings["hooks"] === "object"
      ? (rawSettings["hooks"] as Record<string, unknown>)
      : {};

  for (const [event, entries] of Object.entries(rawHooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const handlers = (entry as Record<string, unknown>)["hooks"];
      if (!Array.isArray(handlers)) {
        hooks.push({ event });
        continue;
      }
      for (const handler of handlers) {
        if (!handler || typeof handler !== "object") {
          hooks.push({ event });
          continue;
        }
        const type = (handler as Record<string, unknown>)["type"];
        hooks.push({
          event,
          type: type === "command" || type === "prompt" ? type : undefined,
        });
      }
    }
  }

  for (const hook of spec.program?.hooks ?? []) {
    for (const handler of hook.handlers) {
      hooks.push({ event: hook.event, type: handler.type });
    }
  }

  if (hasRecords(spec.harness.hooks)) {
    for (const name of Object.keys(spec.harness.hooks)) {
      hooks.push({ event: name });
    }
  }

  return hooks;
}

function collectToolBindings(
  spec: EnvironmentSpec,
  registry: RegistryTool[] = [],
): Array<{ id: string; command?: string }> {
  const tools: Array<{ id: string; command?: string }> = [];

  for (const tool of spec.program?.tools ?? []) {
    tools.push({ id: tool.id, command: tool.command });
  }

  for (const [serverName, serverConfig] of Object.entries(spec.harness.mcp_config ?? {})) {
    const command =
      serverConfig && typeof serverConfig === "object"
        ? (serverConfig as Record<string, unknown>)["command"]
        : undefined;
    tools.push({
      id: `tool:${serverName}`,
      command: typeof command === "string" ? command : undefined,
    });
  }

  for (const selected of spec.tools) {
    const registryTool = registry.find((tool) => tool.id === selected.tool_id);
    if (!registryTool) continue;
    const configs = [
      ...Object.entries(registryTool.install.mcp_config ?? {}),
      ...Object.entries(
        registryTool.install.hermes?.mcp_server
          ? { [registryTool.id]: registryTool.install.hermes.mcp_server }
          : {},
      ),
    ];
    for (const [serverName, serverConfig] of configs) {
      const command =
        serverConfig && typeof serverConfig === "object"
          ? (serverConfig as Record<string, unknown>)["command"]
          : undefined;
      tools.push({
        id: `registry-tool:${serverName}`,
        command: typeof command === "string" ? command : undefined,
      });
    }
  }

  return tools;
}

function countCommands(spec: EnvironmentSpec): number {
  return spec.program?.commands.length ?? Object.keys(spec.harness.commands ?? {}).length;
}

function pushUnsupportedFeatureWarning(
  issues: AdapterValidationIssue[],
  adapter: RuntimeAdapter,
  feature: string,
  count: number,
  supported: boolean,
): void {
  if (count === 0 || supported) return;
  issues.push({
    severity: "warning",
    target: adapter.target,
    feature,
    message: `${adapter.displayName} has limited ${feature} support; ${count} ${feature} item${count === 1 ? "" : "s"} may be rendered as portable instructions instead of native runtime features.`,
  });
}

export function validateRuntimeAdapterCompatibility(
  adapter: RuntimeAdapter,
  spec: EnvironmentSpec,
  registry: RegistryTool[] = [],
): AdapterValidationIssue[] {
  const issues: AdapterValidationIssue[] = [];
  const capabilities = adapter.capabilities;

  const commandCount = countCommands(spec);
  if (commandCount > 0 && !capabilities.commands) {
    issues.push({
      severity: "error",
      target: adapter.target,
      feature: "commands",
      message: `${adapter.displayName} does not support workflow commands, but this harness defines ${commandCount}.`,
    });
  }

  const hooks = collectHarnessHookEntries(spec);
  if (hooks.length > 0 && !capabilities.hooks.supported) {
    issues.push({
      severity: "error",
      target: adapter.target,
      feature: "hooks",
      message: `${adapter.displayName} does not support hooks, but this harness defines ${hooks.length}.`,
    });
  } else if (hooks.length > 0) {
    const supportedEvents = capabilities.hooks.events
      ? new Set(capabilities.hooks.events)
      : null;
    const supportedTypes = capabilities.hooks.handlerTypes
      ? new Set(capabilities.hooks.handlerTypes)
      : null;
    for (const hook of hooks) {
      if (supportedEvents && hook.event && !supportedEvents.has(hook.event)) {
        issues.push({
          severity: "error",
          target: adapter.target,
          feature: "hooks",
          message: `${adapter.displayName} does not support the ${hook.event} hook event.`,
        });
      }
      if (supportedTypes && hook.type && !supportedTypes.has(hook.type)) {
        issues.push({
          severity: "error",
          target: adapter.target,
          feature: "hooks",
          message: `${adapter.displayName} does not support ${hook.type} hook handlers.`,
        });
      }
    }
  }

  const tools = collectToolBindings(spec, registry);
  if (tools.length > 0 && !capabilities.tools.mcpServers) {
    issues.push({
      severity: "error",
      target: adapter.target,
      feature: "tools",
      message: `${adapter.displayName} does not support MCP tools, but this harness defines ${tools.length}.`,
    });
  } else if (capabilities.tools.commandRequired) {
    const commandlessTool = tools.find((tool) => !tool.command);
    if (commandlessTool) {
      issues.push({
        severity: "error",
        target: adapter.target,
        feature: "tools",
        message: `${adapter.displayName} requires MCP tools to declare a command, but ${commandlessTool.id} does not.`,
      });
    }
  }

  pushUnsupportedFeatureWarning(
    issues,
    adapter,
    "agents",
    spec.program?.agents.length ?? Object.keys(spec.harness.agents ?? {}).length,
    capabilities.agents,
  );
  pushUnsupportedFeatureWarning(
    issues,
    adapter,
    "skills",
    spec.program?.skills.length ?? Object.keys(spec.harness.skills ?? {}).length,
    capabilities.skills,
  );
  pushUnsupportedFeatureWarning(
    issues,
    adapter,
    "docs",
    spec.program?.docs.length ?? Object.keys(spec.harness.docs ?? {}).length,
    capabilities.docs,
  );

  const permissionRuleCount = spec.program?.permissions.rules.length ?? 0;
  if (permissionRuleCount > 0 && !capabilities.permissions) {
    issues.push({
      severity: "warning",
      target: adapter.target,
      feature: "permissions",
      message: `${adapter.displayName} has limited permissions support; ${permissionRuleCount} permission rule${permissionRuleCount === 1 ? "" : "s"} may be rendered as guidance only.`,
    });
  }

  if (spec.program?.memory.mode && spec.program.memory.mode !== "none" && !capabilities.memory) {
    issues.push({
      severity: "warning",
      target: adapter.target,
      feature: "memory",
      message: `${adapter.displayName} does not support native memory policies; ${spec.program.memory.mode} memory will be rendered as guidance only.`,
    });
  }

  return issues;
}

export function assertRuntimeAdapterCompatibility(
  adapter: RuntimeAdapter,
  spec: EnvironmentSpec,
  registry: RegistryTool[] = [],
): void {
  const errors = validateRuntimeAdapterCompatibility(adapter, spec, registry).filter(
    (issue) => issue.severity === "error",
  );
  if (errors.length > 0) {
    throw new AdapterCompatibilityError(adapter, errors);
  }
}

registerRuntimeAdapter({
  target: "generic",
  displayName: "Generic",
  aliases: ["default", "portable", "harness"],
  launchCommand: "agent-runtime",
  envSetupStrategy: "external",
  pluginInstructionStrategy: "external",
  capabilities: {
    commands: true,
    hooks: { supported: false },
    tools: { mcpServers: false },
    agents: true,
    skills: true,
    docs: true,
    permissions: true,
    memory: true,
    limitations: [
      "Generic output renders portable documentation and does not configure executable hooks or MCP servers.",
    ],
  },
  render: ({ spec, registry }) => buildGenericRenderedHarness(spec, registry),
  buildFileMap: ({ spec, registry }) => buildGenericFileMap(spec, registry),
  write: ({ spec, registry, targetDir }) => writeGenericEnvironment(spec, registry, targetDir),
});

registerRuntimeAdapter(claudeCodeAdapter);

registerRuntimeAdapter({
  target: "codex",
  displayName: "Codex",
  aliases: ["codex-cli", "openai-codex"],
  launchCommand: "codex",
  envSetupStrategy: "external",
  pluginInstructionStrategy: "external",
  capabilities: {
    commands: true,
    hooks: { supported: false },
    tools: { mcpServers: true, commandRequired: true },
    agents: true,
    skills: true,
    docs: true,
    permissions: true,
    memory: false,
    limitations: [
      "Claude Code hooks are not executable in Codex and must be omitted or converted to instructions.",
      "Persistent memory policies are guidance-only.",
    ],
  },
  render: ({ spec, registry }) => buildCodexRenderedHarness(spec, registry),
  buildFileMap: ({ spec, registry }) => buildCodexFileMap(spec, registry),
  write: ({ spec, registry, targetDir }) => writeCodexEnvironment(spec, registry, targetDir),
});

registerRuntimeAdapter({
  target: "opencode",
  displayName: "OpenCode",
  aliases: ["open-code", "open_code"],
  launchCommand: "opencode",
  envSetupStrategy: "external",
  pluginInstructionStrategy: "external",
  render: ({ spec, registry }) => buildOpenCodeRenderedHarness(spec, registry),
  buildFileMap: ({ spec, registry }) => buildOpenCodeFileMap(spec, registry),
  write: ({ spec, registry, targetDir }) => writeOpenCodeEnvironment(spec, registry, targetDir),
});

registerRuntimeAdapter({
  target: "hermes",
  displayName: "Hermes",
  aliases: ["hermes-agent"],
  launchCommand: "hermes",
  envSetupStrategy: "external",
  pluginInstructionStrategy: "external",
  capabilities: {
    commands: true,
    hooks: { supported: false },
    tools: { mcpServers: true, commandRequired: true },
    agents: false,
    skills: true,
    docs: false,
    permissions: false,
    memory: false,
    limitations: [
      "Commands and rules are rendered as Hermes skills.",
      "Agents, docs, permissions, hooks, and memory policies are not native Hermes features.",
    ],
  },
  render: ({ spec, registry }) => buildHermesRenderedHarness(spec, registry),
  resolveTargetRoot: () => os.homedir(),
  write: ({ spec, registry }) => writeHermesEnvironment(spec, registry),
});
