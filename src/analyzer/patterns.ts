/**
 * Language-specific file sampling strategies for the semantic codebase analyzer.
 *
 * Each strategy defines how to discover and prioritize files for a given language
 * ecosystem: where to find entry points, which directories contain domain logic,
 * which config files to always include, and what to exclude.
 */

import fs from 'fs/promises';
import path from 'path';

/** Describes how to sample files from a codebase for a specific language. */
export interface SamplingStrategy {
  /** Human-readable language name (e.g., "Python", "TypeScript"). */
  language: string;
  /** File extensions associated with this language. */
  extensions: string[];
  /** Entry-point file paths to try, in priority order. */
  entryPoints: string[];
  /** Glob patterns for directories containing core domain logic. */
  domainPatterns: string[];
  /** Config files to always include when present. */
  configPatterns: string[];
  /** Glob patterns for files/directories to never include. */
  excludePatterns: string[];
  /** Maximum number of files to select per category (entry/domain/config). */
  maxFilesPerCategory: number;
}

/** Language-keyed registry of sampling strategies. */
export const STRATEGIES: Record<string, SamplingStrategy> = {
  python: {
    language: 'Python',
    extensions: ['.py'],
    entryPoints: [
      'main.py',
      'app.py',
      'run.py',
      'cli.py',
      'server.py',
      '__main__.py',
      'src/main.py',
      'src/app.py',
      'src/__main__.py',
    ],
    domainPatterns: [
      'src/',
      'lib/',
      'app/',
      'models/',
      'pipelines/',
      'services/',
      'api/',
      'core/',
      'engine/',
    ],
    configPatterns: [
      'pyproject.toml',
      'setup.py',
      'setup.cfg',
      'requirements.txt',
      'Pipfile',
      'poetry.lock',
    ],
    excludePatterns: [
      '**/__pycache__/**',
      '**/*.pyc',
      '**/test_*',
      '**/*_test.py',
      '**/tests/**',
      '**/.venv/**',
      '**/venv/**',
      '**/dist/**',
      '**/build/**',
      '**/*.egg-info/**',
    ],
    maxFilesPerCategory: 5,
  },

  typescript: {
    language: 'TypeScript',
    extensions: ['.ts', '.tsx'],
    entryPoints: [
      'src/index.ts',
      'src/main.ts',
      'src/app.ts',
      'index.ts',
      'src/server.ts',
      'src/cli.ts',
      'pages/index.tsx',
      'app/page.tsx',
    ],
    domainPatterns: [
      'src/lib/',
      'src/services/',
      'src/modules/',
      'src/api/',
      'src/core/',
      'src/components/',
      'src/routes/',
      'src/handlers/',
    ],
    configPatterns: ['tsconfig.json', 'package.json'],
    excludePatterns: [
      '**/__tests__/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
    ],
    maxFilesPerCategory: 5,
  },

  go: {
    language: 'Go',
    extensions: ['.go'],
    entryPoints: ['main.go', 'cmd/main.go', 'cmd/server/main.go'],
    domainPatterns: ['internal/', 'pkg/', 'api/', 'handlers/', 'services/'],
    configPatterns: ['go.mod', 'go.sum'],
    excludePatterns: ['**/*_test.go', '**/vendor/**', '**/testdata/**'],
    maxFilesPerCategory: 5,
  },

  rust: {
    language: 'Rust',
    extensions: ['.rs'],
    entryPoints: ['src/main.rs', 'src/lib.rs'],
    domainPatterns: ['src/', 'crates/'],
    configPatterns: ['Cargo.toml', 'Cargo.lock'],
    excludePatterns: ['**/target/**', '**/tests/**', '**/benches/**'],
    maxFilesPerCategory: 5,
  },
};

/**
 * Look up a sampling strategy by language name (case-insensitive).
 *
 * @param language - Language identifier (e.g., "python", "TypeScript") or null.
 * @returns The matching SamplingStrategy, or null if not found.
 */
export function getStrategy(language: string | null): SamplingStrategy | null {
  if (language === null) {
    return null;
  }
  const key = language.toLowerCase();
  // JavaScript uses the TypeScript strategy — same ecosystem, same tooling.
  // The scanner emits 'JavaScript' when package.json exists without tsconfig.json.
  if (key === 'javascript') return STRATEGIES['typescript'] ?? null;
  return STRATEGIES[key] ?? null;
}

/**
 * Returns glob patterns for files that should always be included in any sample,
 * regardless of detected language.
 *
 * @returns Array of file path patterns to always include.
 */
