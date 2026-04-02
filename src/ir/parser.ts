/**
 * Harness Parser — reads a `.claude/` directory and produces a HarnessIR.
 *
 * All file I/O uses `fs.promises`. Missing directories/files are handled
 * gracefully (empty arrays, empty strings) rather than throwing.
 */

import fs from "fs/promises";
import path from "path";
import type {
  HarnessIR,
  HarnessMeta,
  Section,
  CommandNode,
  RuleNode,
  AgentNode,
  SkillNode,
  DocNode,
  HookNode,
  McpServerNode,
  SettingsIR,
  HookEntry,
} from "./types.js";
import { createEmptyIR, createEmptySettings } from "./types.js";

// ---------------------------------------------------------------------------
// Section ID mapping
// ---------------------------------------------------------------------------

/** Maps heading keywords to well-known section IDs. */
const SECTION_ID_MAP: Array<{ pattern: RegExp; id: string }> = [
  { pattern: /^(purpose|about|what)\b/i, id: "purpose" },
  { pattern: /^(tech\s*stack|technology|stack)\b/i, id: "tech-stack" },
  { pattern: /^(commands|key\s*commands)\b/i, id: "commands" },
  { pattern: /^architecture\b/i, id: "architecture" },
  { pattern: /^conventions?\b/i, id: "conventions" },
  { pattern: /^verification\b/i, id: "verification" },
  { pattern: /^(known\s*gotchas|gotchas)\b/i, id: "gotchas" },
  { pattern: /^output\b/i, id: "output" },
  { pattern: /^debugging\b/i, id: "debugging" },
  { pattern: /^git\b/i, id: "git" },
];

/**
 * Slugify a heading into a CSS-style ID: lowercase, spaces to hyphens,
 * strip anything that isn't alphanumeric or hyphen.
 */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Resolve a heading string to a well-known section ID or a custom-* slug. */
export function resolveSectionId(heading: string): string {
  const trimmed = heading.trim();
  for (const entry of SECTION_ID_MAP) {
    if (entry.pattern.test(trimmed)) {
      return entry.id;
    }
  }
  return `custom-${slugify(trimmed)}`;
}

// ---------------------------------------------------------------------------
// parseYamlFrontmatter
// ---------------------------------------------------------------------------

/**
 * Extract simple YAML frontmatter delimited by `---` lines.
 *
 * Handles:
 * - `key: value` pairs (string values)
 * - `key:` followed by indented `  - item` list items (arrays)
 * - Quoted values have their quotes stripped
 *
 * Does **not** depend on an external YAML library.
 */
export function parseYamlFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { frontmatter: {}, body: content };
  }

  // Find the closing ---
  const secondDash = content.indexOf("\n---", 3);
  if (secondDash === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlBlock = content.slice(4, secondDash); // skip opening "---\n"
  const afterClose = secondDash + 4; // skip "\n---"
  const body = content.slice(afterClose).replace(/^\r?\n/, "");

  const frontmatter: Record<string, unknown> = {};
  const lines = yamlBlock.split("\n");

  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // List item under the current key
    if (currentKey !== null && /^\s+-\s+/.test(trimmed)) {
      if (currentList === null) {
        currentList = [];
      }
      let value = trimmed.replace(/^\s+-\s+/, "").trim();
      // Strip surrounding quotes
      value = stripQuotes(value);
      currentList.push(value);
      continue;
    }

    // Flush any pending list
    if (currentKey !== null && currentList !== null) {
      frontmatter[currentKey] = currentList;
      currentKey = null;
      currentList = null;
    }

    // key: value pair
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const rawValue = trimmed.slice(colonIdx + 1).trim();

      if (rawValue === "") {
        // Could be the start of a list
        currentKey = key;
        currentList = null;
      } else {
        frontmatter[key] = stripQuotes(rawValue);
        currentKey = null;
        currentList = null;
      }
    }
  }

  // Flush final pending list
  if (currentKey !== null && currentList !== null) {
    frontmatter[currentKey] = currentList;
  }

  return { frontmatter, body };
}

/** Remove surrounding single or double quotes from a string value. */
function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

