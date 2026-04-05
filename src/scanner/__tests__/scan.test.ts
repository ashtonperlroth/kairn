import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { scanProject } from '../scan.js';
import type { ProjectProfile } from '../scan.js';

describe('multi-language detection', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairn-scan-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects multiple languages from root files', async () => {
    // Root has both tsconfig.json and pyproject.toml
    await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');
    await fs.writeFile(path.join(tmpDir, 'pyproject.toml'), '[project]\nname = "test"');

    const profile = await scanProject(tmpDir);

    expect(profile.languages).toEqual(['TypeScript', 'Python']);
  });

  it('detects single language from root package.json', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', scripts: {} }),
    );

    const profile = await scanProject(tmpDir);

    expect(profile.languages).toEqual(['JavaScript']);
    expect(profile.language).toBe('JavaScript');
  });

  it('detects TypeScript and JavaScript from root with tsconfig + package.json', async () => {
    // tsconfig.json implies TypeScript; package.json implies JavaScript
    // But TypeScript has higher precedence so it comes first
    await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', scripts: {} }),
    );

    const profile = await scanProject(tmpDir);

    // Both should appear, TypeScript first (higher precedence in LANGUAGE_SIGNALS)
    expect(profile.languages).toEqual(['TypeScript', 'JavaScript']);
    expect(profile.language).toBe('TypeScript');
  });

  it('falls back to subdirectory scan when root has no language signals', async () => {
    // Root has only a README — no language signals
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Monorepo');

    // Subdir api/ has Python
    const apiDir = path.join(tmpDir, 'api');
    await fs.mkdir(apiDir);
    await fs.writeFile(path.join(apiDir, 'requirements.txt'), 'flask');

    // Subdir dashboard/ has JavaScript
    const dashDir = path.join(tmpDir, 'dashboard');
    await fs.mkdir(dashDir);
    await fs.writeFile(
      path.join(dashDir, 'package.json'),
      JSON.stringify({ name: 'dashboard' }),
    );

    const profile = await scanProject(tmpDir);

    // Both should appear. Since each has 1 occurrence, order is by LANGUAGE_SIGNALS precedence
    expect(profile.languages).toContain('Python');
    expect(profile.languages).toContain('JavaScript');
    expect(profile.languages).toHaveLength(2);
  });

  it('sorts subdirectory languages by frequency (most common first)', async () => {
    // Root has no language signals
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Monorepo');

    // 2 Python subdirs
    const svc1 = path.join(tmpDir, 'service-a');
    await fs.mkdir(svc1);
    await fs.writeFile(path.join(svc1, 'requirements.txt'), 'flask');

    const svc2 = path.join(tmpDir, 'service-b');
    await fs.mkdir(svc2);
    await fs.writeFile(path.join(svc2, 'pyproject.toml'), '[project]\nname = "b"');

    // 1 JavaScript subdir
    const web = path.join(tmpDir, 'web');
    await fs.mkdir(web);
    await fs.writeFile(
      path.join(web, 'package.json'),
      JSON.stringify({ name: 'web' }),
    );

    const profile = await scanProject(tmpDir);

    // Python should be first (2 occurrences vs 1)
    expect(profile.languages[0]).toBe('Python');
    expect(profile.languages[1]).toBe('JavaScript');
    expect(profile.languages).toHaveLength(2);
  });

  it('returns empty languages array and null language for empty project', async () => {
    // Empty directory — no files at all
    const profile = await scanProject(tmpDir);

    expect(profile.languages).toEqual([]);
    expect(profile.language).toBeNull();
  });

  it('maintains backward compatibility: language equals languages[0] ?? null', async () => {
    // Single language
    await fs.writeFile(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "test"');

    const profile = await scanProject(tmpDir);

    expect(profile.languages).toEqual(['Rust']);
    expect(profile.language).toBe(profile.languages[0]);
  });

  it('maintains backward compatibility: language is null when languages is empty', async () => {
    const profile = await scanProject(tmpDir);

    expect(profile.languages).toEqual([]);
    expect(profile.language).toBe(null);
    // Verify the relationship holds
    expect(profile.language).toBe(profile.languages[0] ?? null);
  });

  it('detects Go from root go.mod', async () => {
    await fs.writeFile(path.join(tmpDir, 'go.mod'), 'module example.com/test');

    const profile = await scanProject(tmpDir);

    expect(profile.languages).toEqual(['Go']);
    expect(profile.language).toBe('Go');
  });

  it('detects Ruby from root Gemfile', async () => {
    await fs.writeFile(path.join(tmpDir, 'Gemfile'), 'source "https://rubygems.org"');

    const profile = await scanProject(tmpDir);

    expect(profile.languages).toEqual(['Ruby']);
    expect(profile.language).toBe('Ruby');
  });

  it('detects all three languages from root with tsconfig + pyproject.toml + go.mod', async () => {
    await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');
    await fs.writeFile(path.join(tmpDir, 'pyproject.toml'), '[project]\nname = "test"');
    await fs.writeFile(path.join(tmpDir, 'go.mod'), 'module example.com/test');

    const profile = await scanProject(tmpDir);

    // Should be ordered by LANGUAGE_SIGNALS precedence: TypeScript, Python, Go
    expect(profile.languages).toEqual(['TypeScript', 'Python', 'Go']);
    expect(profile.language).toBe('TypeScript');
  });

  it('deduplicates languages from subdirectory scan', async () => {
    // Root has no signals
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Monorepo');

    // Two subdirs both with Python
    const svc1 = path.join(tmpDir, 'service-a');
    await fs.mkdir(svc1);
    await fs.writeFile(path.join(svc1, 'requirements.txt'), 'flask');

    const svc2 = path.join(tmpDir, 'service-b');
    await fs.mkdir(svc2);
    await fs.writeFile(path.join(svc2, 'setup.py'), 'from setuptools import setup');

    const profile = await scanProject(tmpDir);

    // Python should appear only once, even though two subdirs have it
    expect(profile.languages).toEqual(['Python']);
  });
});
