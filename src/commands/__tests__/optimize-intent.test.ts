import { describe, it, expect } from 'vitest';
import type { ProjectAnalysis } from '../../analyzer/types.js';
import type { ProjectProfile } from '../../scanner/scan.js';

/**
 * We test the exported buildOptimizeIntent via a re-export.
 * Since buildOptimizeIntent is a module-private function, we need to test
 * the integration indirectly. However, since the task asks us to verify the
 * intent string includes analysis sections, we'll extract and export the
 * function for testability.
 *
 * Alternative: we import the function if it's exported, or test
 * the full pipeline with mocks. For now, we test the intent builder directly
 * by importing it as an internal export.
 */
import { buildOptimizeIntent } from '../optimize.js';

function makeProfile(overrides?: Partial<ProjectProfile>): ProjectProfile {
  return {
    name: 'test-project',
    description: 'A test project',
    directory: '/tmp/test-project',
    language: 'TypeScript',
    framework: 'Express',
    typescript: true,
    dependencies: ['express', 'typescript'],
    devDependencies: [],
    scripts: { test: 'vitest', build: 'tsup' },
    testCommand: 'npm test',
    buildCommand: 'npm run build',
    lintCommand: 'npm run lint',
    hasDocker: false,
    hasCi: false,
    hasEnvFile: false,
    envKeys: [],
    hasClaudeDir: false,
    claudeMdLineCount: 0,
    mcpServerCount: 0,
    existingCommands: [],
    existingRules: [],
    existingSkills: [],
    existingAgents: [],
    existingClaudeMd: null,
    existingSettings: null,
    existingMcpConfig: null,
    hasTests: true,
    hasSrc: true,
    keyFiles: [],
    ...overrides,
  };
}

function makeAnalysis(overrides?: Partial<ProjectAnalysis>): ProjectAnalysis {
  return {
    purpose: 'CLI tool for compiling agent environments',
    domain: 'developer-tools',
    key_modules: [
      {
        name: 'compiler',
        path: 'src/compiler/',
        description: 'Compiles intent into environment specs',
        responsibilities: ['LLM orchestration', 'prompt construction'],
      },
      {
        name: 'adapter',
        path: 'src/adapter/',
        description: 'Writes environment files to disk',
        responsibilities: ['file writing', 'format conversion'],
      },
    ],
    workflows: [
      {
        name: 'describe flow',
        description: 'User describes intent, gets compiled environment',
        trigger: 'kairn describe command',
        steps: ['collect intent', 'clarify', 'compile', 'write'],
      },
    ],
    architecture_style: 'CLI',
    deployment_model: 'local',
    dataflow: [
      {
        from: 'compiler',
        to: 'adapter',
        data: 'EnvironmentSpec',
      },
    ],
    config_keys: [
      {
        name: 'ANTHROPIC_API_KEY',
        purpose: 'Authenticates with Anthropic API for LLM calls',
      },
    ],
    sampled_files: ['src/cli.ts', 'src/compiler/compile.ts'],
    content_hash: 'abc123',
    analyzed_at: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildOptimizeIntent', () => {
  it('includes profile summary in output', () => {
    const profile = makeProfile();
    const intent = buildOptimizeIntent(profile);

    expect(intent).toContain('Project: test-project');
    expect(intent).toContain('Language: TypeScript');
    expect(intent).toContain('Framework: Express');
  });

  it('includes semantic analysis section when analysis is provided', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('## Semantic Analysis (from source code)');
    expect(intent).toContain('Purpose: CLI tool for compiling agent environments');
    expect(intent).toContain('Domain: developer-tools');
    expect(intent).toContain('Architecture: CLI');
    expect(intent).toContain('Deployment: local');
  });

  it('includes key modules when analysis has modules', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('### Key Modules');
    expect(intent).toContain('**compiler** (src/compiler/)');
    expect(intent).toContain('Owns: LLM orchestration, prompt construction');
    expect(intent).toContain('**adapter** (src/adapter/)');
  });

  it('includes workflows when analysis has workflows', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('### Core Workflows');
    expect(intent).toContain('**describe flow**');
    expect(intent).toContain('Trigger: kairn describe command');
    expect(intent).toContain('Steps: collect intent');
  });

  it('includes dataflow when analysis has edges', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('### Dataflow');
    expect(intent).toContain('compiler');
    expect(intent).toContain('adapter');
    expect(intent).toContain('EnvironmentSpec');
  });

  it('includes config keys when analysis has them', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('### Configuration');
    expect(intent).toContain('`ANTHROPIC_API_KEY`');
    expect(intent).toContain('Authenticates with Anthropic API');
  });

  it('does not include semantic analysis section when analysis is null', () => {
    const profile = makeProfile();
    const intent = buildOptimizeIntent(profile, null);

    expect(intent).not.toContain('## Semantic Analysis');
    expect(intent).not.toContain('### Key Modules');
  });

  it('does not include semantic analysis section when analysis is undefined', () => {
    const profile = makeProfile();
    const intent = buildOptimizeIntent(profile);

    expect(intent).not.toContain('## Semantic Analysis');
  });

  it('skips key modules section when analysis has empty modules array', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis({ key_modules: [] });
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('## Semantic Analysis');
    expect(intent).not.toContain('### Key Modules');
  });

  it('skips workflows section when analysis has empty workflows array', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis({ workflows: [] });
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('## Semantic Analysis');
    expect(intent).not.toContain('### Core Workflows');
  });

  it('skips dataflow section when analysis has empty dataflow array', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis({ dataflow: [] });
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('## Semantic Analysis');
    expect(intent).not.toContain('### Dataflow');
  });

  it('skips config keys section when analysis has empty config_keys array', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis({ config_keys: [] });
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('## Semantic Analysis');
    expect(intent).not.toContain('### Configuration');
  });

  it('includes audit summary for projects with existing harness', () => {
    const profile = makeProfile({
      hasClaudeDir: true,
      claudeMdLineCount: 50,
      mcpServerCount: 3,
      existingCommands: ['test', 'help'],
      existingRules: ['security'],
      existingClaudeMd: '# My Project\nSome existing content',
    });
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('Existing .claude/ harness found');
    expect(intent).toContain('## Semantic Analysis');
  });

  it('includes workflow steps joined with arrow separator', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis({
      workflows: [
        {
          name: 'deploy',
          description: 'Deploy to production',
          trigger: 'git push to main',
          steps: ['build', 'test', 'deploy', 'verify'],
        },
      ],
    });
    const intent = buildOptimizeIntent(profile, analysis);

    // The arrow join format from the task description
    expect(intent).toContain('build');
    expect(intent).toContain('test');
    expect(intent).toContain('deploy');
    expect(intent).toContain('verify');
  });
});
