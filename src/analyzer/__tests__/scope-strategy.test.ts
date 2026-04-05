import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock the LLM module
vi.mock('../../llm.js', () => ({
  callLLM: vi.fn(),
}));

// Mock repomix-adapter
vi.mock('../repomix-adapter.js', () => ({
  packCodebase: vi.fn(),
}));

import { callLLM } from '../../llm.js';
import { packCodebase } from '../repomix-adapter.js';
import { analyzeProject } from '../analyze.js';
import { scopeStrategyToSubdirs } from '../analyze.js';
import type { SamplingStrategy } from '../patterns.js';
import type { ProjectProfile } from '../../scanner/scan.js';
import type { LanguageDetection } from '../../scanner/scan.js';
import type { KairnConfig } from '../../types.js';
import type { RepomixResult } from '../repomix-adapter.js';

const mockCallLLM = vi.mocked(callLLM);
const mockPackCodebase = vi.mocked(packCodebase);

/** Minimal ProjectProfile with languageLocations for testing. */
function makeProfile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  return {
    name: 'test-project',
    description: 'A test project',
    directory: '/tmp/test',
    language: 'TypeScript',
    languages: ['TypeScript'],
    framework: null,
    typescript: true,
    dependencies: ['commander', 'chalk'],
    devDependencies: ['vitest'],
    scripts: {},
    hasTests: true,
    testCommand: 'vitest',
    buildCommand: 'tsc',
    lintCommand: 'eslint',
    hasSrc: true,
    hasDocker: false,
    hasCi: false,
    hasEnvFile: false,
    envKeys: [],
    hasClaudeDir: false,
    existingClaudeMd: null,
    existingSettings: null,
    existingMcpConfig: null,
    existingCommands: [],
    existingRules: [],
    existingSkills: [],
    existingAgents: [],
    mcpServerCount: 0,
    claudeMdLineCount: 0,
    keyFiles: ['package.json', 'tsconfig.json'],
    languageLocations: [{ language: 'TypeScript', subdirs: [] }],
    ...overrides,
  };
}

function makeConfig(): KairnConfig {
  return {
    provider: 'anthropic',
    api_key: 'test-key',
    model: 'claude-sonnet-4-20250514',
    default_runtime: 'claude-code',
    created_at: new Date().toISOString(),
  };
}

function makeValidLLMResponse(): string {
  return JSON.stringify({
    purpose: 'CLI tool',
    domain: 'developer-tools',
    key_modules: [],
    workflows: [],
    architecture_style: 'CLI',
    deployment_model: 'local',
    dataflow: [],
    config_keys: [],
  });
}

function makePackResult(overrides: Partial<RepomixResult> = {}): RepomixResult {
  return {
    content: '### src/index.ts\n\nconsole.log("hello");',
    fileCount: 1,
    tokenCount: 50,
    filePaths: ['src/index.ts'],
    ...overrides,
  };
}

describe('scopeStrategyToSubdirs', () => {
  const pythonStrategy: SamplingStrategy = {
    language: 'Python',
    extensions: ['.py'],
    entryPoints: ['main.py', 'app.py', 'src/main.py'],
    domainPatterns: ['src/', 'models/', 'services/', 'api/'],
    configPatterns: ['pyproject.toml', 'requirements.txt'],
    excludePatterns: ['**/__pycache__/**', '**/*.pyc', '**/tests/**'],
    maxFilesPerCategory: 5,
  };

  it('returns strategy unchanged when subdirs is empty (root-level)', () => {
    const result = scopeStrategyToSubdirs(pythonStrategy, []);

    expect(result).toBe(pythonStrategy);
  });

  it('scopes entry points to a single subdirectory', () => {
    const result = scopeStrategyToSubdirs(pythonStrategy, ['api']);

    expect(result.entryPoints).toEqual([
      'api/main.py',
      'api/app.py',
      'api/src/main.py',
    ]);
  });

  it('scopes domain patterns to a single subdirectory', () => {
    const result = scopeStrategyToSubdirs(pythonStrategy, ['api']);

    expect(result.domainPatterns).toEqual([
      'api/src/',
      'api/models/',
      'api/services/',
      'api/api/',
    ]);
  });

  it('scopes config patterns to a single subdirectory', () => {
    const result = scopeStrategyToSubdirs(pythonStrategy, ['api']);

    expect(result.configPatterns).toEqual([
      'api/pyproject.toml',
      'api/requirements.txt',
    ]);
  });

  it('preserves exclude patterns as global (not scoped)', () => {
    const result = scopeStrategyToSubdirs(pythonStrategy, ['api']);

    expect(result.excludePatterns).toEqual(pythonStrategy.excludePatterns);
  });

  it('scopes to multiple subdirectories via flatMap', () => {
    const result = scopeStrategyToSubdirs(pythonStrategy, ['api', 'sdk']);

    // Entry points should have versions for both dirs
    expect(result.entryPoints).toEqual([
      'api/main.py',
      'api/app.py',
      'api/src/main.py',
      'sdk/main.py',
      'sdk/app.py',
      'sdk/src/main.py',
    ]);

    // Domain patterns for both dirs
    expect(result.domainPatterns).toEqual([
      'api/src/',
      'api/models/',
      'api/services/',
      'api/api/',
      'sdk/src/',
      'sdk/models/',
      'sdk/services/',
      'sdk/api/',
    ]);

    // Config patterns for both dirs
    expect(result.configPatterns).toEqual([
      'api/pyproject.toml',
      'api/requirements.txt',
      'sdk/pyproject.toml',
      'sdk/requirements.txt',
    ]);
  });

  it('preserves other strategy fields unchanged', () => {
    const result = scopeStrategyToSubdirs(pythonStrategy, ['api']);

    expect(result.language).toBe('Python');
    expect(result.extensions).toEqual(['.py']);
    expect(result.maxFilesPerCategory).toBe(5);
  });

  it('does not mutate the original strategy', () => {
    const originalEntryPoints = [...pythonStrategy.entryPoints];
    const originalDomainPatterns = [...pythonStrategy.domainPatterns];

    scopeStrategyToSubdirs(pythonStrategy, ['api']);

    expect(pythonStrategy.entryPoints).toEqual(originalEntryPoints);
    expect(pythonStrategy.domainPatterns).toEqual(originalDomainPatterns);
  });
});

