import { describe, expect, it } from "vitest";
import {
  UnknownRuntimeTargetError,
  formatRuntimeTargetList,
  normalizeRuntimeTarget,
  resolveRuntimeAdapter,
} from "../registry.js";
import { RUNTIME_TARGETS } from "../../types.js";

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

  it("rejects unknown runtime targets", () => {
    expect(() => normalizeRuntimeTarget("made-up-runtime")).toThrow(UnknownRuntimeTargetError);
  });
});