export function getAlwaysInclude(): string[] {
  return ['README.md', 'README.rst', '*.toml', '*.yaml', '*.yml'];
}

/**
 * Priority tiers for file sampling. Lower number = higher priority.
 * When a token budget forces truncation, files are dropped from the
 * highest tier number first, guaranteeing that entry points, READMEs,
 * and config files always survive.
 */
export const enum FileTier {
  /** README, project config — project identity (always kept) */
  IDENTITY = 0,
  /** Entry points — what starts the app */
  ENTRY = 1,
  /** Core domain files in known domain directories */
  DOMAIN = 2,
  /** Everything else that matched include patterns */
  OTHER = 3,
}

/**
 * Classify a file path into a priority tier for budget truncation.
 *
 * @param filePath - Relative file path (e.g. "src/cli.ts", "README.md")
 * @param strategy - The language sampling strategy being used
 * @returns The priority tier (lower = higher priority, kept first)
 */
export function classifyFilePriority(filePath: string, strategy: SamplingStrategy): FileTier {
  const lower = filePath.toLowerCase();

  // Tier 0: README and config files — project identity
  if (lower.startsWith('readme') || lower.endsWith('readme.md') || lower.endsWith('readme.rst')) {
    return FileTier.IDENTITY;
  }
  for (const cfg of strategy.configPatterns) {
    if (lower === cfg.toLowerCase() || filePath === cfg) {
      return FileTier.IDENTITY;
    }
  }
  // Also catch always-include config files
  if (lower === 'package.json' || lower === 'pyproject.toml' || lower === 'cargo.toml' || lower === 'go.mod') {
    return FileTier.IDENTITY;
  }

  // Tier 1: Entry points — what boots the app
  for (const entry of strategy.entryPoints) {
    if (filePath === entry || lower === entry.toLowerCase()) {
      return FileTier.ENTRY;
    }
  }

  // Tier 2: Domain directories — the interesting code
  for (const domain of strategy.domainPatterns) {
    if (filePath.startsWith(domain) || lower.startsWith(domain.toLowerCase())) {
      return FileTier.DOMAIN;
    }
  }

  // Tier 3: Everything else
  return FileTier.OTHER;
}

// --- Strategy merging ---

/** Remove duplicate strings, preserving first-occurrence order. */
function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

/**
 * Merge multiple language-specific sampling strategies into a single unified
 * strategy. Used for multi-language monorepos where the analyzer must sample
 * files from all detected languages through a single pipeline pass.
 *
 * The merged strategy unions all patterns (entry points, domain, config,
 * exclude, extensions) with deduplication, joins language names with "/",
 * and takes the maximum `maxFilesPerCategory` across all inputs.
 *
 * @param strategies - One or more sampling strategies to merge.
 * @returns A single SamplingStrategy representing the union of all inputs.
 * @throws {Error} If the strategies array is empty.
 */
export function mergeStrategies(strategies: SamplingStrategy[]): SamplingStrategy {
  if (strategies.length === 0) {
    throw new Error('mergeStrategies requires at least one strategy');
  }
  if (strategies.length === 1) {
    return strategies[0];
  }

  return {
    language: strategies.map(s => s.language).join('/'),
    extensions: dedupe(strategies.flatMap(s => s.extensions)),
    entryPoints: dedupe(strategies.flatMap(s => s.entryPoints)),
    domainPatterns: dedupe(strategies.flatMap(s => s.domainPatterns)),
    configPatterns: dedupe(strategies.flatMap(s => s.configPatterns)),
    excludePatterns: dedupe(strategies.flatMap(s => s.excludePatterns)),
    maxFilesPerCategory: Math.max(...strategies.map(s => s.maxFilesPerCategory)),
  };
}

// --- Dynamic entry point resolution ---

/**
 * Extract file paths referenced in npm scripts.
 * Parses patterns like: "node src/server.js", "ts-node src/app.ts",
 * "tsx src/cli.ts", "python manage.py", "uvicorn app.main:app"
 */
