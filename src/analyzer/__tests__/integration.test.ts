/**
 * Integration tests for the semantic analyzer pipeline.
 *
 * Verifies that the analyzer types, cache, and buildOptimizeIntent function
 * work together correctly — ensuring analysis data flows through the pipeline
 * into the enriched intent string used by compilation agents.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { buildOptimizeIntent } from '../../commands/optimize.js';
import { AnalysisError } from '../types.js';
import type { ProjectAnalysis } from '../types.js';
import type { ProjectProfile } from '../../scanner/scan.js';

const { writeCache, readCache, computeContentHash, isCacheValid } =
  await import('../cache.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides?: Partial<ProjectProfile>): ProjectProfile {
  return {
    name: 'test-project',
    description: 'A test project',
    directory: '/tmp/test',
    language: 'TypeScript',
    languages: ['TypeScript'],
    framework: null,
    typescript: true,
    dependencies: ['express', 'typescript'],
    devDependencies: ['vitest'],
    scripts: { build: 'tsc', test: 'vitest' },
    hasTests: true,
    testCommand: 'vitest',
    buildCommand: 'tsc',
    lintCommand: null,
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
    keyFiles: [],
    ...overrides,
  };
}

function makeAnalysis(overrides?: Partial<ProjectAnalysis>): ProjectAnalysis {
  return {
    purpose: 'REST API for user management',
    domain: 'web-backend',
    key_modules: [
      {
        name: 'auth',
        path: 'src/auth/',
        description: 'JWT authentication',
        responsibilities: ['login', 'token refresh'],
      },
      {
        name: 'users',
        path: 'src/users/',
        description: 'User CRUD operations',
        responsibilities: ['create', 'read', 'update', 'delete'],
      },
    ],
    workflows: [
      {
        name: 'user-signup',
        description: 'New user registration',
        trigger: 'POST /api/signup',
        steps: ['validate input', 'hash password', 'create user', 'send welcome email'],
      },
    ],
    architecture_style: 'monolithic',
    deployment_model: 'containerized',
    dataflow: [
      { from: 'auth', to: 'users', data: 'authenticated user ID' },
    ],
    config_keys: [
      { name: 'DATABASE_URL', purpose: 'PostgreSQL connection string' },
      { name: 'JWT_SECRET', purpose: 'JWT signing key' },
    ],
    sampled_files: ['src/index.ts', 'src/auth/jwt.ts'],
    content_hash: 'abc123',
    analyzed_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Enriched intent includes analysis fields
// ---------------------------------------------------------------------------

describe('enriched intent includes analysis fields', () => {
  it('contains the Semantic Analysis section header', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('## Semantic Analysis');
  });

  it('contains the purpose text from analysis', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('Purpose: REST API for user management');
  });

  it('contains the domain text from analysis', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('Domain: web-backend');
  });

  it('contains architecture and deployment values', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('Architecture: monolithic');
    expect(intent).toContain('Deployment: containerized');
  });

  it('contains module names and paths', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('**auth** (src/auth/)');
    expect(intent).toContain('**users** (src/users/)');
  });

  it('contains module responsibilities', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('Owns: login, token refresh');
    expect(intent).toContain('Owns: create, read, update, delete');
  });

  it('contains workflow names and triggers', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('**user-signup**');
    expect(intent).toContain('Trigger: POST /api/signup');
  });

  it('contains workflow steps', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('validate input');
    expect(intent).toContain('hash password');
    expect(intent).toContain('create user');
    expect(intent).toContain('send welcome email');
  });

  it('contains dataflow edges', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('auth');
    expect(intent).toContain('users');
    expect(intent).toContain('authenticated user ID');
  });

  it('contains config key names and purposes', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('`DATABASE_URL`');
    expect(intent).toContain('PostgreSQL connection string');
    expect(intent).toContain('`JWT_SECRET`');
    expect(intent).toContain('JWT signing key');
  });
});

// ---------------------------------------------------------------------------
// Test 2: buildOptimizeIntent without analysis
// ---------------------------------------------------------------------------

describe('buildOptimizeIntent without analysis', () => {
  it('does not contain Semantic Analysis section when no analysis provided', () => {
    const profile = makeProfile();
    const intent = buildOptimizeIntent(profile);

    expect(intent).not.toContain('## Semantic Analysis');
  });

  it('does not contain Semantic Analysis when analysis is null', () => {
    const profile = makeProfile();
    const intent = buildOptimizeIntent(profile, null);

    expect(intent).not.toContain('## Semantic Analysis');
  });

  it('still contains the profile summary', () => {
    const profile = makeProfile();
    const intent = buildOptimizeIntent(profile);

    expect(intent).toContain('Project: test-project');
    expect(intent).toContain('Languages: TypeScript');
  });
});

// ---------------------------------------------------------------------------
// Test 3: buildOptimizeIntent with empty analysis arrays
// ---------------------------------------------------------------------------

describe('buildOptimizeIntent with empty analysis arrays', () => {
  it('includes purpose and domain even with empty arrays', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis({
      key_modules: [],
      workflows: [],
      dataflow: [],
      config_keys: [],
    });
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).toContain('## Semantic Analysis');
    expect(intent).toContain('Purpose: REST API for user management');
    expect(intent).toContain('Domain: web-backend');
    expect(intent).toContain('Architecture: monolithic');
    expect(intent).toContain('Deployment: containerized');
  });

  it('does not include Key Modules section when modules are empty', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis({ key_modules: [] });
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).not.toContain('### Key Modules');
  });

  it('does not include Core Workflows section when workflows are empty', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis({ workflows: [] });
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).not.toContain('### Core Workflows');
  });

  it('does not include Dataflow section when dataflow is empty', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis({ dataflow: [] });
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).not.toContain('### Dataflow');
  });

  it('does not include Configuration section when config_keys are empty', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis({ config_keys: [] });
    const intent = buildOptimizeIntent(profile, analysis);

    expect(intent).not.toContain('### Configuration');
  });
});

// ---------------------------------------------------------------------------
// Test 4: Analyzer types are correctly exported
// ---------------------------------------------------------------------------

describe('analyzer types are correctly exported', () => {
  it('AnalysisError is constructable with no_entry_point type', () => {
    const err = new AnalysisError('No entry point found', 'no_entry_point');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AnalysisError);
    expect(err.message).toBe('No entry point found');
    expect(err.type).toBe('no_entry_point');
    expect(err.name).toBe('AnalysisError');
    expect(err.details).toBeUndefined();
  });

  it('AnalysisError is constructable with empty_sample type', () => {
    const err = new AnalysisError('No files sampled', 'empty_sample', 'dir was empty');
    expect(err.type).toBe('empty_sample');
    expect(err.details).toBe('dir was empty');
  });

  it('AnalysisError is constructable with llm_parse_failure type', () => {
    const err = new AnalysisError('Failed to parse LLM response', 'llm_parse_failure');
    expect(err.type).toBe('llm_parse_failure');
  });

  it('AnalysisError is constructable with repomix_failure type', () => {
    const err = new AnalysisError('Repomix crashed', 'repomix_failure', 'exit code 1');
    expect(err.type).toBe('repomix_failure');
    expect(err.details).toBe('exit code 1');
  });

  it('ProjectAnalysis type is importable and usable', () => {
    // This test verifies the type import compiles correctly.
    // At runtime we construct a value conforming to the type.
    const analysis: ProjectAnalysis = makeAnalysis();
    expect(analysis.purpose).toBe('REST API for user management');
    expect(analysis.key_modules).toHaveLength(2);
    expect(analysis.workflows).toHaveLength(1);
    expect(analysis.dataflow).toHaveLength(1);
    expect(analysis.config_keys).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Cache roundtrip integration
// ---------------------------------------------------------------------------

describe('cache roundtrip integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairn-integ-cache-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes and reads back a cache with all fields matching', async () => {
    const analysis = makeAnalysis({ content_hash: 'integ-hash-001' });

    await writeCache(tempDir, analysis);
    const cached = await readCache(tempDir);

    expect(cached).not.toBeNull();
    expect(cached!.analysis.purpose).toBe('REST API for user management');
    expect(cached!.analysis.domain).toBe('web-backend');
    expect(cached!.analysis.architecture_style).toBe('monolithic');
    expect(cached!.analysis.deployment_model).toBe('containerized');
    expect(cached!.analysis.key_modules).toHaveLength(2);
    expect(cached!.analysis.key_modules[0].name).toBe('auth');
    expect(cached!.analysis.key_modules[1].name).toBe('users');
    expect(cached!.analysis.workflows).toHaveLength(1);
    expect(cached!.analysis.workflows[0].name).toBe('user-signup');
    expect(cached!.analysis.dataflow).toHaveLength(1);
    expect(cached!.analysis.dataflow[0].from).toBe('auth');
    expect(cached!.analysis.dataflow[0].to).toBe('users');
    expect(cached!.analysis.config_keys).toHaveLength(2);
    expect(cached!.analysis.config_keys[0].name).toBe('DATABASE_URL');
    expect(cached!.analysis.config_keys[1].name).toBe('JWT_SECRET');
    expect(cached!.content_hash).toBe('integ-hash-001');
    expect(typeof cached!.kairn_version).toBe('string');
  });

  it('isCacheValid returns true when content hash matches', async () => {
    // Write real files to compute a hash from
    await fs.writeFile(path.join(tempDir, 'a.ts'), 'export const x = 1;');
    await fs.writeFile(path.join(tempDir, 'b.ts'), 'export const y = 2;');

    const hash = await computeContentHash(['a.ts', 'b.ts'], tempDir);
    const analysis = makeAnalysis({ content_hash: hash });

    await writeCache(tempDir, analysis);
    const cached = await readCache(tempDir);
    expect(cached).not.toBeNull();

    const valid = isCacheValid(cached!, hash);
    expect(valid).toBe(true);
  });

  it('isCacheValid returns false after a file is modified', async () => {
    // Write files and compute initial hash
    await fs.writeFile(path.join(tempDir, 'a.ts'), 'export const x = 1;');
    await fs.writeFile(path.join(tempDir, 'b.ts'), 'export const y = 2;');

    const originalHash = await computeContentHash(['a.ts', 'b.ts'], tempDir);
    const analysis = makeAnalysis({ content_hash: originalHash });

    await writeCache(tempDir, analysis);
    const cached = await readCache(tempDir);
    expect(cached).not.toBeNull();

    // Modify a file
    await fs.writeFile(path.join(tempDir, 'b.ts'), 'export const y = 999;');

    // Recompute hash
    const newHash = await computeContentHash(['a.ts', 'b.ts'], tempDir);
    expect(newHash).not.toBe(originalHash);

    const valid = isCacheValid(cached!, newHash);
    expect(valid).toBe(false);
  });

  it('computeContentHash produces a 64-char hex string', async () => {
    await fs.writeFile(path.join(tempDir, 'index.ts'), 'console.log("hello");');

    const hash = await computeContentHash(['index.ts'], tempDir);

    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeContentHash is deterministic for the same content', async () => {
    await fs.writeFile(path.join(tempDir, 'main.ts'), 'const z = 42;');

    const hash1 = await computeContentHash(['main.ts'], tempDir);
    const hash2 = await computeContentHash(['main.ts'], tempDir);

    expect(hash1).toBe(hash2);
  });
});
