# PLAN v2.16.0 — Multi-Language Monorepo Sampling

## Problem Statement

`kairn optimize` fails on monorepos where the language signal lives in subdirectories rather than at the project root. A project like `inferix/` with `api/` (Python), `sdk/` (Python), and `dashboard/` (JavaScript) gets `language: null` → `AnalysisError: No sampling strategy for language: unknown`.

v2.15.0 added a subdirectory scan fallback that picks the **most common** language, but this is still wrong for multi-language monorepos: if Python wins, all JavaScript/TypeScript files in `dashboard/` are invisible to the analyzer. The compilation agents and evolve proposers never see half the codebase.

## Root Cause Analysis

```
CURRENT PIPELINE (single-language assumption):
  scanProject()          → language: string | null     ← ONE language
  getStrategy(language)  → SamplingStrategy            ← ONE strategy
  resolveStrategy(...)   → enriched SamplingStrategy   ← ONE enriched strategy
  include = strategy.*   → string[]                    ← ONE set of patterns
  packCodebase(include)  → RepomixResult               ← files from ONE language
  classifyFilePriority() → tier per file               ← based on ONE strategy
  LLM prompt: "Analyze this ${language} project"       ← ONE language named

EVERY LAYER assumes exactly one language. Monorepos break at the first layer
and the error cascades.
```

## Architecture

### Design: Merged Strategy

Rather than running the pipeline N times (once per language), we merge all detected strategies into a single `SamplingStrategy` and pass it through the existing pipeline unchanged. This is the minimal-disruption approach:

```
detectLanguages()                    → ["Python", "JavaScript"]
                                        │
getStrategy("python")  ─┐              │
getStrategy("javascript") ─┤            │
                           ▼            │
resolveStrategy(python)  ─┐            │
resolveStrategy(javascript) ─┤         │
                              ▼        │
mergeStrategies([resolved...]) ────────┤
  entryPoints:    union                │
  domainPatterns: union                │
  configPatterns: union                │
  excludePatterns: intersection*       │
  extensions:     union                │
                    │                  │
                    ▼                  │
           mergedStrategy              │
                    │                  │
  ┌─────────────────┼─────────────────┐
  │   EXISTING PIPELINE (unchanged)   │
  │                                   │
  │  include = [...entryPoints,       │
  │             ...domainPatterns,     │
  │             ...configPatterns,     │
  │             ...alwaysInclude]      │
  │                                   │
  │  packCodebase(include, exclude,   │
  │    prioritize: classifyFilePriority│
  │    (filePath, mergedStrategy))     │
  │                                   │
  │  LLM: "Analyze this Python /      │
  │         JavaScript project:"      │
  └───────────────────────────────────┘

* excludePatterns: intersection, not union.
  Python excludes **/*.test.ts but JavaScript needs those.
  JavaScript excludes **/__pycache__/** but Python needs... well, no.
  Actually: union is safe here because exclude patterns are language-specific
  (pycache, node_modules, target/) and won't accidentally exclude the other
  language's source files. We use union.
```

### Why Merged Strategy (not Parallel Pipelines)

1. **packCodebase()** has a single include/exclude/prioritize interface — no changes needed
2. **classifyFilePriority()** already works: a Python entry point matches the merged entryPoints, a JS domain file matches the merged domainPatterns
3. **Token budget** is naturally shared — priority tiering sorts all files globally, truncates lowest-tier files first regardless of language
4. **No schema changes** to RepomixResult, ProjectAnalysis, HarnessIR, or any downstream consumer
5. **Backward compatible** — single-language projects produce a 1-element merge, identical to today

### Data Model Changes

```typescript
// ProjectProfile (src/scanner/scan.ts)
// Before:
language: string | null;

// After:
languages: string[];       // all detected, primary first
language: string | null;    // computed: languages[0] ?? null (backward compat)
```

Keeping `language` as a derived field means all existing display code, evolve init, and external consumers continue to work. Only the analyzer pipeline switches to using `languages`.

## Implementation Steps

### Step 1: Multi-language detection in scanner

**Files:** `src/scanner/scan.ts`

1. Rename internal `detectLanguage()` → `detectLanguages()`, return `string[]`
2. Root-level check returns all matches (e.g., both `pyproject.toml` and `tsconfig.json` at root → `["Python", "TypeScript"]`)
3. Subdirectory fallback collects all detected languages, sorted by frequency (most common first)
4. Deduplicate: same language detected at root and in subdirs → appears once
5. Add `languages: string[]` field to `ProjectProfile`
6. Keep `language: string | null` as `languages[0] ?? null`
7. Update `scanProject()` to call `detectLanguages()` and set both fields

