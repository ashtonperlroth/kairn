import fs from "fs/promises";
import path from "path";

/** Tracks which subdirectories a language was detected in. */
export interface LanguageDetection {
  /** Language name (e.g., 'Python', 'TypeScript'). */
  language: string;
  /** Subdirectories where this language was found. Empty = detected at root level. */
  subdirs: string[];
}

export interface ProjectProfile {
  // Core identity
  name: string;
  description: string;
  directory: string;

  // Language & framework
  language: string | null;
  languages: string[];
  languageLocations?: LanguageDetection[];
  framework: string | null;
  typescript: boolean;

  // Dependencies
  dependencies: string[];
  devDependencies: string[];

  // Scripts & commands
  scripts: Record<string, string>;
  hasTests: boolean;
  testCommand: string | null;
  buildCommand: string | null;
  lintCommand: string | null;

  // Project structure
  hasSrc: boolean;
  hasDocker: boolean;
  hasCi: boolean;
  hasEnvFile: boolean;
  envKeys: string[];        // from .env.example only — never read .env values

  // Existing harness
  hasClaudeDir: boolean;
  existingClaudeMd: string | null;
  existingSettings: Record<string, unknown> | null;
  existingMcpConfig: Record<string, unknown> | null;
  existingCommands: string[];
  existingRules: string[];
  existingSkills: string[];
  existingAgents: string[];
  mcpServerCount: number;
  claudeMdLineCount: number;