function extractPathsFromScripts(scripts: Record<string, string>): string[] {
  const paths: string[] = [];
  const interestingScripts = ['start', 'dev', 'serve', 'main', 'server'];

  for (const [name, cmd] of Object.entries(scripts)) {
    if (!interestingScripts.includes(name)) continue;
    // Match "node path", "ts-node path", "tsx path", "npx tsx path", "python path"
    const nodeMatch = cmd.match(/(?:node|ts-node|tsx|npx\s+tsx)\s+([^\s;|&]+)/);
    if (nodeMatch) {
      let p = nodeMatch[1];
      // Convert .js references to .ts if tsconfig exists (common pattern)
      if (p.endsWith('.js')) {
        paths.push(p.replace(/\.js$/, '.ts'));
      }
      paths.push(p);
    }
    // Match "python path" or "python -m module"
    const pyMatch = cmd.match(/python[3]?\s+(?!-m\s)([^\s;|&]+)/);
    if (pyMatch) paths.push(pyMatch[1]);
    // Match "uvicorn module.path:app" → convert to file path
    const uvicornMatch = cmd.match(/uvicorn\s+([^\s:]+)/);
    if (uvicornMatch) {
      paths.push(uvicornMatch[1].replace(/\./g, '/') + '.py');
    }
    // Match "gunicorn module.path:app"
    const gunicornMatch = cmd.match(/gunicorn\s+([^\s:]+)/);
    if (gunicornMatch) {
      paths.push(gunicornMatch[1].replace(/\./g, '/') + '.py');
    }
  }
  return paths;
}

/** Read package.json and extract main/bin entry points. */
async function resolveNodeEntryPoints(dir: string): Promise<string[]> {
  const paths: string[] = [];
  try {
    const raw = await fs.readFile(path.join(dir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;

    // "main" field
    if (typeof pkg.main === 'string') {
      paths.push(pkg.main);
      // Try .ts variant
      if (pkg.main.endsWith('.js')) paths.push(pkg.main.replace(/\.js$/, '.ts'));
    }

    // "bin" field (string or object)
    if (typeof pkg.bin === 'string') {
      paths.push(pkg.bin);
    } else if (typeof pkg.bin === 'object' && pkg.bin !== null) {
      for (const p of Object.values(pkg.bin as Record<string, string>)) {
        if (typeof p === 'string') paths.push(p);
      }
    }

    // "exports" → "." → "import"/"default"
    if (typeof pkg.exports === 'object' && pkg.exports !== null) {
      const root = (pkg.exports as Record<string, unknown>)['.'];
      if (typeof root === 'string') {
        paths.push(root);
      } else if (typeof root === 'object' && root !== null) {
        const r = root as Record<string, unknown>;
        for (const key of ['import', 'default', 'require']) {
          const val = r[key];
          if (typeof val === 'string') paths.push(val);
          else if (typeof val === 'object' && val !== null) {
            const nested = val as Record<string, unknown>;
            if (typeof nested.default === 'string') paths.push(nested.default);
          }
        }
      }
    }

    // npm scripts
    if (typeof pkg.scripts === 'object' && pkg.scripts !== null) {
      paths.push(...extractPathsFromScripts(pkg.scripts as Record<string, string>));
    }
  } catch {
    // package.json not found or unparseable
  }
  return paths;
}

/** Read pyproject.toml for script entry points. */
async function resolvePythonEntryPoints(dir: string): Promise<string[]> {
  const paths: string[] = [];
  try {
    const raw = await fs.readFile(path.join(dir, 'pyproject.toml'), 'utf-8');
    // Extract [project.scripts] or [tool.poetry.scripts] entries
    // Format: cli = "package.module:func" → package/module.py
    const scriptMatches = raw.matchAll(/^\s*\w+\s*=\s*"([^":]+)/gm);
    for (const m of scriptMatches) {
      const modulePath = m[1].replace(/\./g, '/') + '.py';
      paths.push(modulePath);
      // Also try src/ prefix
      paths.push('src/' + modulePath);
    }
  } catch {
    // pyproject.toml not found
  }

  // Django: manage.py, wsgi.py, asgi.py
  for (const f of ['manage.py', 'wsgi.py', 'asgi.py']) {
    try {
      await fs.access(path.join(dir, f));
      paths.push(f);
    } catch {
      // Not found
    }
  }

  // Look for __main__.py in subdirectories (Python package entry)
  try {
    const entries = await fs.readdir(path.join(dir, 'src'), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          await fs.access(path.join(dir, 'src', entry.name, '__main__.py'));
          paths.push(`src/${entry.name}/__main__.py`);
          paths.push(`src/${entry.name}/__init__.py`);
        } catch {
          // No __main__.py
        }
      }
    }
  } catch {
    // No src/ directory
  }

  return paths;
}