// ---------------------------------------------------------------------------
// parseClaudeMd
// ---------------------------------------------------------------------------

/**
 * Parse the content of a CLAUDE.md file into partial metadata and sections.
 *
 * Splits on `## ` boundaries. The chunk before the first `## ` becomes the
 * preamble section. Each subsequent chunk is assigned a well-known or custom
 * section ID based on its heading text.
 */
export function parseClaudeMd(content: string): {
  meta: Partial<HarnessMeta>;
  sections: Section[];
} {
  const meta: Partial<HarnessMeta> = {
    techStack: { language: "" },
    autonomyLevel: 2,
  };
  const sections: Section[] = [];

  // Split on ## boundaries (keeping the delimiter for all but the first chunk)
  const chunks = content.split(/^## /gm);

  // First chunk is the preamble (everything before the first ## )
  const preamble = chunks[0];

  // Extract name from `# Title` line
  const titleMatch = preamble.match(/^# (.+)$/m);
  if (titleMatch) {
    meta.name = titleMatch[1].trim();
  } else {
    meta.name = "";
  }

  // Build preamble section
  const preambleHeading = meta.name ? `# ${meta.name}` : "";
  // Content is everything after the title line (if any)
  const preambleContent = titleMatch
    ? preamble.slice(preamble.indexOf(titleMatch[0]) + titleMatch[0].length).trim()
    : preamble.trim();

  sections.push({
    id: "preamble",
    heading: preambleHeading,
    content: preambleContent,
    order: 0,
  });

  // Process each ## section
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const newlineIdx = chunk.indexOf("\n");
    const heading =
      newlineIdx >= 0 ? chunk.slice(0, newlineIdx).trim() : chunk.trim();
    const sectionContent =
      newlineIdx >= 0 ? chunk.slice(newlineIdx + 1).trim() : "";

    const sectionId = resolveSectionId(heading);

    sections.push({
      id: sectionId,
      heading: `## ${heading}`,
      content: sectionContent,
      order: i,
    });

    // Extract purpose from purpose section (first paragraph only)
    if (sectionId === "purpose") {
      const firstParagraph = sectionContent.split(/\n\n/)[0].trim();
      meta.purpose = firstParagraph;
    }

    // Extract tech stack from tech-stack section
    if (sectionId === "tech-stack") {
      meta.techStack = extractTechStack(sectionContent);
    }
  }

  return { meta, sections };
}

/**
 * Extract technology details from bullet-point content in a Tech Stack section.
 */
function extractTechStack(content: string): HarnessMeta["techStack"] {
  const stack: HarnessMeta["techStack"] = { language: "" };
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    const bullet = trimmed.slice(1).trim().toLowerCase();

    // Language detection
    if (
      !stack.language &&
      (bullet.includes("typescript") || bullet.includes("javascript"))
    ) {
      stack.language = bullet.includes("typescript")
        ? "TypeScript"
        : "JavaScript";
    } else if (!stack.language && bullet.includes("python")) {
      stack.language = "Python";
    } else if (!stack.language && bullet.includes("rust")) {
      stack.language = "Rust";
    } else if (!stack.language && bullet.includes("go ") || !stack.language && bullet.startsWith("go,")) {
      stack.language = "Go";
    }

    // Build tool detection
    if (!stack.buildTool) {
      const buildTools = [
        "tsup", "webpack", "vite", "esbuild", "rollup", "parcel",
        "turbopack", "swc", "cargo", "make", "cmake",
      ];
      for (const tool of buildTools) {
        if (bullet.includes(tool)) {
          stack.buildTool = tool;
          break;
        }
      }
    }

    // Test runner detection
    if (!stack.testRunner) {
      const testRunners = [
        "vitest", "jest", "mocha", "ava", "tap", "pytest", "cargo test",
      ];
      for (const runner of testRunners) {
        if (bullet.includes(runner)) {
          stack.testRunner = runner;
          break;
        }
      }
    }

    // Framework detection
    if (!stack.framework) {
      const frameworks = [
        "commander.js", "commander", "express", "fastify", "next.js",
        "nextjs", "react", "vue", "angular", "svelte", "django", "flask",
        "actix", "axum",
      ];
      for (const fw of frameworks) {
        if (bullet.includes(fw)) {
          // Normalize: "commander.js" → "Commander.js"
          stack.framework =
            fw.charAt(0).toUpperCase() + fw.slice(1);
          break;
        }
      }
    }

    // Package manager detection
    if (!stack.packageManager) {
      const pkgManagers = ["pnpm", "yarn", "bun", "npm", "cargo", "pip"];
      for (const pm of pkgManagers) {
        if (bullet.includes(`${pm} `)) {
          stack.packageManager = pm;
          break;
        }
      }
    }
  }

  return stack;
}

