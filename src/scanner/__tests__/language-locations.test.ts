import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { scanProject, detectLanguageLocations } from '../scan.js';
import type { LanguageDetection } from '../scan.js';

describe('detectLanguageLocations', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairn-lang-loc-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns root-level detections with empty subdirs when languages found at root', async () => {
    await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');
    await fs.writeFile(path.join(tmpDir, 'pyproject.toml'), '[project]\nname = "test"');

    const rootFiles = ['tsconfig.json', 'pyproject.toml'];
    const result = await detectLanguageLocations(tmpDir, rootFiles);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ language: 'TypeScript', subdirs: [] });
    expect(result).toContainEqual({ language: 'Python', subdirs: [] });
  });

  it('returns subdirectory detections when root has no language signals', async () => {
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Monorepo');

    // api/ has Python
    const apiDir = path.join(tmpDir, 'api');
    await fs.mkdir(apiDir);
    await fs.writeFile(path.join(apiDir, 'requirements.txt'), 'flask');

    // dashboard/ has JavaScript
    const dashDir = path.join(tmpDir, 'dashboard');
    await fs.mkdir(dashDir);
    await fs.writeFile(
      path.join(dashDir, 'package.json'),
      JSON.stringify({ name: 'dashboard' }),
    );

    const result = await detectLanguageLocations(tmpDir, ['README.md']);

    expect(result).toHaveLength(2);

    const pythonDetection = result.find(d => d.language === 'Python');
    const jsDetection = result.find(d => d.language === 'JavaScript');

    expect(pythonDetection).toBeDefined();
    expect(pythonDetection!.subdirs).toEqual(['api']);

    expect(jsDetection).toBeDefined();
    expect(jsDetection!.subdirs).toEqual(['dashboard']);
  });

  it('aggregates multiple subdirectories for the same language', async () => {
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Monorepo');

    // api/ and sdk/ both have Python
    const apiDir = path.join(tmpDir, 'api');
    await fs.mkdir(apiDir);
    await fs.writeFile(path.join(apiDir, 'requirements.txt'), 'flask');

    const sdkDir = path.join(tmpDir, 'sdk');
    await fs.mkdir(sdkDir);
    await fs.writeFile(path.join(sdkDir, 'pyproject.toml'), '[project]\nname = "sdk"');

    const result = await detectLanguageLocations(tmpDir, ['README.md']);

    expect(result).toHaveLength(1);
    const pythonDetection = result.find(d => d.language === 'Python');
    expect(pythonDetection).toBeDefined();
    expect(pythonDetection!.subdirs).toEqual(expect.arrayContaining(['api', 'sdk']));
    expect(pythonDetection!.subdirs).toHaveLength(2);
  });

  it('returns empty array when no languages found', async () => {
    const result = await detectLanguageLocations(tmpDir, []);

    expect(result).toEqual([]);
  });

  it('sorts subdirectory results by frequency then precedence', async () => {
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

    const result = await detectLanguageLocations(tmpDir, ['README.md']);

    // Python should come first (2 occurrences vs 1)
    expect(result[0].language).toBe('Python');
    expect(result[1].language).toBe('JavaScript');
  });
});

describe('scanProject with languageLocations', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairn-scan-loc-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('includes languageLocations on ProjectProfile for root-level detection', async () => {
    await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', scripts: {} }),
    );

    const profile = await scanProject(tmpDir);

    expect(profile.languageLocations).toBeDefined();
    expect(profile.languageLocations).toContainEqual({ language: 'TypeScript', subdirs: [] });
    expect(profile.languageLocations).toContainEqual({ language: 'JavaScript', subdirs: [] });
  });

  it('includes languageLocations on ProjectProfile for monorepo detection', async () => {
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Monorepo');

    const apiDir = path.join(tmpDir, 'api');
    await fs.mkdir(apiDir);
    await fs.writeFile(path.join(apiDir, 'requirements.txt'), 'flask');

    const dashDir = path.join(tmpDir, 'dashboard');
    await fs.mkdir(dashDir);
    await fs.writeFile(
      path.join(dashDir, 'package.json'),
      JSON.stringify({ name: 'dashboard' }),
    );

    const profile = await scanProject(tmpDir);

    expect(profile.languageLocations).toBeDefined();

    const pythonLoc = profile.languageLocations!.find(d => d.language === 'Python');
    expect(pythonLoc).toBeDefined();
    expect(pythonLoc!.subdirs).toEqual(['api']);

    const jsLoc = profile.languageLocations!.find(d => d.language === 'JavaScript');
    expect(jsLoc).toBeDefined();
    expect(jsLoc!.subdirs).toEqual(['dashboard']);
  });

  it('derives languages from languageLocations correctly', async () => {
    await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');
    await fs.writeFile(path.join(tmpDir, 'pyproject.toml'), '[project]\nname = "test"');

    const profile = await scanProject(tmpDir);

    // languages should match the language names from languageLocations
    const locationLanguages = profile.languageLocations!.map(d => d.language);
    expect(profile.languages).toEqual(locationLanguages);
  });

  it('returns empty languageLocations for empty project', async () => {
    const profile = await scanProject(tmpDir);

    expect(profile.languageLocations).toEqual([]);
    expect(profile.languages).toEqual([]);
    expect(profile.language).toBeNull();
  });
});