  // Key files found
  keyFiles: string[];
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(p: string): Promise<Record<string, unknown> | null> {
  try {
    const data = await fs.readFile(p, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function readFileSafe(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return null;
  }
}

async function listDirSafe(p: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(p);
    return entries.filter((e) => !e.startsWith("."));
  } catch {
    return [];
  }
}

function detectFramework(deps: string[]): string | null {
  const frameworks: [string[], string][] = [
    [["next"], "Next.js"],
    [["nuxt"], "Nuxt"],
    [["@remix-run/node", "@remix-run/react"], "Remix"],
    [["svelte", "@sveltejs/kit"], "SvelteKit"],
    [["express"], "Express"],
    [["fastify"], "Fastify"],
    [["hono"], "Hono"],
    [["react", "react-dom"], "React"],
    [["vue"], "Vue"],
    [["angular"], "Angular"],
    [["django"], "Django"],
    [["flask"], "Flask"],
    [["fastapi"], "FastAPI"],
    [["@supabase/supabase-js"], "Supabase"],
    [["prisma", "@prisma/client"], "Prisma"],
    [["drizzle-orm"], "Drizzle"],
    [["tailwindcss"], "Tailwind CSS"],
  ];

  const detected: string[] = [];
  for (const [packages, name] of frameworks) {
    if (packages.some((pkg) => deps.includes(pkg))) {
      detected.push(name);
    }
  }
  return detected.length > 0 ? detected.join(" + ") : null;
}

/** Language signal files, ordered by precedence. */
const LANGUAGE_SIGNALS: Array<{ files: string[]; language: string }> = [
  { files: ['tsconfig.json'], language: 'TypeScript' },
  { files: ['package.json'], language: 'JavaScript' },
  { files: ['pyproject.toml', 'setup.py', 'requirements.txt'], language: 'Python' },
  { files: ['Cargo.toml'], language: 'Rust' },
  { files: ['go.mod'], language: 'Go' },
  { files: ['Gemfile'], language: 'Ruby' },
];

/** Check file list against all language signals, returning every match in precedence order. */
function detectLanguagesFromFiles(files: string[]): string[] {
  const matched: string[] = [];
  for (const signal of LANGUAGE_SIGNALS) {
    if (files.some((f) => signal.files.includes(f))) {
      matched.push(signal.language);
    }
  }
  return matched;
}

/**
 * Detect all languages present in the project, tracking which subdirectories
 * each language was found in.
 *
 * Root-level detections return entries with `subdirs: []` (no scoping needed).
 * Subdirectory-level detections track which subdirectories contain each language,
 * enabling monorepo-aware domain pattern scoping.
 *
 * Results are sorted: root detections by LANGUAGE_SIGNALS precedence; subdirectory
 * detections by frequency descending, then precedence ascending for ties.
 *
 * @returns Array of LanguageDetection entries, or empty array if none found.
 */
export async function detectLanguageLocations(dir: string, keyFiles: string[]): Promise<LanguageDetection[]> {
  const rootHits = detectLanguagesFromFiles(keyFiles);
  if (rootHits.length > 0) {
    // Root-level detection: each language gets subdirs: [] (no scoping)
    return rootHits.map(language => ({ language, subdirs: [] }));
  }

  // Monorepo fallback: scan one level of subdirectories, track which dirs have each language
  const entries = await listDirSafe(dir);
  const langSubdirs = new Map<string, string[]>();
  const counts = new Map<string, number>();

  for (const entry of entries) {
    const subPath = path.join(dir, entry);
    try {
      const stat = await fs.stat(subPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    const subFiles = await listDirSafe(subPath);
    const subLangs = detectLanguagesFromFiles(subFiles);
    for (const lang of subLangs) {
      counts.set(lang, (counts.get(lang) ?? 0) + 1);
      const existing = langSubdirs.get(lang);
      if (existing) {
        existing.push(entry);
      } else {
        langSubdirs.set(lang, [entry]);
      }
    }
  }
  if (counts.size === 0) return [];

  // Build precedence index for tie-breaking
  const precedence = new Map<string, number>();
  for (let i = 0; i < LANGUAGE_SIGNALS.length; i++) {
    precedence.set(LANGUAGE_SIGNALS[i].language, i);
  }

  // Sort by frequency descending, then by LANGUAGE_SIGNALS precedence ascending
  return [...counts.entries()]
    .sort((a, b) => {
      const freqDiff = b[1] - a[1];
      if (freqDiff !== 0) return freqDiff;
      return (precedence.get(a[0]) ?? 999) - (precedence.get(b[0]) ?? 999);
    })
    .map(([lang]) => ({
      language: lang,
      subdirs: langSubdirs.get(lang) ?? [],
    }));
}

function extractEnvKeys(content: string): string[] {
  const keys: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (match) keys.push(match[1]);
  }
  return keys;
}

export async function scanProject(dir: string): Promise<ProjectProfile> {
  // Read package.json
  const pkg = await readJsonSafe(path.join(dir, "package.json")) as Record<string, unknown> | null;
  const deps = pkg?.dependencies ? Object.keys(pkg.dependencies as Record<string, string>) : [];
  const devDeps = pkg?.devDependencies ? Object.keys(pkg.devDependencies as Record<string, string>) : [];
  const allDeps = [...deps, ...devDeps];
  const scripts = (pkg?.scripts || {}) as Record<string, string>;

  // Detect key files
  const rootFiles = await listDirSafe(dir);
  const keyFiles = rootFiles.filter((f) =>
    [
      "package.json", "tsconfig.json", "pyproject.toml", "setup.py",
      "requirements.txt", "Cargo.toml", "go.mod", "Gemfile",
      "docker-compose.yml", "Dockerfile", ".env.example", ".env",
      "README.md", "CLAUDE.md",
    ].includes(f)
  );

  // Detect language & framework (with subdirectory tracking)
  const languageLocations = await detectLanguageLocations(dir, keyFiles);
  const detectedLanguages = languageLocations.map(d => d.language);
  const language = detectedLanguages[0] ?? null;
  const framework = detectFramework(allDeps);
  const typescript = keyFiles.includes("tsconfig.json") || allDeps.includes("typescript");

  // Test detection
  const testCommand = scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1'
    ? scripts.test : null;
  const hasTests = testCommand !== null ||
    await fileExists(path.join(dir, "tests")) ||
    await fileExists(path.join(dir, "__tests__")) ||
    await fileExists(path.join(dir, "test"));

  // Build & lint
  const buildCommand = scripts.build || null;
  const lintCommand = scripts.lint || null;

  // Structure
  const hasSrc = await fileExists(path.join(dir, "src"));
  const hasDocker = await fileExists(path.join(dir, "docker-compose.yml")) ||
    await fileExists(path.join(dir, "Dockerfile"));
  const hasCi = await fileExists(path.join(dir, ".github/workflows"));

  // Env keys (from .env.example only — never read actual .env values)
  const hasEnvFile = await fileExists(path.join(dir, ".env")) ||
    await fileExists(path.join(dir, ".env.example"));
  let envKeys: string[] = [];
  const envExample = await readFileSafe(path.join(dir, ".env.example"));
  if (envExample) {
    envKeys = extractEnvKeys(envExample);
  }

  // Existing .claude/ harness
  const claudeDir = path.join(dir, ".claude");
  const hasClaudeDir = await fileExists(claudeDir);
  let existingClaudeMd: string | null = null;
  let existingSettings: Record<string, unknown> | null = null;
  let existingMcpConfig: Record<string, unknown> | null = null;
  let existingCommands: string[] = [];
  let existingRules: string[] = [];
  let existingSkills: string[] = [];
  let existingAgents: string[] = [];
  let mcpServerCount = 0;
  let claudeMdLineCount = 0;

  if (hasClaudeDir) {
    existingClaudeMd = await readFileSafe(path.join(claudeDir, "CLAUDE.md"));
    if (existingClaudeMd) {
      claudeMdLineCount = existingClaudeMd.split("\n").length;
    }

    existingSettings = await readJsonSafe(path.join(claudeDir, "settings.json"));
    existingMcpConfig = await readJsonSafe(path.join(dir, ".mcp.json"));
    if (existingMcpConfig?.mcpServers) {
      mcpServerCount = Object.keys(existingMcpConfig.mcpServers as Record<string, unknown>).length;
    }

    existingCommands = (await listDirSafe(path.join(claudeDir, "commands")))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(".md", ""));
    existingRules = (await listDirSafe(path.join(claudeDir, "rules")))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(".md", ""));
    existingSkills = await listDirSafe(path.join(claudeDir, "skills"));
    existingAgents = (await listDirSafe(path.join(claudeDir, "agents")))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(".md", ""));
  }

  // Project name & description
  const name = (pkg?.name as string) || path.basename(dir);
  const description = (pkg?.description as string) || "";

  return {
    name,
    description,
    directory: dir,
    language,
    languages: detectedLanguages,
    languageLocations,
    framework,
    typescript,
    dependencies: deps,
    devDependencies: devDeps,
    scripts,
    hasTests,
    testCommand,
    buildCommand,
    lintCommand,
    hasSrc,
    hasDocker,
    hasCi,
    hasEnvFile,
    envKeys,
    hasClaudeDir,
    existingClaudeMd,
    existingSettings,
    existingMcpConfig,
    existingCommands,
    existingRules,
    existingSkills,
    existingAgents,
    mcpServerCount,
    claudeMdLineCount,
    keyFiles,
  };
}
