import os from "os";
import type { EnvironmentSpec, RegistryTool, RuntimeTarget } from "../types.js";
import { RUNTIME_TARGETS } from "../types.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { buildCodexFileMap, buildCodexRenderedHarness, writeCodexEnvironment } from "./codex.js";
import { buildHermesRenderedHarness, writeHermesEnvironment } from "./hermes-agent.js";
import type { RenderedHarness } from "../rendered-harness.js";

export type EnvSetupStrategy = "project-env-file" | "external";
export type PluginInstructionStrategy = "project-cli" | "external";

export interface RuntimeWriteContext {
  spec: EnvironmentSpec;
  registry: RegistryTool[];
  targetDir: string;
}

export interface RuntimeAdapter {
  target: RuntimeTarget;
  displayName: string;
  aliases: string[];
  launchCommand: string;
  envSetupStrategy: EnvSetupStrategy;
  pluginInstructionStrategy: PluginInstructionStrategy;
  render: (context: RuntimeWriteContext) => RenderedHarness;
  resolveTargetRoot?: (context: RuntimeWriteContext) => string;
  buildFileMap?: (context: RuntimeWriteContext) => Map<string, string>;
  write: (context: RuntimeWriteContext) => Promise<string[]>;
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

registerRuntimeAdapter(claudeCodeAdapter);

registerRuntimeAdapter({
  target: "codex",
  displayName: "Codex",
  aliases: ["codex-cli", "openai-codex"],
  launchCommand: "codex",
  envSetupStrategy: "external",
  pluginInstructionStrategy: "external",
  render: ({ spec, registry }) => buildCodexRenderedHarness(spec, registry),
  buildFileMap: ({ spec, registry }) => buildCodexFileMap(spec, registry),
  write: ({ spec, registry, targetDir }) => writeCodexEnvironment(spec, registry, targetDir),
});

registerRuntimeAdapter({
  target: "hermes",
  displayName: "Hermes",
  aliases: ["hermes-agent"],
  launchCommand: "hermes",
  envSetupStrategy: "external",
  pluginInstructionStrategy: "external",
  render: ({ spec, registry }) => buildHermesRenderedHarness(spec, registry),
  resolveTargetRoot: () => os.homedir(),
  write: ({ spec, registry }) => writeHermesEnvironment(spec, registry),
});
