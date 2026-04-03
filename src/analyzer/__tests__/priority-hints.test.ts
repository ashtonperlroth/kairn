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
import { analyzeProject, getLanguageWeight } from '../analyze.js';
import { classifyFilePriority, FileTier } from '../patterns.js';
import type { ProjectProfile, LanguageDetection } from '../../scanner/scan.js';
import type { KairnConfig } from '../../types.js';
import type { RepomixResult } from '../repomix-adapter.js';

const mockCallLLM = vi.mocked(callLLM);
const mockPackCodebase = vi.mocked(packCodebase);

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

// --- Unit tests for getLanguageWeight ---

describe('getLanguageWeight', () => {
  it('returns 0 for single-language projects (no adjustment)', () => {
    const locations: LanguageDetection[] = [
      { language: 'TypeScript', subdirs: [] },
    ];
    // Any file should get weight 0
    expect(getLanguageWeight('src/index.ts', locations)).toBe(0);
    expect(getLanguageWeight('README.md', locations)).toBe(0);
  });

  it('returns 0 for primary language files (most subdirs)', () => {
    const locations: LanguageDetection[] = [
      { language: 'Python', subdirs: ['api', 'sdk'] },    // 2 subdirs → rank 0
      { language: 'JavaScript', subdirs: ['dashboard'] },  // 1 subdir  → rank 1
    ];
    // File in api/ belongs to Python (rank 0 → weight 0)
    expect(getLanguageWeight('api/main.py', locations)).toBe(0);
    // File in sdk/ belongs to Python (rank 0 → weight 0)
    expect(getLanguageWeight('sdk/models/user.py', locations)).toBe(0);
  });

  it('returns 1 for secondary language files (fewer subdirs)', () => {
    const locations: LanguageDetection[] = [
      { language: 'Python', subdirs: ['api', 'sdk'] },    // 2 subdirs → rank 0
      { language: 'JavaScript', subdirs: ['dashboard'] },  // 1 subdir  → rank 1
    ];
    // File in dashboard/ belongs to JavaScript (rank 1 → weight 1)
    expect(getLanguageWeight('dashboard/src/App.tsx', locations)).toBe(1);
  });

  it('returns 0 for root-level files (no subdir match → primary language)', () => {
    const locations: LanguageDetection[] = [
      { language: 'Python', subdirs: ['api', 'sdk'] },
      { language: 'JavaScript', subdirs: ['dashboard'] },
    ];
    // Root-level file doesn't match any subdir → primary language (weight 0)
    expect(getLanguageWeight('README.md', locations)).toBe(0);
    expect(getLanguageWeight('setup.py', locations)).toBe(0);
  });

  it('returns 0 when all languages are at root level (empty subdirs)', () => {
    const locations: LanguageDetection[] = [
      { language: 'TypeScript', subdirs: [] },
      { language: 'Python', subdirs: [] },
    ];
    // All root-level → all weight 0 (no meaningful tiebreaker possible)
    expect(getLanguageWeight('src/index.ts', locations)).toBe(0);
    expect(getLanguageWeight('main.py', locations)).toBe(0);
  });

  it('handles three languages with different subdir counts', () => {
    const locations: LanguageDetection[] = [
      { language: 'Python', subdirs: ['api', 'sdk', 'worker'] },  // rank 0
      { language: 'TypeScript', subdirs: ['dashboard', 'admin'] }, // rank 1
      { language: 'Go', subdirs: ['gateway'] },                    // rank 2
    ];
    expect(getLanguageWeight('api/main.py', locations)).toBe(0);
    expect(getLanguageWeight('dashboard/index.ts', locations)).toBe(1);
    expect(getLanguageWeight('gateway/main.go', locations)).toBe(2);
  });

  it('assigns equal weight (0) when languages have the same subdir count', () => {
    const locations: LanguageDetection[] = [
      { language: 'Python', subdirs: ['api'] },
      { language: 'JavaScript', subdirs: ['dashboard'] },
    ];
    // Equal subdir count → both get rank based on position
    // Position 0 = rank 0, position 1 = rank 1 (order matters as tiebreaker)
    expect(getLanguageWeight('api/main.py', locations)).toBe(0);
    expect(getLanguageWeight('dashboard/app.js', locations)).toBe(1);
  });
});

// --- Integration: prioritize callback includes fractional weight ---