// ---------------------------------------------------------------------------
// parseSettings
// ---------------------------------------------------------------------------

/**
 * Parse a `settings.json` string into a SettingsIR.
 *
 * Extracts:
 * - `permissions.deny` → `denyPatterns`
 * - `hooks.*` → typed hook entries
 * - `statusLine` → status line config
 * - Everything else → `raw`
 */
export function parseSettings(content: string): SettingsIR {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const settings = createEmptySettings();

  // Extract deny patterns
  const permissions = parsed["permissions"] as
    | Record<string, unknown>
    | undefined;
  if (permissions) {
    const deny = permissions["deny"];
    if (Array.isArray(deny) && deny.length > 0) {
      settings.denyPatterns = deny as string[];
    }
  }

  // Extract status line
  const statusLine = parsed["statusLine"] as
    | { command: string }
    | undefined;
  if (statusLine && typeof statusLine.command === "string") {
    settings.statusLine = { command: statusLine.command };
  }

  // Extract hooks
  const hooksRaw = parsed["hooks"] as Record<string, unknown> | undefined;
  if (hooksRaw && typeof hooksRaw === "object") {
    const knownEvents = [
      "PreToolUse",
      "PostToolUse",
      "UserPromptSubmit",
      "SessionStart",
      "PostCompact",
    ] as const;

    for (const event of knownEvents) {
      const entries = hooksRaw[event];
      if (Array.isArray(entries) && entries.length > 0) {
        settings.hooks[event] = entries as HookEntry[];
      }
    }
  }

  // Put everything into raw (excluding already-extracted top-level keys)
  const extractedKeys = new Set(["permissions", "hooks", "statusLine"]);
  for (const [key, value] of Object.entries(parsed)) {
    if (!extractedKeys.has(key)) {
      settings.raw[key] = value;
    }
  }

  return settings;
}

// ---------------------------------------------------------------------------
// parseMcpConfig
// ---------------------------------------------------------------------------

/**
 * Parse a `.mcp.json` string into an array of McpServerNode.
 *
 * Each key in the `mcpServers` object becomes a node with `id` = key.
 */