**Tests:** `src/scanner/__tests__/scan.test.ts`
- Root with `package.json` + `pyproject.toml` → `["TypeScript", "Python"]` (if tsconfig) or `["JavaScript", "Python"]`
- Root with nothing, subdirs with mixed → sorted by frequency
- Root with `tsconfig.json` only → `["TypeScript"]`
- Empty root, empty subdirs → `[]`
- Backward compat: `language` equals `languages[0]`

**Commit:** `feat(scanner): detect multiple languages in monorepos`

### Step 2: Strategy merging utility

**Files:** `src/analyzer/patterns.ts`

1. Create exported `mergeStrategies(strategies: SamplingStrategy[]): SamplingStrategy`:
   ```typescript
   {
     language: strategies.map(s => s.language).join('/'),  // "Python/TypeScript"
     extensions: dedupe(flatMap(s => s.extensions)),
     entryPoints: dedupe(flatMap(s => s.entryPoints)),
     domainPatterns: dedupe(flatMap(s => s.domainPatterns)),
     configPatterns: dedupe(flatMap(s => s.configPatterns)),
     excludePatterns: dedupe(flatMap(s => s.excludePatterns)),
     maxFilesPerCategory: Math.max(...strategies.map(s => s.maxFilesPerCategory)),
   }
   ```
2. Single-element input returns the strategy unchanged (no allocation overhead)
3. Empty input throws (should never happen — caller guards)

**Tests:** `src/analyzer/__tests__/patterns.test.ts`
- Merge Python + TypeScript → combined patterns, no duplicates
- Merge single strategy → identity
- Entry points from both languages present
- Exclude patterns unioned correctly

**Commit:** `feat(analyzer): strategy merging for multi-language projects`

### Step 3: Refactor analyzeProject() to use merged strategy

**Files:** `src/analyzer/analyze.ts`

1. Replace single `getStrategy(profile.language)` with:
   ```typescript
   const strategies = profile.languages
     .map(lang => getStrategy(lang))
     .filter((s): s is SamplingStrategy => s !== null);
   
   if (strategies.length === 0) {
     throw new AnalysisError(
       `No sampling strategy for languages: ${profile.languages.join(', ') || 'none detected'}`,
       'no_entry_point',
       'Supported: Python, TypeScript, Go, Rust',
     );
   }
   ```
2. Resolve each strategy independently (each gets its own manifest parsing):
   ```typescript
   const resolved = await Promise.all(
     strategies.map(s => resolveStrategy(dir, s, profile.framework, profile.scripts))
   );
   const strategy = mergeStrategies(resolved);
   ```
3. Update `buildUserMessage()`:
   - From: `Analyze this ${language} project:`
   - To: `Analyze this ${strategy.language} project:` (already "Python/TypeScript")
4. Update the error message to reference multiple languages

**Tests:** `src/analyzer/__tests__/analyze.test.ts`
- Profile with `languages: ['Python', 'TypeScript']` → both strategies merged
- Profile with `languages: ['Python']` → works same as before
- Profile with `languages: []` → throws AnalysisError
- Profile with `languages: ['Cobol']` → throws (no strategy)
- Profile with `languages: ['Python', 'Cobol']` → Python strategy only (Cobol filtered)

**Commit:** `feat(analyzer): multi-language strategy merging in analyzeProject`

### Step 4: Update all callers of profile.language

**Files:** `src/commands/optimize.ts`, `src/commands/analyze.ts`, `src/evolve/init.ts`

1. `optimize.ts`: Display `profile.languages.join(', ')` instead of `profile.language`
   - Fallback: `profile.language ?? 'unknown'` for single-language display still works
2. `analyze.ts`: Same display update
3. `evolve/init.ts`: Where `profile.language` is used for manual assignment, use `profile.languages[0]` or adapt to array
4. Search for any other `profile.language` references and update

**Tests:** Update existing tests that mock `ProjectProfile` to include `languages` field

**Commit:** `refactor: update callers from profile.language to profile.languages`

### Step 5: Monorepo-aware domain pattern scoping

**Files:** `src/analyzer/patterns.ts`, `src/scanner/scan.ts`

1. When languages are detected in subdirectories (not root), scope domain patterns to those subdirectories:
   - If Python is detected in `api/` and `sdk/`, add `api/` and `sdk/` as top-level domain patterns
   - This prevents the Python strategy's generic `src/` pattern from matching TypeScript's `src/`
