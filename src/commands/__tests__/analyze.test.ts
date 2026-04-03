import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock ora (spinner)
const spinnerMock = {
  start: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
};
vi.mock('ora', () => ({
  default: vi.fn(() => spinnerMock),
}));

vi.mock('../../config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../scanner/scan.js', () => ({
  scanProject: vi.fn(),
}));

vi.mock('../../analyzer/analyze.js', () => ({
  analyzeProject: vi.fn(),
}));

vi.mock('../../analyzer/cache.js', () => ({
  readCache: vi.fn(),
}));

vi.mock('../../logo.js', () => ({
  printCompactBanner: vi.fn(),
}));

// Capture console.log output for assertions
let consoleLogs: string[];
const originalLog = console.log;
let mockProcessExit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleLogs = [];
  console.log = (...args: unknown[]) => {
    consoleLogs.push(args.map(String).join(' '));
  };
  mockProcessExit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
  }) as never);
  vi.clearAllMocks();
});

afterEach(() => {
  console.log = originalLog;
  mockProcessExit.mockRestore();
});

describe('analyzeCommand', () => {
  it('exports a Command instance named "analyze"', async () => {
    const { analyzeCommand } = await import('../analyze.js');
    expect(analyzeCommand).toBeInstanceOf(Command);
    expect(analyzeCommand.name()).toBe('analyze');
  });

  it('has --refresh and --json options', async () => {
    const { analyzeCommand } = await import('../analyze.js');
    const opts = analyzeCommand.options.map((o) => o.long);
    expect(opts).toContain('--refresh');
    expect(opts).toContain('--json');
  });

  it('has the correct description', async () => {
    const { analyzeCommand } = await import('../analyze.js');
    expect(analyzeCommand.description()).toContain('Analyze');
  });

  it('exports analyzeAction as a named function', async () => {
    const { analyzeAction } = await import('../analyze.js');
    expect(typeof analyzeAction).toBe('function');
  });

  describe('analyzeAction', () => {
    let mockLoadConfig: ReturnType<typeof vi.fn>;
    let mockScanProject: ReturnType<typeof vi.fn>;
    let mockAnalyzeProject: ReturnType<typeof vi.fn>;
    let mockReadCache: ReturnType<typeof vi.fn>;
    let mockPrintCompactBanner: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const configMod = await import('../../config.js');
      const scanMod = await import('../../scanner/scan.js');
      const analyzeMod = await import('../../analyzer/analyze.js');
      const cacheMod = await import('../../analyzer/cache.js');
      const logoMod = await import('../../logo.js');

      mockLoadConfig = configMod.loadConfig as ReturnType<typeof vi.fn>;
      mockScanProject = scanMod.scanProject as ReturnType<typeof vi.fn>;
      mockAnalyzeProject = analyzeMod.analyzeProject as ReturnType<typeof vi.fn>;
      mockReadCache = cacheMod.readCache as ReturnType<typeof vi.fn>;
      mockPrintCompactBanner = logoMod.printCompactBanner as ReturnType<typeof vi.fn>;
    });

    it('exits with error when no config is found', async () => {
      mockLoadConfig.mockResolvedValue(null);

      const { analyzeAction } = await import('../analyze.js');
      await expect(analyzeAction({})).rejects.toThrow('process.exit called');

      expect(mockProcessExit).toHaveBeenCalledWith(1);
      const output = consoleLogs.join('\n');
      expect(output).toContain('No config found');
    });

    it('exits with error JSON when no config and --json flag', async () => {
      mockLoadConfig.mockResolvedValue(null);

      const { analyzeAction } = await import('../analyze.js');
      await expect(analyzeAction({ json: true })).rejects.toThrow('process.exit called');

      expect(mockProcessExit).toHaveBeenCalledWith(1);
      const output = consoleLogs.join('\n');
      const parsed = JSON.parse(output.trim());
      expect(parsed.error).toContain('No config found');
    });

    it('calls printCompactBanner when not in json mode', async () => {
      mockLoadConfig.mockResolvedValue(null);

      const { analyzeAction } = await import('../analyze.js');
      await expect(analyzeAction({})).rejects.toThrow('process.exit called');

      expect(mockPrintCompactBanner).toHaveBeenCalled();
    });

    it('does not call printCompactBanner in json mode', async () => {
      mockLoadConfig.mockResolvedValue(null);

      const { analyzeAction } = await import('../analyze.js');
      await expect(analyzeAction({ json: true })).rejects.toThrow('process.exit called');

      expect(mockPrintCompactBanner).not.toHaveBeenCalled();
    });

    it('scans, analyzes, and displays formatted output on success', async () => {
      const fakeConfig = {
        provider: 'anthropic',
        api_key: 'test-key',
        model: 'claude-sonnet-4-6',
        default_runtime: 'claude-code',
        created_at: new Date().toISOString(),
      };

      const fakeProfile = {
        name: 'test-project',
        description: 'A test',
        directory: '/tmp/test',
        language: 'TypeScript',
        framework: 'Express',
        typescript: true,
        dependencies: [],
        devDependencies: [],
        scripts: {},
        hasTests: true,
        testCommand: 'vitest',
        buildCommand: 'tsup',
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
      };

      const fakeAnalysis = {
        purpose: 'CLI tool for environment compilation',
        domain: 'developer-tools',
        key_modules: [
          {
            name: 'compiler',
            path: 'src/compiler/',
            description: 'Compiles intent into environments',
            responsibilities: ['parsing', 'generation'],
          },
        ],
        workflows: [
          {
            name: 'compile',
            description: 'Compile an environment',
            trigger: 'kairn describe',
            steps: ['scan', 'analyze', 'compile'],
          },
        ],
        architecture_style: 'CLI',
        deployment_model: 'local',
        dataflow: [
          { from: 'scanner', to: 'compiler', data: 'ProjectProfile' },
        ],
        config_keys: [
          { name: 'ANTHROPIC_API_KEY', purpose: 'LLM authentication' },
        ],
        sampled_files: ['src/cli.ts', 'src/types.ts'],
        content_hash: 'abc123',
        analyzed_at: '2026-04-03T12:00:00.000Z',
      };

      mockLoadConfig.mockResolvedValue(fakeConfig);
      mockScanProject.mockResolvedValue(fakeProfile);
      mockAnalyzeProject.mockResolvedValue({ analysis: fakeAnalysis, packedSource: '## packed source content' });
      mockReadCache.mockResolvedValue(null);

      const { analyzeAction } = await import('../analyze.js');
      await analyzeAction({});

      const output = consoleLogs.join('\n');

      // Should display key analysis fields
      expect(output).toContain('CLI tool for environment compilation');
      expect(output).toContain('developer-tools');
      expect(output).toContain('CLI');
      expect(output).toContain('local');

      // Should display key modules
      expect(output).toContain('compiler');
      expect(output).toContain('Compiles intent into environments');

      // Should display workflows
      expect(output).toContain('compile');

      // Should display dataflow
      expect(output).toContain('scanner');
      expect(output).toContain('ProjectProfile');

      // Should display config keys
      expect(output).toContain('ANTHROPIC_API_KEY');

      // Should display scan profile info
      expect(output).toContain('TypeScript');
      expect(output).toContain('Express');
    });

    it('outputs raw JSON when --json flag is set', async () => {
      const fakeConfig = {
        provider: 'anthropic',
        api_key: 'test-key',
        model: 'claude-sonnet-4-6',
        default_runtime: 'claude-code',
        created_at: new Date().toISOString(),
      };

      const fakeProfile = {
        name: 'test-project',
        description: '',
        directory: '/tmp/test',
        language: 'TypeScript',
        framework: null,
        typescript: true,
        dependencies: [],
        devDependencies: [],
        scripts: {},
        hasTests: false,
        testCommand: null,
        buildCommand: null,
        lintCommand: null,
        hasSrc: false,
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
        keyFiles: [],
      };

      const fakeAnalysis = {
        purpose: 'Test project',
        domain: 'testing',
        key_modules: [],
        workflows: [],
        architecture_style: 'monolithic',
        deployment_model: 'local',
        dataflow: [],
        config_keys: [],
        sampled_files: ['src/index.ts'],
        content_hash: 'def456',
        analyzed_at: '2026-04-03T12:00:00.000Z',
      };

      mockLoadConfig.mockResolvedValue(fakeConfig);
      mockScanProject.mockResolvedValue(fakeProfile);
      mockAnalyzeProject.mockResolvedValue({ analysis: fakeAnalysis, packedSource: '## packed source content' });
      mockReadCache.mockResolvedValue(null);

      const { analyzeAction } = await import('../analyze.js');
      await analyzeAction({ json: true });

      // Find the JSON output (should be the full stringified analysis)
      const jsonOutput = consoleLogs.join('\n').trim();
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.purpose).toBe('Test project');
      expect(parsed.domain).toBe('testing');
    });

    it('passes --refresh option to analyzeProject', async () => {
      const fakeConfig = {
        provider: 'anthropic',
        api_key: 'test-key',
        model: 'claude-sonnet-4-6',
        default_runtime: 'claude-code',
        created_at: new Date().toISOString(),
      };

      const fakeProfile = {
        name: 'test',
        description: '',
        directory: '/tmp/test',
        language: 'TypeScript',
        framework: null,
        typescript: true,
        dependencies: [],
        devDependencies: [],
        scripts: {},
        hasTests: false,
        testCommand: null,
        buildCommand: null,
        lintCommand: null,
        hasSrc: false,
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
        keyFiles: [],
      };

      const fakeAnalysis = {
        purpose: 'Test',
        domain: 'test',
        key_modules: [],
        workflows: [],
        architecture_style: 'monolithic',
        deployment_model: 'local',
        dataflow: [],
        config_keys: [],
        sampled_files: [],
        content_hash: 'hash',
        analyzed_at: '2026-04-03T12:00:00.000Z',
      };

      mockLoadConfig.mockResolvedValue(fakeConfig);
      mockScanProject.mockResolvedValue(fakeProfile);
      mockAnalyzeProject.mockResolvedValue({ analysis: fakeAnalysis, packedSource: '## packed source content' });
      mockReadCache.mockResolvedValue(null);

      const { analyzeAction } = await import('../analyze.js');
      await analyzeAction({ refresh: true });

      expect(mockAnalyzeProject).toHaveBeenCalledWith(
        expect.any(String),
        fakeProfile,
        fakeConfig,
        { refresh: true },
      );
    });

    it('handles AnalysisError with formatted output', async () => {
      const fakeConfig = {
        provider: 'anthropic',
        api_key: 'test-key',
        model: 'claude-sonnet-4-6',
        default_runtime: 'claude-code',
        created_at: new Date().toISOString(),
      };

      const fakeProfile = {
        name: 'test',
        description: '',
        directory: '/tmp/test',
        language: null,
        framework: null,
        typescript: false,
        dependencies: [],
        devDependencies: [],
        scripts: {},
        hasTests: false,
        testCommand: null,
        buildCommand: null,
        lintCommand: null,
        hasSrc: false,
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
        keyFiles: [],
      };

      mockLoadConfig.mockResolvedValue(fakeConfig);
      mockScanProject.mockResolvedValue(fakeProfile);

      const { AnalysisError } = await import('../../analyzer/types.js');
      mockAnalyzeProject.mockRejectedValue(
        new AnalysisError(
          'No sampling strategy for language: unknown',
          'no_entry_point',
          'Supported: Python, TypeScript, Go, Rust',
        ),
      );
      mockReadCache.mockResolvedValue(null);

      const { analyzeAction } = await import('../analyze.js');
      await expect(analyzeAction({})).rejects.toThrow('process.exit called');

      expect(mockProcessExit).toHaveBeenCalledWith(1);
      const output = consoleLogs.join('\n');
      expect(output).toContain('No sampling strategy');
      expect(output).toContain('no_entry_point');
    });

    it('handles AnalysisError with JSON output when --json flag is set', async () => {
      const fakeConfig = {
        provider: 'anthropic',
        api_key: 'test-key',
        model: 'claude-sonnet-4-6',
        default_runtime: 'claude-code',
        created_at: new Date().toISOString(),
      };

      const fakeProfile = {
        name: 'test',
        description: '',
        directory: '/tmp/test',
        language: null,
        framework: null,
        typescript: false,
        dependencies: [],
        devDependencies: [],
        scripts: {},
        hasTests: false,
        testCommand: null,
        buildCommand: null,
        lintCommand: null,
        hasSrc: false,
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
        keyFiles: [],
      };

      mockLoadConfig.mockResolvedValue(fakeConfig);
      mockScanProject.mockResolvedValue(fakeProfile);

      const { AnalysisError } = await import('../../analyzer/types.js');
      mockAnalyzeProject.mockRejectedValue(
        new AnalysisError('Empty sample', 'empty_sample', 'No files found'),
      );
      mockReadCache.mockResolvedValue(null);

      const { analyzeAction } = await import('../analyze.js');
      await expect(analyzeAction({ json: true })).rejects.toThrow('process.exit called');

      const output = consoleLogs.join('\n');
      const parsed = JSON.parse(output.trim());
      expect(parsed.error).toBe('Empty sample');
      expect(parsed.type).toBe('empty_sample');
      expect(parsed.details).toBe('No files found');
    });

    it('re-throws non-AnalysisError errors', async () => {
      const fakeConfig = {
        provider: 'anthropic',
        api_key: 'test-key',
        model: 'claude-sonnet-4-6',
        default_runtime: 'claude-code',
        created_at: new Date().toISOString(),
      };

      const fakeProfile = {
        name: 'test',
        description: '',
        directory: '/tmp/test',
        language: 'TypeScript',
        framework: null,
        typescript: true,
        dependencies: [],
        devDependencies: [],
        scripts: {},
        hasTests: false,
        testCommand: null,
        buildCommand: null,
        lintCommand: null,
        hasSrc: false,
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
        keyFiles: [],
      };

      mockLoadConfig.mockResolvedValue(fakeConfig);
      mockScanProject.mockResolvedValue(fakeProfile);
      mockAnalyzeProject.mockRejectedValue(new Error('Network timeout'));
      mockReadCache.mockResolvedValue(null);

      const { analyzeAction } = await import('../analyze.js');
      await expect(analyzeAction({})).rejects.toThrow('Network timeout');
    });

    it('displays cache age when cache exists and not refreshing', async () => {
      const fakeConfig = {
        provider: 'anthropic',
        api_key: 'test-key',
        model: 'claude-sonnet-4-6',
        default_runtime: 'claude-code',
        created_at: new Date().toISOString(),
      };

      const fakeProfile = {
        name: 'test',
        description: '',
        directory: '/tmp/test',
        language: 'TypeScript',
        framework: null,
        typescript: true,
        dependencies: [],
        devDependencies: [],
        scripts: {},
        hasTests: false,
        testCommand: null,
        buildCommand: null,
        lintCommand: null,
        hasSrc: false,
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
        keyFiles: [],
      };

      const fakeAnalysis = {
        purpose: 'Test',
        domain: 'test',
        key_modules: [],
        workflows: [],
        architecture_style: 'monolithic',
        deployment_model: 'local',
        dataflow: [],
        config_keys: [],
        sampled_files: [],
        content_hash: 'hash',
        analyzed_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
      };

      mockLoadConfig.mockResolvedValue(fakeConfig);
      mockScanProject.mockResolvedValue(fakeProfile);
      mockAnalyzeProject.mockResolvedValue({ analysis: fakeAnalysis, packedSource: '## packed source content' });
      mockReadCache.mockResolvedValue({
        analysis: fakeAnalysis,
        content_hash: 'hash',
        kairn_version: '2.13.0',
      });

      const { analyzeAction } = await import('../analyze.js');
      await analyzeAction({});

      const output = consoleLogs.join('\n');
      expect(output).toContain('Cache:');
      expect(output).toContain('found');
    });
  });
});
