import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock the LLM module — must be before imports that depend on it
vi.mock('../../llm.js', () => ({
  callLLM: vi.fn(),
}));

// Mock repomix-adapter — must be before imports that depend on it
vi.mock('../repomix-adapter.js', () => ({
  packCodebase: vi.fn(),
}));

import { callLLM } from '../../llm.js';
import { packCodebase } from '../repomix-adapter.js';
import { analyzeProject } from '../analyze.js';
import { AnalysisError } from '../types.js';
import type { ProjectAnalysis, AnalysisResult } from '../types.js';
import type { ProjectProfile } from '../../scanner/scan.js';
import type { KairnConfig } from '../../types.js';
import type { RepomixResult } from '../repomix-adapter.js';

const mockCallLLM = vi.mocked(callLLM);
const mockPackCodebase = vi.mocked(packCodebase);

/** Minimal ProjectProfile with TypeScript language for testing. */
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
    ...overrides,
  };
}

/** Minimal KairnConfig for testing. */
function makeConfig(overrides: Partial<KairnConfig> = {}): KairnConfig {
  return {
    provider: 'anthropic',
    api_key: 'test-key',
    model: 'claude-sonnet-4-20250514',
    default_runtime: 'claude-code',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Valid LLM JSON response matching ProjectAnalysis shape. */
function makeValidLLMResponse(): string {
  return JSON.stringify({
    purpose: 'CLI tool for compiling agent environments',
    domain: 'developer-tools',
    key_modules: [
      {
        name: 'compiler',
        path: 'src/compiler/',
        description: 'Compiles intent into environment specs',
        responsibilities: ['LLM orchestration', 'spec generation'],
      },
    ],
    workflows: [
      {
        name: 'compile',
        description: 'Compile workflow intent into environment',
        trigger: 'kairn describe',
        steps: ['parse intent', 'call LLM', 'write files'],
      },
    ],
    architecture_style: 'CLI',
    deployment_model: 'local',
    dataflow: [
      { from: 'cli', to: 'compiler', data: 'user intent string' },
    ],
    config_keys: [
      { name: 'ANTHROPIC_API_KEY', purpose: 'LLM authentication' },
    ],
  });
}

/** Fake RepomixResult for mocking packCodebase. */
function makePackResult(overrides: Partial<RepomixResult> = {}): RepomixResult {
  return {
    content: '### src/index.ts\n\nconsole.log("hello");',
    fileCount: 1,
    tokenCount: 50,
    filePaths: ['src/index.ts'],
    ...overrides,
  };
}

describe('analyzeProject', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairn-analyze-test-'));
    // Create a dummy file so computeContentHash has something to read
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src/index.ts'), 'export const x = 1;');
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns an AnalysisResult with both analysis and packedSource', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({ directory: tempDir });
    const config = makeConfig();

    const result: AnalysisResult = await analyzeProject(tempDir, profile, config);

    // Should return the correct shape
    expect(result).toHaveProperty('analysis');
    expect(result).toHaveProperty('packedSource');

    // Analysis should be valid
    const { analysis } = result;
    expect(analysis.purpose).toBe('CLI tool for compiling agent environments');
    expect(analysis.domain).toBe('developer-tools');
    expect(analysis.key_modules).toHaveLength(1);
    expect(analysis.key_modules[0].name).toBe('compiler');
    expect(analysis.workflows).toHaveLength(1);
    expect(analysis.architecture_style).toBe('CLI');
    expect(analysis.deployment_model).toBe('local');
    expect(analysis.dataflow).toHaveLength(1);
    expect(analysis.config_keys).toHaveLength(1);
    expect(analysis.sampled_files).toEqual(['src/index.ts']);
    expect(typeof analysis.content_hash).toBe('string');
    expect(analysis.content_hash.length).toBe(64);
    expect(typeof analysis.analyzed_at).toBe('string');

    // Packed source should be the raw content from packCodebase
    expect(result.packedSource).toBe('### src/index.ts\n\nconsole.log("hello");');
  });

  it('calls packCodebase with correct include patterns from strategy', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({ directory: tempDir });
    const config = makeConfig();

    await analyzeProject(tempDir, profile, config);

    expect(mockPackCodebase).toHaveBeenCalledOnce();
    const callArgs = mockPackCodebase.mock.calls[0];
    expect(callArgs[0]).toBe(tempDir);

    const opts = callArgs[1];
    // Should include TypeScript entry points
    expect(opts.include).toEqual(
      expect.arrayContaining(['src/index.ts', 'src/main.ts']),
    );
    // Should include always-include patterns
    expect(opts.include).toEqual(
      expect.arrayContaining(['README.md', '*.toml']),
    );
    // Should have exclude patterns
    expect(opts.exclude).toEqual(
      expect.arrayContaining(['**/__tests__/**', '**/node_modules/**']),
    );
    expect(opts.maxTokens).toBe(60_000);
    expect(typeof opts.prioritize).toBe('function');
  });

  it('calls callLLM with correct system prompt and user message', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({ directory: tempDir, name: 'my-project', description: 'My cool project' });
    const config = makeConfig();

    await analyzeProject(tempDir, profile, config);

    expect(mockCallLLM).toHaveBeenCalledOnce();
    const callArgs = mockCallLLM.mock.calls[0];

    // First arg: config
    expect(callArgs[0]).toBe(config);

    // Second arg: user message — should contain project details
    const userMessage = callArgs[1];
    expect(userMessage).toContain('TypeScript');
    expect(userMessage).toContain('my-project');
    expect(userMessage).toContain('My cool project');
    expect(userMessage).toContain('commander');

    // Third arg: options
    const opts = callArgs[2];
    expect(opts.jsonMode).toBe(true);
    expect(opts.maxTokens).toBe(4096);
    expect(opts.agentName).toBe('analyzer');
    expect(opts.systemPrompt).toContain('JSON');
  });

  it('throws AnalysisError with type no_entry_point for unsupported language', async () => {
    const profile = makeProfile({ language: 'Cobol', languages: ['Cobol'], directory: tempDir });
    const config = makeConfig();

    await expect(analyzeProject(tempDir, profile, config)).rejects.toThrow(AnalysisError);

    try {
      await analyzeProject(tempDir, profile, config);
    } catch (err) {
      expect(err).toBeInstanceOf(AnalysisError);
      expect((err as AnalysisError).type).toBe('no_entry_point');
      expect((err as AnalysisError).message).toContain('Cobol');
    }
  });

  it('throws AnalysisError with type no_entry_point when languages is empty', async () => {
    const profile = makeProfile({ language: null, languages: [], directory: tempDir });
    const config = makeConfig();

    await expect(analyzeProject(tempDir, profile, config)).rejects.toThrow(AnalysisError);

    try {
      await analyzeProject(tempDir, profile, config);
    } catch (err) {
      expect(err).toBeInstanceOf(AnalysisError);
      expect((err as AnalysisError).type).toBe('no_entry_point');
      expect((err as AnalysisError).message).toContain('none detected');
    }
  });

  // --- Multi-language strategy merging ---

  it('merges strategies for multiple languages (Python + TypeScript)', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({
      language: 'Python',
      languages: ['Python', 'TypeScript'],
      directory: tempDir,
    });
    const config = makeConfig();

    const result = await analyzeProject(tempDir, profile, config);

    // Should succeed (no error thrown)
    expect(result.analysis.purpose).toBe('CLI tool for compiling agent environments');

    // packCodebase should be called with patterns from BOTH languages
    const callArgs = mockPackCodebase.mock.calls[0];
    const opts = callArgs[1];
    // Python entry points
    expect(opts.include).toEqual(expect.arrayContaining(['main.py', 'app.py']));
    // TypeScript entry points
    expect(opts.include).toEqual(expect.arrayContaining(['src/index.ts', 'src/main.ts']));
    // Both exclude patterns
    expect(opts.exclude).toEqual(expect.arrayContaining(['**/__pycache__/**']));
    expect(opts.exclude).toEqual(expect.arrayContaining(['**/node_modules/**']));
  });

  it('works with a single language in languages array (backward compat)', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({
      language: 'Python',
      languages: ['Python'],
      directory: tempDir,
    });
    const config = makeConfig();

    const result = await analyzeProject(tempDir, profile, config);
    expect(result.analysis.purpose).toBe('CLI tool for compiling agent environments');

    // Should only have Python patterns
    const callArgs = mockPackCodebase.mock.calls[0];
    const opts = callArgs[1];
    expect(opts.include).toEqual(expect.arrayContaining(['main.py', 'app.py']));
    expect(opts.include).not.toEqual(expect.arrayContaining(['src/index.ts']));
  });

  it('filters out unsupported languages and uses remaining ones (Python + Cobol)', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({
      language: 'Python',
      languages: ['Python', 'Cobol'],
      directory: tempDir,
    });
    const config = makeConfig();

    // Should NOT throw — Cobol is filtered out, Python remains
    const result = await analyzeProject(tempDir, profile, config);
    expect(result.analysis.purpose).toBe('CLI tool for compiling agent environments');

    // Should only have Python patterns
    const callArgs = mockPackCodebase.mock.calls[0];
    const opts = callArgs[1];
    expect(opts.include).toEqual(expect.arrayContaining(['main.py', 'app.py']));
  });

  it('sends merged language name in LLM user message', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({
      language: 'Python',
      languages: ['Python', 'TypeScript'],
      directory: tempDir,
      name: 'multi-lang-project',
    });
    const config = makeConfig();

    await analyzeProject(tempDir, profile, config);

    const userMessage = mockCallLLM.mock.calls[0][1];
    expect(userMessage).toContain('Python/TypeScript');
    expect(userMessage).toContain('multi-lang-project');
  });

  it('propagates AnalysisError with type empty_sample when packCodebase throws it', async () => {
    mockPackCodebase.mockRejectedValue(
      new AnalysisError('No source files found to sample', 'empty_sample', 'details'),
    );

    const profile = makeProfile({ directory: tempDir });
    const config = makeConfig();

    await expect(analyzeProject(tempDir, profile, config)).rejects.toThrow(AnalysisError);

    try {
      await analyzeProject(tempDir, profile, config);
    } catch (err) {
      expect(err).toBeInstanceOf(AnalysisError);
      expect((err as AnalysisError).type).toBe('empty_sample');
    }
  });

  it('throws AnalysisError with type llm_parse_failure when LLM returns invalid JSON', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue('This is not JSON at all');

    const profile = makeProfile({ directory: tempDir });
    const config = makeConfig();

    await expect(analyzeProject(tempDir, profile, config)).rejects.toThrow(AnalysisError);

    try {
      await analyzeProject(tempDir, profile, config);
    } catch (err) {
      expect(err).toBeInstanceOf(AnalysisError);
      expect((err as AnalysisError).type).toBe('llm_parse_failure');
      expect((err as AnalysisError).details).toBeDefined();
    }
  });

  it('throws AnalysisError with type llm_parse_failure when LLM response is missing required fields', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    // Valid JSON but missing purpose and domain
    mockCallLLM.mockResolvedValue(JSON.stringify({ key_modules: [], workflows: [] }));

    const profile = makeProfile({ directory: tempDir });
    const config = makeConfig();

    await expect(analyzeProject(tempDir, profile, config)).rejects.toThrow(AnalysisError);

    try {
      await analyzeProject(tempDir, profile, config);
    } catch (err) {
      expect(err).toBeInstanceOf(AnalysisError);
      expect((err as AnalysisError).type).toBe('llm_parse_failure');
      expect((err as AnalysisError).message).toContain('required fields');
    }
  });

  it('strips markdown code fences from LLM response before parsing', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    const jsonBody = makeValidLLMResponse();
    mockCallLLM.mockResolvedValue('```json\n' + jsonBody + '\n```');

    const profile = makeProfile({ directory: tempDir });
    const config = makeConfig();

    const result = await analyzeProject(tempDir, profile, config);

    expect(result.analysis.purpose).toBe('CLI tool for compiling agent environments');
    expect(result.analysis.domain).toBe('developer-tools');
  });

  it('writes cache after successful analysis', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({ directory: tempDir });
    const config = makeConfig();

    await analyzeProject(tempDir, profile, config);

    // Verify cache file was written
    const cacheFile = path.join(tempDir, '.kairn-analysis.json');
    const stat = await fs.stat(cacheFile);
    expect(stat.isFile()).toBe(true);

    const cached = JSON.parse(await fs.readFile(cacheFile, 'utf-8')) as {
      analysis: ProjectAnalysis;
      content_hash: string;
      kairn_version: string;
    };
    expect(cached.analysis.purpose).toBe('CLI tool for compiling agent environments');
    expect(typeof cached.content_hash).toBe('string');
    expect(typeof cached.kairn_version).toBe('string');
  });

  it('returns cached packed source from .kairn-packed-source.txt on cache hit', async () => {
    const packedContent = '### src/index.ts\n\nconsole.log("cached packed!");';
    mockPackCodebase.mockResolvedValue(makePackResult({ content: packedContent }));
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({ directory: tempDir });
    const config = makeConfig();

    // First call: fresh analysis
    const first = await analyzeProject(tempDir, profile, config);
    expect(first.packedSource).toBe(packedContent);

    // Reset mocks to verify cache path
    vi.clearAllMocks();

    // Second call: should use cache — no LLM or packCodebase calls
    const second = await analyzeProject(tempDir, profile, config);

    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockPackCodebase).not.toHaveBeenCalled();
    expect(second.packedSource).toBe(packedContent);
    expect(second.analysis.purpose).toBe(first.analysis.purpose);
  });

  it('returns empty string for packedSource when cache exists but packed source file is missing', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({ directory: tempDir });
    const config = makeConfig();

    // Create a fresh analysis (which writes both cache files)
    await analyzeProject(tempDir, profile, config);

    // Manually delete the packed source file to simulate a legacy cache
    await fs.unlink(path.join(tempDir, '.kairn-packed-source.txt'));

    vi.clearAllMocks();

    // Second call: cache hit, but no packed source file
    const result = await analyzeProject(tempDir, profile, config);

    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockPackCodebase).not.toHaveBeenCalled();
    expect(result.packedSource).toBe('');
    expect(result.analysis.purpose).toBe('CLI tool for compiling agent environments');
  });

  it('returns cached analysis when cache is valid and refresh is not set', async () => {
    // First, run the analysis to create a valid cache
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({ directory: tempDir });
    const config = makeConfig();

    const first = await analyzeProject(tempDir, profile, config);

    // Reset mocks to track second call
    vi.clearAllMocks();

    // Second call should use cache — no LLM or packCodebase calls
    const second = await analyzeProject(tempDir, profile, config);

    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockPackCodebase).not.toHaveBeenCalled();
    expect(second.analysis.purpose).toBe(first.analysis.purpose);
    expect(second.analysis.domain).toBe(first.analysis.domain);
    expect(second.analysis.content_hash).toBe(first.analysis.content_hash);
  });

  it('bypasses cache when refresh option is true', async () => {
    // First, run the analysis to create a valid cache
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({ directory: tempDir });
    const config = makeConfig();

    await analyzeProject(tempDir, profile, config);

    // Reset mocks to track second call
    vi.clearAllMocks();
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(
      JSON.stringify({
        purpose: 'Updated purpose',
        domain: 'updated-domain',
        key_modules: [],
        workflows: [],
        architecture_style: 'CLI',
        deployment_model: 'local',
        dataflow: [],
        config_keys: [],
      }),
    );

    // With refresh: true, should call LLM again
    const result = await analyzeProject(tempDir, profile, config, { refresh: true });

    expect(mockCallLLM).toHaveBeenCalledOnce();
    expect(mockPackCodebase).toHaveBeenCalledOnce();
    expect(result.analysis.purpose).toBe('Updated purpose');
    expect(result.analysis.domain).toBe('updated-domain');
  });

  it('defaults optional arrays to empty when LLM omits them', async () => {
    mockPackCodebase.mockResolvedValue(makePackResult());
    mockCallLLM.mockResolvedValue(
      JSON.stringify({
        purpose: 'Minimal project',
        domain: 'testing',
        // All optional arrays omitted
      }),
    );

    const profile = makeProfile({ directory: tempDir });
    const config = makeConfig();

    const result = await analyzeProject(tempDir, profile, config);

    expect(result.analysis.key_modules).toEqual([]);
    expect(result.analysis.workflows).toEqual([]);
    expect(result.analysis.dataflow).toEqual([]);
    expect(result.analysis.config_keys).toEqual([]);
    expect(result.analysis.architecture_style).toBe('unknown');
    expect(result.analysis.deployment_model).toBe('unknown');
  });

  it('writes packed source file alongside analysis cache', async () => {
    const packedContent = '### src/index.ts\n\nconsole.log("packed source!");';
    mockPackCodebase.mockResolvedValue(makePackResult({ content: packedContent }));
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({ directory: tempDir });
    const config = makeConfig();

    const result = await analyzeProject(tempDir, profile, config);

    // Verify packed source file was written
    const packedPath = path.join(tempDir, '.kairn-packed-source.txt');
    const stat = await fs.stat(packedPath);
    expect(stat.isFile()).toBe(true);

    const content = await fs.readFile(packedPath, 'utf-8');
    expect(content).toBe(packedContent);

    // Also verify the return value includes packed source
    expect(result.packedSource).toBe(packedContent);
  });

  it('returns packed source with custom content from packCodebase', async () => {
    const customPacked = '## Packed\n\nFile A content\n\nFile B content';
    mockPackCodebase.mockResolvedValue(makePackResult({ content: customPacked }));
    mockCallLLM.mockResolvedValue(makeValidLLMResponse());

    const profile = makeProfile({ directory: tempDir });
    const config = makeConfig();

    const result = await analyzeProject(tempDir, profile, config);

    expect(typeof result.packedSource).toBe('string');
    expect(result.packedSource).toBe(customPacked);
    expect(result.packedSource.length).toBeGreaterThan(0);
  });
});
