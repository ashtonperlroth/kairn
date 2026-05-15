/**
 * Backward-compatible facade for Claude Code HarnessIR rendering.
 *
 * The implementation lives with the Claude Code adapter because the emitted
 * paths, settings, hooks, frontmatter, and `.mcp.json` shape are runtime
 * specific. Existing imports from `src/ir/renderer` remain supported.
 */

export {
  renderAgentWithFrontmatter,
  renderClaudeMd,
  renderHarness,
  renderHarnessToDir,
  renderMcpConfig,
  renderRenderedHarness,
  renderRuleWithFrontmatter,
  renderSettings,
} from "../adapter/claude-code-ir-renderer.js";