/** Read Cargo.toml for binary targets. */
async function resolveRustEntryPoints(dir: string): Promise<string[]> {
  const paths: string[] = [];
  try {
    const raw = await fs.readFile(path.join(dir, 'Cargo.toml'), 'utf-8');
    // [[bin]] sections: path = "src/bin/something.rs"
    const binPaths = raw.matchAll(/path\s*=\s*"([^"]+\.rs)"/g);
    for (const m of binPaths) paths.push(m[1]);
  } catch {
    // Cargo.toml not found
  }
  return paths;
}

/** Find Go files with `package main` declarations. */
async function resolveGoEntryPoints(dir: string): Promise<string[]> {
  const paths: string[] = [];
  // Check common cmd/ patterns
  try {
    const cmdEntries = await fs.readdir(path.join(dir, 'cmd'), { withFileTypes: true });
    for (const entry of cmdEntries) {
      if (entry.isDirectory()) {
        paths.push(`cmd/${entry.name}/main.go`);
      }
    }
  } catch {
    // No cmd/ directory
  }
  return paths;
}

/** Framework-specific domain patterns that augment the base strategy. */
const FRAMEWORK_DOMAIN_PATTERNS: Record<string, string[]> = {
  'next.js': ['pages/', 'app/', 'src/pages/', 'src/app/', 'components/', 'src/components/'],
  'nuxt': ['pages/', 'components/', 'composables/', 'server/'],
  'remix': ['app/routes/', 'app/'],
  'sveltekit': ['src/routes/', 'src/lib/'],
  'express': ['routes/', 'middleware/', 'controllers/'],
  'fastify': ['routes/', 'plugins/', 'handlers/'],
  'hono': ['routes/', 'middleware/'],
  'django': ['apps/', 'views/', 'models/', 'serializers/', 'urls/', 'admin/'],
  'flask': ['blueprints/', 'views/', 'models/'],
  'fastapi': ['routers/', 'endpoints/', 'schemas/', 'crud/'],
  'react': ['src/components/', 'src/hooks/', 'src/pages/', 'src/features/'],
  'vue': ['src/components/', 'src/views/', 'src/composables/', 'src/stores/'],
  'angular': ['src/app/', 'src/environments/'],
};

/**
 * Resolve a project-specific sampling strategy by enriching the base language
 * strategy with dynamic entry points from manifest files and framework-specific
 * domain patterns.
 *
 * @param dir - Project root directory
 * @param baseStrategy - The static language strategy from STRATEGIES
 * @param framework - Detected framework (from ProjectProfile), or null
 * @param scripts - npm/project scripts (from ProjectProfile)
 * @returns A new SamplingStrategy with dynamically-resolved entry points
 *   prepended (highest priority) and framework domain patterns added.
 */
export async function resolveStrategy(
  dir: string,
  baseStrategy: SamplingStrategy,
  framework: string | null,
  scripts: Record<string, string>,
): Promise<SamplingStrategy> {
  // Resolve dynamic entry points from manifest files
  let dynamicEntries: string[] = [];
  const lang = baseStrategy.language.toLowerCase();

  if (lang === 'typescript' || lang === 'javascript') {
    dynamicEntries = await resolveNodeEntryPoints(dir);
    // Also extract from scripts
    dynamicEntries.push(...extractPathsFromScripts(scripts));
  } else if (lang === 'python') {
    dynamicEntries = await resolvePythonEntryPoints(dir);
  } else if (lang === 'rust') {
    dynamicEntries = await resolveRustEntryPoints(dir);
  } else if (lang === 'go') {
    dynamicEntries = await resolveGoEntryPoints(dir);
  }

  // Deduplicate and filter empty strings
  const uniqueEntries = [...new Set(dynamicEntries.filter(p => p.length > 0))];

  // Resolve framework-specific domain patterns
  let extraDomains: string[] = [];
  if (framework) {
    const frameworkLower = framework.toLowerCase();
    for (const [key, patterns] of Object.entries(FRAMEWORK_DOMAIN_PATTERNS)) {
      if (frameworkLower.includes(key)) {
        extraDomains.push(...patterns);
      }
    }
  }

  // Build enriched strategy: dynamic entries first, then static fallbacks
  return {
    ...baseStrategy,
    // Dynamic entries get priority (prepended), static patterns are fallback
    entryPoints: [...uniqueEntries, ...baseStrategy.entryPoints],
    // Framework patterns augment base domain patterns
    domainPatterns: [...new Set([...extraDomains, ...baseStrategy.domainPatterns])],
  };
}
