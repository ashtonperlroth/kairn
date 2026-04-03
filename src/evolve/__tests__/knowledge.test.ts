import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock getKairnDir to return a temp directory
let tempDir: string;

vi.mock('../../config.js', () => ({
  getKairnDir: () => tempDir,
}));

// Import after mock is set up
import {
  loadKnowledgeBase,
  savePattern,
  extractAndSavePatterns,
  formatKnowledgeForProposer,
  formatKnowledgeForArchitect,
  saveProjectHistory,
  loadConvergence,
  saveConvergence,
} from '../knowledge.js';
import type { KnowledgePattern, IterationLog, Mutation, Proposal } from '../types.js';

function makePattern(overrides: Partial<KnowledgePattern> = {}): KnowledgePattern {
  return {
    id: `pattern_${Math.random().toString(36).slice(2, 10)}`,
    type: 'universal',
    description: 'Add explicit return types to exported functions',
    mutation: {
      file: 'CLAUDE.md',
      action: 'add_section',
      newText: '## Return Types\nAll exported functions must have explicit return types.',
      rationale: 'Improves type safety and IDE experience',
    },
    evidence: {
      repos_tested: 3,
      repos_helped: 2,
      mean_score_delta: 5.2,
      languages: ['typescript'],
    },
    discovered_at: '2026-04-01T00:00:00.000Z',
    last_validated: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeMutation(overrides: Partial<Mutation> = {}): Mutation {
  return {
    file: 'CLAUDE.md',
    action: 'add_section',
    newText: 'some new text',
    rationale: 'test rationale',
    ...overrides,
  };
}

function makeProposal(mutations: Mutation[]): Proposal {
  return {
    reasoning: 'test reasoning',
    mutations,
    expectedImpact: {},
  };
}

function makeIterationLog(overrides: Partial<IterationLog> = {}): IterationLog {
  return {
    iteration: 0,
    score: 50,
    taskResults: {},
    proposal: null,
    diffPatch: null,
    timestamp: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('knowledge base', () => {
  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `kairn-knowledge-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('loadKnowledgeBase', () => {
    it('returns empty array when patterns.jsonl does not exist', async () => {
      const patterns = await loadKnowledgeBase();
      expect(patterns).toEqual([]);
    });

    it('reads back saved patterns correctly', async () => {
      const p1 = makePattern({ id: 'pattern_aaaa1111', description: 'Pattern A' });
      const p2 = makePattern({ id: 'pattern_bbbb2222', description: 'Pattern B' });
      await savePattern(p1);
      await savePattern(p2);

      const patterns = await loadKnowledgeBase();
      expect(patterns).toHaveLength(2);
      expect(patterns[0].id).toBe('pattern_aaaa1111');
      expect(patterns[1].id).toBe('pattern_bbbb2222');
    });

    it('filters by type', async () => {
      const universal = makePattern({ id: 'pattern_u1', type: 'universal' });
      const project = makePattern({ id: 'pattern_p1', type: 'project' });
      await savePattern(universal);
      await savePattern(project);

      const filtered = await loadKnowledgeBase({ type: 'universal' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('pattern_u1');
    });

    it('filters by language', async () => {
      const ts = makePattern({
        id: 'pattern_ts1',
        evidence: { repos_tested: 1, repos_helped: 1, mean_score_delta: 3, languages: ['typescript'] },
      });
      const py = makePattern({
        id: 'pattern_py1',
        evidence: { repos_tested: 1, repos_helped: 1, mean_score_delta: 3, languages: ['python'] },
      });
      await savePattern(ts);
      await savePattern(py);

      const filtered = await loadKnowledgeBase({ language: 'python' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('pattern_py1');
    });

    it('skips malformed lines', async () => {
      const knowledgeDir = path.join(tempDir, 'knowledge');
      await fs.mkdir(knowledgeDir, { recursive: true });
      const patternsPath = path.join(knowledgeDir, 'patterns.jsonl');
      const validPattern = makePattern({ id: 'pattern_valid' });
      const content = `${JSON.stringify(validPattern)}\nthis is not json\n${JSON.stringify(makePattern({ id: 'pattern_valid2' }))}\n`;
      await fs.writeFile(patternsPath, content, 'utf-8');

      const patterns = await loadKnowledgeBase();
      expect(patterns).toHaveLength(2);
      expect(patterns[0].id).toBe('pattern_valid');
      expect(patterns[1].id).toBe('pattern_valid2');
    });
  });

  describe('savePattern', () => {
    it('creates knowledge directory and file on first write', async () => {
      const pattern = makePattern();
      await savePattern(pattern);

      const knowledgeDir = path.join(tempDir, 'knowledge');
      const stat = await fs.stat(knowledgeDir);
      expect(stat.isDirectory()).toBe(true);

      const patternsPath = path.join(knowledgeDir, 'patterns.jsonl');
      const content = await fs.readFile(patternsPath, 'utf-8');
      expect(content).toBeTruthy();
    });

    it('appends on subsequent writes (not overwrite)', async () => {
      const p1 = makePattern({ id: 'pattern_first' });
      const p2 = makePattern({ id: 'pattern_second' });

      await savePattern(p1);
      await savePattern(p2);

      const patternsPath = path.join(tempDir, 'knowledge', 'patterns.jsonl');
      const content = await fs.readFile(patternsPath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);

      const parsed0 = JSON.parse(lines[0]) as KnowledgePattern;
      const parsed1 = JSON.parse(lines[1]) as KnowledgePattern;
      expect(parsed0.id).toBe('pattern_first');
      expect(parsed1.id).toBe('pattern_second');
    });
  });

  describe('extractAndSavePatterns', () => {
    it('extracts patterns from improving iterations', async () => {
      const mutation = makeMutation({ rationale: 'Added error handling' });
      const history: IterationLog[] = [
        makeIterationLog({ iteration: 0, score: 50, proposal: null }),
        makeIterationLog({
          iteration: 1,
          score: 70,
          proposal: makeProposal([mutation]),
        }),
      ];

      const patterns = await extractAndSavePatterns(history, 'test-project', 'typescript');
      expect(patterns).toHaveLength(1);
      expect(patterns[0].rejected).toBe(false);
      expect(patterns[0].evidence.repos_helped).toBe(1);
      expect(patterns[0].evidence.mean_score_delta).toBe(20);
      expect(patterns[0].evidence.languages).toEqual(['typescript']);
      expect(patterns[0].type).toBe('project');
    });

    it('marks regressive mutations as rejected', async () => {
      const mutation = makeMutation({ rationale: 'Removed useful section' });
      const history: IterationLog[] = [
        makeIterationLog({ iteration: 0, score: 70 }),
        makeIterationLog({
          iteration: 1,
          score: 50,
          proposal: makeProposal([mutation]),
        }),
      ];

      const patterns = await extractAndSavePatterns(history, 'test-project', 'typescript');
      expect(patterns).toHaveLength(1);
      expect(patterns[0].rejected).toBe(true);
      expect(patterns[0].evidence.repos_helped).toBe(0);
      expect(patterns[0].evidence.mean_score_delta).toBe(-20);
    });

    it('handles multiple mutations in a single iteration', async () => {
      const m1 = makeMutation({ rationale: 'Mutation 1', file: 'a.md' });
      const m2 = makeMutation({ rationale: 'Mutation 2', file: 'b.md' });
      const history: IterationLog[] = [
        makeIterationLog({ iteration: 0, score: 50 }),
        makeIterationLog({
          iteration: 1,
          score: 60,
          proposal: makeProposal([m1, m2]),
        }),
      ];

      const patterns = await extractAndSavePatterns(history, 'test-project', null);
      expect(patterns).toHaveLength(2);
      // Score delta of 10, split across 2 mutations: 5 each
      expect(patterns[0].evidence.mean_score_delta).toBe(5);
      expect(patterns[1].evidence.mean_score_delta).toBe(5);
      // null language means empty array
      expect(patterns[0].evidence.languages).toEqual([]);
    });

    it('skips iterations with no proposal or no mutations', async () => {
      const history: IterationLog[] = [
        makeIterationLog({ iteration: 0, score: 50, proposal: null }),
        makeIterationLog({ iteration: 1, score: 50, proposal: null }),
        makeIterationLog({
          iteration: 2,
          score: 50,
          proposal: makeProposal([]),
        }),
      ];

      const patterns = await extractAndSavePatterns(history, 'test-project', 'typescript');
      expect(patterns).toHaveLength(0);
    });

    it('saves extracted patterns to the knowledge base file', async () => {
      const mutation = makeMutation({ rationale: 'Persisted pattern' });
      const history: IterationLog[] = [
        makeIterationLog({ iteration: 0, score: 50 }),
        makeIterationLog({
          iteration: 1,
          score: 60,
          proposal: makeProposal([mutation]),
        }),
      ];

      await extractAndSavePatterns(history, 'test-project', 'typescript');

      // Verify patterns were persisted to disk
      const loaded = await loadKnowledgeBase();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].description).toBe('Persisted pattern');
    });

    it('generates pattern IDs with correct prefix', async () => {
      const mutation = makeMutation({ rationale: 'Check ID format' });
      const history: IterationLog[] = [
        makeIterationLog({ iteration: 0, score: 50 }),
        makeIterationLog({
          iteration: 1,
          score: 60,
          proposal: makeProposal([mutation]),
        }),
      ];

      const patterns = await extractAndSavePatterns(history, 'test-project', 'typescript');
      expect(patterns[0].id).toMatch(/^pattern_[a-f0-9]{8}$/);
    });
  });

  describe('formatKnowledgeForProposer', () => {
    it('returns empty string for empty patterns', () => {
      const result = formatKnowledgeForProposer([], 'typescript');
      expect(result).toBe('');
    });

    it('returns empty string when all patterns are rejected', () => {
      const rejected = makePattern({ rejected: true });
      const result = formatKnowledgeForProposer([rejected], 'typescript');
      expect(result).toBe('');
    });

    it('excludes rejected patterns', () => {
      const accepted = makePattern({ rejected: false, description: 'Good pattern' });
      const rejected = makePattern({ rejected: true, description: 'Bad pattern' });
      const result = formatKnowledgeForProposer([accepted, rejected], 'typescript');
      expect(result).toContain('Good pattern');
      expect(result).not.toContain('Bad pattern');
    });

    it('limits to maxPatterns entries', () => {
      const patterns = Array.from({ length: 10 }, (_, i) =>
        makePattern({
          id: `pattern_${String(i).padStart(8, '0')}`,
          description: `Pattern ${i}`,
          evidence: { repos_tested: 1, repos_helped: 1, mean_score_delta: 10 - i, languages: ['typescript'] },
        })
      );

      const result = formatKnowledgeForProposer(patterns, 'typescript', 3);
      // Count the bullet points
      const bullets = result.split('\n').filter((l) => l.startsWith('- '));
      expect(bullets).toHaveLength(3);
    });

    it('sorts by mean_score_delta descending', () => {
      const low = makePattern({
        description: 'Low impact',
        evidence: { repos_tested: 1, repos_helped: 1, mean_score_delta: 1, languages: ['typescript'] },
      });
      const high = makePattern({
        description: 'High impact',
        evidence: { repos_tested: 1, repos_helped: 1, mean_score_delta: 10, languages: ['typescript'] },
      });

      const result = formatKnowledgeForProposer([low, high], 'typescript');
      const highIdx = result.indexOf('High impact');
      const lowIdx = result.indexOf('Low impact');
      expect(highIdx).toBeLessThan(lowIdx);
    });

    it('includes header and instructions', () => {
      const pattern = makePattern();
      const result = formatKnowledgeForProposer([pattern], 'typescript');
      expect(result).toContain('## Known Patterns');
      expect(result).toContain('Consider applying if relevant');
    });

    it('filters to universal patterns and patterns matching language', () => {
      const universal = makePattern({
        type: 'universal',
        description: 'Universal pattern',
        evidence: { repos_tested: 1, repos_helped: 1, mean_score_delta: 5, languages: [] },
      });
      const tsPattern = makePattern({
        type: 'language',
        description: 'TS pattern',
        evidence: { repos_tested: 1, repos_helped: 1, mean_score_delta: 5, languages: ['typescript'] },
      });
      const pyPattern = makePattern({
        type: 'language',
        description: 'Python pattern',
        evidence: { repos_tested: 1, repos_helped: 1, mean_score_delta: 5, languages: ['python'] },
      });

      const result = formatKnowledgeForProposer([universal, tsPattern, pyPattern], 'typescript');
      expect(result).toContain('Universal pattern');
      expect(result).toContain('TS pattern');
      expect(result).not.toContain('Python pattern');
    });
  });

  describe('formatKnowledgeForArchitect', () => {
    it('returns empty string for empty patterns', () => {
      const result = formatKnowledgeForArchitect([], 'typescript');
      expect(result).toBe('');
    });

    it('includes rejected patterns with FAILED label', () => {
      const rejected = makePattern({ rejected: true, description: 'Bad approach' });
      const result = formatKnowledgeForArchitect([rejected], 'typescript');
      expect(result).toContain('FAILED: Bad approach');
      expect(result).toContain('Failed Experiments');
      expect(result).toContain('do NOT repeat');
    });

    it('includes accepted patterns under Successful Patterns', () => {
      const accepted = makePattern({ rejected: false, description: 'Good approach' });
      const result = formatKnowledgeForArchitect([accepted], 'typescript');
      expect(result).toContain('Good approach');
      expect(result).toContain('Successful Patterns');
    });

    it('includes both accepted and rejected patterns', () => {
      const accepted = makePattern({ rejected: false, description: 'Win' });
      const rejected = makePattern({ rejected: true, description: 'Loss' });
      const result = formatKnowledgeForArchitect([accepted, rejected], 'typescript');
      expect(result).toContain('Win');
      expect(result).toContain('FAILED: Loss');
    });

    it('includes Knowledge Base header', () => {
      const pattern = makePattern();
      const result = formatKnowledgeForArchitect([pattern], 'typescript');
      expect(result).toContain('## Knowledge Base');
    });
  });

  describe('saveProjectHistory', () => {
    it('creates projects/<name>.json', async () => {
      const summary = {
        bestScore: 85,
        iterations: 10,
        patternsDiscovered: ['pattern_abc12345'],
      };

      await saveProjectHistory('my-project', summary);

      const filePath = path.join(tempDir, 'knowledge', 'projects', 'my-project.json');
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as typeof summary;
      expect(parsed.bestScore).toBe(85);
      expect(parsed.iterations).toBe(10);
      expect(parsed.patternsDiscovered).toEqual(['pattern_abc12345']);
    });

    it('creates the projects directory if it does not exist', async () => {
      await saveProjectHistory('test', { bestScore: 0, iterations: 0, patternsDiscovered: [] });

      const projectsDir = path.join(tempDir, 'knowledge', 'projects');
      const stat = await fs.stat(projectsDir);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('loadConvergence / saveConvergence', () => {
    it('returns null when convergence.json does not exist', async () => {
      const result = await loadConvergence();
      expect(result).toBeNull();
    });

    it('round-trips convergence data', async () => {
      const pattern = makePattern({ id: 'pattern_conv1234' });
      const data: Record<string, KnowledgePattern> = { 'pattern_conv1234': pattern };

      await saveConvergence(data);
      const loaded = await loadConvergence();

      expect(loaded).not.toBeNull();
      expect(loaded!['pattern_conv1234'].id).toBe('pattern_conv1234');
    });
  });
});