describe('analyzeProject with monorepo scoping', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairn-scope-test-'));
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src/index.ts'), 'export const x = 1;');
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('does NOT scope patterns when languageLocations have empty subdirs (root)', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({
      directory: tempDir,
      languages: ['TypeScript'],
      language: 'TypeScript',
      languageLocations: [{ language: 'TypeScript', subdirs: [] }],
    });

    await analyzeProject(tempDir, profile, makeConfig());

    const opts = mockPackCodebase.mock.calls[0][1];
    // Entry points should be un-scoped (global)
    expect(opts.include).toEqual(expect.arrayContaining(['src/index.ts', 'src/main.ts']));
    // Should NOT have subdirectory-prefixed patterns
    expect(opts.include).not.toEqual(expect.arrayContaining([expect.stringMatching(/^[a-z]+\/src\/index\.ts$/)]));
  });

  it('scopes Python patterns to subdirectory when detected in subdir', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({
      directory: tempDir,
      languages: ['Python'],
      language: 'Python',
      languageLocations: [{ language: 'Python', subdirs: ['api'] }],
    });

    await analyzeProject(tempDir, profile, makeConfig());

    const opts = mockPackCodebase.mock.calls[0][1];
    // Python entry points should be scoped to api/
    expect(opts.include).toEqual(expect.arrayContaining(['api/main.py', 'api/app.py']));
    // Should NOT have un-scoped Python patterns
    expect(opts.include).not.toContain('main.py');
    expect(opts.include).not.toContain('app.py');
  });

  it('handles mixed root + subdir detection (TypeScript root + Python subdir)', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({
      directory: tempDir,
      languages: ['TypeScript', 'Python'],
      language: 'TypeScript',
      languageLocations: [
        { language: 'TypeScript', subdirs: [] },         // root-level = no scoping
        { language: 'Python', subdirs: ['api'] },        // subdir = scoped
      ],
    });

    await analyzeProject(tempDir, profile, makeConfig());

    const opts = mockPackCodebase.mock.calls[0][1];
    // TypeScript: global (no scoping)
    expect(opts.include).toEqual(expect.arrayContaining(['src/index.ts', 'src/main.ts']));
    // Python: scoped to api/
    expect(opts.include).toEqual(expect.arrayContaining(['api/main.py', 'api/app.py']));
    // Python patterns should NOT be global
    expect(opts.include).not.toContain('main.py');
  });

  it('scopes Python to multiple subdirectories', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({
      directory: tempDir,
      languages: ['Python'],
      language: 'Python',
      languageLocations: [
        { language: 'Python', subdirs: ['api', 'sdk'] },
      ],
    });

    await analyzeProject(tempDir, profile, makeConfig());

    const opts = mockPackCodebase.mock.calls[0][1];
    // Should have entry points for both subdirs
    expect(opts.include).toEqual(expect.arrayContaining([
      'api/main.py',
      'api/app.py',
      'sdk/main.py',
      'sdk/app.py',
    ]));
    // Domain patterns scoped to both subdirs
    expect(opts.include).toEqual(expect.arrayContaining([
      'api/models/**/*',
      'sdk/models/**/*',
    ]));
  });

  it('falls back to languages array when languageLocations is missing (backward compat)', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    // Profile without languageLocations (simulating old code)
    const profile = makeProfile({
      directory: tempDir,
      languages: ['TypeScript'],
      language: 'TypeScript',
      languageLocations: undefined,
    });

    await analyzeProject(tempDir, profile, makeConfig());

    // Should still work — patterns are un-scoped (root)
    const opts = mockPackCodebase.mock.calls[0][1];
    expect(opts.include).toEqual(expect.arrayContaining(['src/index.ts', 'src/main.ts']));
  });
});