2. Extend `detectLanguages()` return to include the subdirectory mapping:
   ```typescript
   { language: string; subdirs: string[] }[]
   ```
3. When building the merged strategy, prefix domain patterns with subdirectory paths for non-root languages:
   - Python in `sdk/`: `models/` → `sdk/models/`, `services/` → `sdk/services/`
   - JS at root: `src/components/` stays as-is
4. Entry points get the same scoping: `main.py` → `api/main.py`, `sdk/main.py`

**Tests:**
- Python in `api/` + `sdk/`, JS at root → Python domain patterns scoped to `api/`, `sdk/`
- Single language at root → no scoping (unchanged behavior)
- Mixed: some at root, some in subdirs → root patterns unscoped, subdir patterns scoped

**Commit:** `feat(analyzer): scope domain patterns to monorepo subdirectories`

### Step 6: Proportional token budget hints

**Files:** `src/analyzer/analyze.ts`, `src/analyzer/patterns.ts`

1. When multiple languages detected, compute a weight per language:
   - Count the number of subdirectories each language appears in
   - Weight = subdir_count / total_subdir_count
   - e.g., Python in 2 subdirs, JS in 1 → Python 67%, JS 33%
2. In `classifyFilePriority()`, use weights as a tiebreaker within the same tier:
   - Files from the primary language get a slight priority boost (e.g., tier - 0.1)
   - This ensures the majority language keeps more files when budget is tight
3. This is a soft hint, not a hard partition — the existing truncation logic handles the rest

**Tests:**
- 2 Python subdirs + 1 JS subdir → Python files ranked slightly higher within same tier
- Equal split → no tiebreaker effect

**Commit:** `feat(analyzer): proportional priority hints for multi-language budgets`

### Step 7: Build, test, release

1. `npm run build` — must succeed
2. `npx vitest run` — all tests pass
3. `npm run typecheck` — clean
4. Update CHANGELOG.md with v2.16.0 entry
5. Update ROADMAP.md checkboxes
6. Bump version to 2.16.0 in package.json
7. Verify on inferix: `cd ~/Projects/inferix && kairn optimize` → should detect Python + JavaScript

**Commit:** `chore: v2.16.0 finalization`

## Dependency Graph

```
Step 1 (multi-language detection) ──┐
Step 2 (strategy merging)         ──┤ parallel-safe
                                    │
Step 3 (analyzeProject refactor)  ──┤ depends on 1, 2
Step 4 (caller updates)           ──┤ depends on 1
                                    │
Step 5 (monorepo scoping)         ──┤ depends on 1, 2, 3
Step 6 (proportional budget)      ──┤ depends on 5
                                    │
Step 7 (finalize)                 ──┘ depends on all
```

Parallelizable groups:
- **Group A:** Steps 1, 2 (independent)
- **Group B:** Steps 3, 4 (after A)
- **Group C:** Step 5 (after B)
- **Group D:** Step 6 (after C)
- **Group E:** Step 7 (after all)

## Key Constraints

- **Backward compatible**: Single-language projects behave identically. `profile.language` still works.
- **No downstream schema changes**: ProjectAnalysis, HarnessIR, RepomixResult unchanged.
- **Shared token budget**: No per-language budget partitioning. Priority tiering handles allocation naturally.
- **TDD mandatory**: RED → GREEN → REFACTOR for every step.
- **Strict TypeScript**: no `any`, no `ts-ignore`, `.js` extensions on imports.

## Success Criteria

1. `kairn optimize` on inferix (Python + JS monorepo) → detects both languages, samples from both
2. `kairn analyze` shows `Languages: Python, JavaScript` (not just one)
3. Generated CLAUDE.md references modules from both the Python API and the JS dashboard
4. Single-language projects (e.g., kairn itself) → identical behavior, no regressions
5. Language detection on a Go + TypeScript monorepo → both detected
6. All existing tests pass + new tests pass
7. `npm run build` clean

## Budget & Impact

| Metric | Before | After |
|--------|--------|-------|
| Supported project types | Single-language only | Monorepos with mixed languages |
| Inferix analysis | ❌ FAIL (unknown language) | ✅ Python + JavaScript |
| Token budget | 60K for one language | 60K shared across languages |
| File priority | One strategy's heuristics | Merged heuristics from all strategies |
| Breaking changes | — | `ProjectProfile.languages` added, `language` kept for compat |
