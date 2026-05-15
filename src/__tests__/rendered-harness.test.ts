import { describe, expect, it } from "vitest";
import {
  InvalidRenderedHarnessPathError,
  createRenderedHarness,
  renderedHarnessContentMap,
  sanitizeRenderedHarnessPath,
} from "../rendered-harness.js";

describe("RenderedHarness contract", () => {
  it("normalizes separators and returns target-root-relative paths", () => {
    expect(sanitizeRenderedHarnessPath("commands\\build.md")).toBe(
      "commands/build.md",
    );
    expect(sanitizeRenderedHarnessPath("./commands/build.md")).toBe("commands/build.md");
  });

  it("rejects path traversal", () => {
    expect(() => sanitizeRenderedHarnessPath("../escape.md")).toThrow(
      InvalidRenderedHarnessPathError,
    );
    expect(() => sanitizeRenderedHarnessPath("commands/../../escape.md")).toThrow(
      InvalidRenderedHarnessPathError,
    );
  });

  it("rejects absolute paths", () => {
    expect(() => sanitizeRenderedHarnessPath("/tmp/escape.md")).toThrow(
      InvalidRenderedHarnessPathError,
    );
    expect(() => sanitizeRenderedHarnessPath("C:\\tmp\\escape.md")).toThrow(
      InvalidRenderedHarnessPathError,
    );
  });

  it("sorts files deterministically and attaches stable metadata", () => {
    const rendered = createRenderedHarness(
      [
        { path: "rules/security.md", content: "No secrets.\n", source: "rules" },
        { path: "CLAUDE.md", content: "# Project\n", source: "claude_md" },
      ],
      { target: "claude-code", source: "test" },
    );

    expect([...rendered.files.keys()]).toEqual(["CLAUDE.md", "rules/security.md"]);
    expect(rendered.metadata).toEqual({
      schemaVersion: 1,
      target: "claude-code",
      source: "test",
    });

    const claudeFile = rendered.files.get("CLAUDE.md");
    expect(claudeFile?.metadata).toMatchObject({
      byteLength: 10,
      lineCount: 2,
      source: "claude_md",
    });
    expect(claudeFile?.metadata.sha256).toHaveLength(64);
    expect(renderedHarnessContentMap(rendered).get("CLAUDE.md")).toBe("# Project\n");
  });
});