export function parseMcpConfig(content: string): McpServerNode[] {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const servers = parsed["mcpServers"] as
    | Record<string, Record<string, unknown>>
    | undefined;

  if (!servers || typeof servers !== "object") {
    return [];
  }

  const nodes: McpServerNode[] = [];

  for (const [id, config] of Object.entries(servers)) {
    const command = config["command"] as string;
    const args = (config["args"] as string[]) ?? [];
    const env = config["env"] as Record<string, string> | undefined;

    const node: McpServerNode = { id, command, args };

    // Only include env if it's a non-empty object
    if (env && typeof env === "object" && Object.keys(env).length > 0) {
      node.env = env;
    }

    nodes.push(node);
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Directory reading helpers
// ---------------------------------------------------------------------------

/**
 * Safely read a directory, returning an empty array if it doesn't exist.
 */
async function readDirSafe(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

/**
 * Safely read a file, returning null if it doesn't exist.
 */
async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Safely check whether a path is a directory.
 */
async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sub-parsers for harness subdirectories
// ---------------------------------------------------------------------------

/** Read `commands/*.md` files into CommandNode[]. */
async function parseCommands(harnessPath: string): Promise<CommandNode[]> {
  const dirPath = path.join(harnessPath, "commands");
  const entries = await readDirSafe(dirPath);
  const nodes: CommandNode[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;

    const filePath = path.join(dirPath, entry);
    const content = await readFileSafe(filePath);
    if (content === null) continue;

    const name = entry.replace(/\.md$/, "");
    const firstLine = content.split("\n")[0].trim();
    // Use first line as description if it's not a heading or code block
    const description =
      firstLine && !firstLine.startsWith("#") && !firstLine.startsWith("```")
        ? firstLine
        : "";

    nodes.push({ name, description, content });
  }

  return nodes;
}

/** Read `rules/*.md` files into RuleNode[], parsing YAML frontmatter for `paths`. */
async function parseRules(harnessPath: string): Promise<RuleNode[]> {
  const dirPath = path.join(harnessPath, "rules");
  const entries = await readDirSafe(dirPath);
  const nodes: RuleNode[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;

    const filePath = path.join(dirPath, entry);
    const rawContent = await readFileSafe(filePath);
    if (rawContent === null) continue;

    const name = entry.replace(/\.md$/, "");
    const { frontmatter, body } = parseYamlFrontmatter(rawContent);

    const node: RuleNode = { name, content: body };

    const paths = frontmatter["paths"];
    if (Array.isArray(paths) && paths.length > 0) {
      node.paths = paths as string[];
    }

    nodes.push(node);
  }

  return nodes;
}

/** Read `agents/*.md` files into AgentNode[], parsing YAML frontmatter for `model` and `disallowedTools`. */
async function parseAgents(harnessPath: string): Promise<AgentNode[]> {
  const dirPath = path.join(harnessPath, "agents");
  const entries = await readDirSafe(dirPath);
  const nodes: AgentNode[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;

    const filePath = path.join(dirPath, entry);
    const rawContent = await readFileSafe(filePath);
    if (rawContent === null) continue;

    const fileBaseName = entry.replace(/\.md$/, "");
    const { frontmatter, body } = parseYamlFrontmatter(rawContent);

    // Use frontmatter name if present, otherwise file name
    const name =
      typeof frontmatter["name"] === "string"
        ? frontmatter["name"]
        : fileBaseName;

    const node: AgentNode = { name, content: body };

    if (typeof frontmatter["model"] === "string") {
      node.model = frontmatter["model"];
    }

    const disallowedTools = frontmatter["disallowedTools"];
    if (Array.isArray(disallowedTools)) {
      node.disallowedTools = disallowedTools as string[];
    }

    // Parse modelRouting if present
    const modelRouting = frontmatter["modelRouting"];
    if (typeof modelRouting === "object" && modelRouting !== null) {
      const mr = modelRouting as Record<string, unknown>;
      if (typeof mr["default"] === "string") {
        node.modelRouting = {
          default: mr["default"] as 'haiku' | 'sonnet' | 'opus',
        };
        if (typeof mr["escalateTo"] === "string") {
          node.modelRouting.escalateTo = mr["escalateTo"] as 'sonnet' | 'opus';
        }
        if (typeof mr["escalateWhen"] === "string") {
          node.modelRouting.escalateWhen = mr["escalateWhen"];
        }
      }
    }

    // Preserve all other frontmatter fields not already handled
    const knownKeys = new Set(["name", "model", "disallowedTools", "modelRouting"]);
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      if (!knownKeys.has(key)) {
        extra[key] = value;
      }
    }
    if (Object.keys(extra).length > 0) {
      node.extraFrontmatter = extra;
    }

    nodes.push(node);
  }

  return nodes;
}

/**
 * Read `skills/` directory into SkillNode[].
 *
 * Skills can be either:
 * - A direct `.md` file: `skills/tdd.md`
 * - A directory with a `skill.md` inside: `skills/tdd/skill.md`
 */
async function parseSkills(harnessPath: string): Promise<SkillNode[]> {
  const dirPath = path.join(harnessPath, "skills");
  const entries = await readDirSafe(dirPath);
  const nodes: SkillNode[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry);

    if (entry.endsWith(".md")) {
      // Direct file
      const content = await readFileSafe(entryPath);
      if (content === null) continue;
      const name = entry.replace(/\.md$/, "");
      nodes.push({ name, content });
    } else if (await isDirectory(entryPath)) {
      // Directory — look for skill.md or SKILL.md inside (case-insensitive)
      let content = await readFileSafe(path.join(entryPath, "skill.md"));
      if (content === null) {
        content = await readFileSafe(path.join(entryPath, "SKILL.md"));
      }
      if (content === null) continue;
      nodes.push({ name: entry, content });
    }
  }

  return nodes;
}

/** Read `docs/*.md` files into DocNode[]. */
async function parseDocs(harnessPath: string): Promise<DocNode[]> {
  const dirPath = path.join(harnessPath, "docs");
  const entries = await readDirSafe(dirPath);
  const nodes: DocNode[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;

    const filePath = path.join(dirPath, entry);
    const content = await readFileSafe(filePath);
    if (content === null) continue;

    const name = entry.replace(/\.md$/, "");
    nodes.push({ name, content });
  }

  return nodes;
}

/** Read `hooks/*.mjs` files into HookNode[]. */
async function parseHooks(harnessPath: string): Promise<HookNode[]> {
  const dirPath = path.join(harnessPath, "hooks");
  const entries = await readDirSafe(dirPath);
  const nodes: HookNode[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".mjs")) continue;

    const filePath = path.join(dirPath, entry);
    const content = await readFileSafe(filePath);
    if (content === null) continue;

    const name = entry.replace(/\.mjs$/, "");
    nodes.push({ name, content, type: "command" });
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// parseHarness — main entry point
// ---------------------------------------------------------------------------

/**
 * Read an entire `.claude/` directory (or compatible harness directory) and
 * produce a complete HarnessIR.
 *
 * Missing files/directories are handled gracefully — the resulting IR simply
 * has empty arrays/strings for the missing parts.
 *
 * @param harnessPath - Absolute path to the `.claude/` directory.
 */
export async function parseHarness(harnessPath: string): Promise<HarnessIR> {
  const ir = createEmptyIR();

  // 1. Parse CLAUDE.md
  const claudeMdContent = await readFileSafe(
    path.join(harnessPath, "CLAUDE.md"),
  );
  if (claudeMdContent !== null) {
    const { meta, sections } = parseClaudeMd(claudeMdContent);
    ir.meta = {
      ...ir.meta,
      ...meta,
      techStack: { ...ir.meta.techStack, ...meta.techStack },
    };
    ir.sections = sections;
  }

  // 2. Parse settings.json
  const settingsContent = await readFileSafe(
    path.join(harnessPath, "settings.json"),
  );
  if (settingsContent !== null) {
    ir.settings = parseSettings(settingsContent);
  }

  // 3. Parse subdirectories in parallel
  const [commands, rules, agents, skills, docs, hooks] = await Promise.all([
    parseCommands(harnessPath),
    parseRules(harnessPath),
    parseAgents(harnessPath),
    parseSkills(harnessPath),
    parseDocs(harnessPath),
    parseHooks(harnessPath),
  ]);

  ir.commands = commands;
  ir.rules = rules;
  ir.agents = agents;
  ir.skills = skills;
  ir.docs = docs;
  ir.hooks = hooks;

  // 4. Parse .mcp.json — check both parent directory and harness directory itself
  const mcpServers: McpServerNode[] = [];
  const seenIds = new Set<string>();

  // Check parent directory (standard location: project root has .mcp.json, .claude/ is the harness)
  const parentMcpPath = path.join(path.dirname(harnessPath), ".mcp.json");
  const parentMcpContent = await readFileSafe(parentMcpPath);
  if (parentMcpContent !== null) {
    for (const node of parseMcpConfig(parentMcpContent)) {
      if (!seenIds.has(node.id)) {
        seenIds.add(node.id);
        mcpServers.push(node);
      }
    }
  }

  // Check inside the harness directory itself (evolution may copy it here)
  const innerMcpPath = path.join(harnessPath, ".mcp.json");
  const innerMcpContent = await readFileSafe(innerMcpPath);
  if (innerMcpContent !== null) {
    for (const node of parseMcpConfig(innerMcpContent)) {
      if (!seenIds.has(node.id)) {
        seenIds.add(node.id);
        mcpServers.push(node);
      }
    }
  }

  ir.mcpServers = mcpServers;

  return ir;
}