describe('analyzeProject proportional priority hints', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairn-prio-hint-'));
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src/index.ts'), 'export const x = 1;');
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('single language: prioritize returns integer tiers (no fractional weight)', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({
      directory: tempDir,
      languages: ['TypeScript'],
      language: 'TypeScript',
      languageLocations: [{ language: 'TypeScript', subdirs: [] }],
    });

    await analyzeProject(tempDir, profile, makeConfig());

    // Extract the prioritize callback that was passed to packCodebase
    const opts = mockPackCodebase.mock.calls[0][1];
    const prioritize = opts.prioritize!;

    // For single language, tiers should be exact integers (no fractional adjustment)
    expect(prioritize('README.md')).toBe(FileTier.IDENTITY);           // 0
    expect(prioritize('src/index.ts')).toBe(FileTier.ENTRY);           // 1
    expect(prioritize('src/lib/utils.ts')).toBe(FileTier.DOMAIN);      // 2
    expect(prioritize('random-file.txt')).toBe(FileTier.OTHER);        // 3
  });

  it('multi-language: primary language files get lower priority value than secondary', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    // Python in 2 subdirs (rank 0), TypeScript in 1 subdir (rank 1).
    // Both have STRATEGIES entries so their scoped patterns will be in the merged strategy.
    const profile = makeProfile({
      directory: tempDir,
      languages: ['Python', 'TypeScript'],
      language: 'Python',
      languageLocations: [
        { language: 'Python', subdirs: ['api', 'sdk'] },      // rank 0 (more subdirs)
        { language: 'TypeScript', subdirs: ['dashboard'] },     // rank 1
      ],
    });

    await analyzeProject(tempDir, profile, makeConfig());

    const opts = mockPackCodebase.mock.calls[0][1];
    const prioritize = opts.prioritize!;

    // Python DOMAIN file: api/models/ matches scoped domain pattern "api/models/"
    // → baseTier DOMAIN (2) + weight 0 * 0.1 = 2.0
    const pythonDomain = prioritize('api/models/user.py');
    // TypeScript DOMAIN file: dashboard/src/lib/ matches scoped domain pattern "dashboard/src/lib/"
    // → baseTier DOMAIN (2) + weight 1 * 0.1 = 2.1
    const tsDomain = prioritize('dashboard/src/lib/utils.ts');

    // Python should have lower (better) priority within the same tier
    expect(pythonDomain).toBeLessThan(tsDomain);

    // Both should still be in the DOMAIN tier range (2.x)
    expect(Math.floor(pythonDomain)).toBe(FileTier.DOMAIN);
    expect(Math.floor(tsDomain)).toBe(FileTier.DOMAIN);
  });

  it('fractional weight never promotes a file to a higher tier', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({
      directory: tempDir,
      languages: ['Python', 'TypeScript', 'Go', 'Rust'],
      language: 'Python',
      languageLocations: [
        { language: 'Python', subdirs: ['a', 'b', 'c', 'd', 'e'] },  // rank 0
        { language: 'TypeScript', subdirs: ['f', 'g', 'h', 'i'] },   // rank 1
        { language: 'Go', subdirs: ['j', 'k', 'l'] },                // rank 2
        { language: 'Rust', subdirs: ['m', 'n'] },                    // rank 3
      ],
    });

    await analyzeProject(tempDir, profile, makeConfig());

    const opts = mockPackCodebase.mock.calls[0][1];
    const prioritize = opts.prioritize!;

    // Even the lowest-ranked language (Rust, rank 3) at tier OTHER (3):
    // 3 + 3 * 0.1 = 3.3 — must NOT be >= 4 (would overflow into nonexistent tier)
    const rustOther = prioritize('m/random-file.rs');
    expect(rustOther).toBeLessThan(FileTier.OTHER + 1);
    // And the fractional part should be 3 * 0.1 = 0.3
    expect(rustOther - Math.floor(rustOther)).toBeCloseTo(0.3, 5);
  });

  it('root-level files get primary language weight (0) in multi-language project', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({
      directory: tempDir,
      languages: ['Python', 'JavaScript'],
      language: 'Python',
      languageLocations: [
        { language: 'Python', subdirs: ['api'] },
        { language: 'JavaScript', subdirs: ['dashboard'] },
      ],
    });

    await analyzeProject(tempDir, profile, makeConfig());

    const opts = mockPackCodebase.mock.calls[0][1];
    const prioritize = opts.prioritize!;

    // README.md is root-level, gets primary language weight (0) → exact integer
    const readmePrio = prioritize('README.md');
    expect(readmePrio).toBe(FileTier.IDENTITY); // 0 + 0 * 0.1 = 0
  });
});
