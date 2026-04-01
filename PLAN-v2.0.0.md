# PLAN-v2.0.0 — Task Definition & Trace Infrastructure

## Overview

Complete the v2.0.0 milestone: upgrade stub implementations in `src/evolve/` to production-ready code with LLM-powered task generation, real Claude Code task runner, proper scorers, and full trace capture.

## Existing State → Required State

| # | Gap | Current | Required |
|---|-----|---------|----------|
| 1 | `callLLM` private to compiler | Can't import in evolve | Shared utility in `src/llm.ts` |
| 2 | No YAML parser | Regex parsing in CLI | `yaml` package for tasks.yaml |
| 3 | Types incomplete | Missing TasksFile, HarnessSnapshot | Full type coverage |
| 4 | No LLM instantiation | Templates return metadata only | LLM generates project-specific tasks |
| 5 | No auto-generation in init | Placeholder descriptions | LLM reads CLAUDE.md + project scan |
| 6 | Baseline missing iter 0 | Only copies to baseline/ | Also copies to iterations/0/harness/ |
| 7 | Runner is stub | Writes placeholder trace | Spawns Claude Code, captures traces |
| 8 | Scorers are stubs | stderr "error" check only | Real verification, LLM judge, rubric |
| 9 | Trace write incomplete | Missing tool_calls, timing | All schema files written |
| 10 | CLI regex YAML parsing | Partial Task reconstruction | Full YAML parse + interactive flow |

## Implementation Steps

### Step 1 — Extract shared LLM utility `[parallel-safe]`

**What:** Extract `callLLM` and `classifyError` from `src/compiler/compile.ts` into `src/llm.ts`.

**Files:** Create `src/llm.ts`, modify `src/compiler/compile.ts`

**Dependencies:** None

**Verification:** `npm run build && npx tsc --noEmit`

**Commit:** `refactor: extract callLLM into shared src/llm.ts`

### Step 2 — Add yaml dependency `[parallel-safe]`

**What:** Add `yaml` package for proper YAML parsing/serialization.

**Files:** `package.json`

**Dependencies:** None

**Verification:** `npm install && npm run build`

**Commit:** `feat(evolve): add yaml dependency for tasks.yaml parsing`

### Step 3 — Complete evolve type definitions `[parallel-safe]`

**What:** Add `TasksFile`, `RubricCriterion`, `HarnessSnapshot`, `TaskResult`, `SpawnResult` to types.ts. Fix `Iteration.results` from Map to Record.

**Files:** `src/evolve/types.ts`

**Dependencies:** None

**Verification:** `npx tsc --noEmit`

**Commit:** `feat(evolve): complete type definitions for v2.0.0`

### Step 4 — LLM task instantiation in templates

**What:** Add `TASK_GENERATION_PROMPT` and `generateTasksFromTemplates()` to templates.ts.

**Files:** `src/evolve/templates.ts`

**Dependencies:** Steps 1, 2, 3

**Verification:** `npx tsc --noEmit`

**Commit:** `feat(evolve): add LLM task instantiation from eval templates`

### Step 5 — Rewrite init.ts with auto-generation

**What:** Use yaml package, project scanner, LLM generation. Add `autoGenerateTasks()`.

**Files:** `src/evolve/init.ts`

**Dependencies:** Steps 2, 3, 4

**Verification:** `npx tsc --noEmit`

**Commit:** `feat(evolve): rewrite init with LLM auto-generation and YAML serialization`

### Step 6 — Fix baseline + loadHarnessSnapshot

**What:** Copy to both baseline/ and iterations/0/harness/. Add `loadHarnessSnapshot()`.

**Files:** `src/evolve/baseline.ts`

**Dependencies:** Step 3

**Verification:** `npx tsc --noEmit`

**Commit:** `feat(evolve): baseline copies to iterations/0/harness + loadHarnessSnapshot`

### Step 7 — Real task runner with Claude Code subprocess

**What:** Replace stub with real `child_process.spawn` of `claude` CLI. Create isolated workspace, capture traces, score, cleanup.

**Files:** `src/evolve/runner.ts`

**Dependencies:** Steps 3, 6

**Verification:** `npx tsc --noEmit`

**Commit:** `feat(evolve): implement task runner with Claude Code subprocess`

### Step 8 — Real scorers (pass/fail, LLM judge, rubric)

**What:** passFailScorer executes verification commands. llmJudgeScorer calls LLM. rubricScorer does weighted multi-criteria.

**Files:** `src/evolve/scorers.ts`

**Dependencies:** Steps 1, 3

**Verification:** `npx tsc --noEmit`

**Commit:** `feat(evolve): implement pass/fail, LLM-judge, and rubric scorers`

### Step 9 — Complete trace read/write

**What:** Write all trace files (tool_calls.jsonl, files_changed.json, timing.json). Parse tool_calls on read.

**Files:** `src/evolve/trace.ts`

**Dependencies:** Step 3

**Verification:** `npx tsc --noEmit`

**Commit:** `feat(evolve): complete trace read/write for all schema files`

### Step 10 — Rewrite CLI with YAML parsing, interactive flow, spinners

**What:** Replace regex parsing with `yaml.parse()`. Add interactive "add another eval?" flow. Wire real runner/scorer. Add ora spinners.

**Files:** `src/commands/evolve.ts`

**Dependencies:** Steps 2, 5, 7, 8, 9

**Verification:** `npm run build && npx tsc --noEmit`

**Commit:** `feat(evolve): rewrite CLI with YAML parsing, interactive flow, real runner`

### Step 11 — Unit tests for evolve module

**What:** Tests for templates, init, baseline, trace, scorers.

**Files:** Create test files in `test/`

**Dependencies:** All prior steps

**Verification:** `npm test`

**Commit:** `test(evolve): add unit tests for evolve module`

## Execution Phases

| Phase | Steps | Parallel? |
|-------|-------|-----------|
| A | 1, 2, 3 | Yes |
| B | 4, 6, 9 | Yes |
| C | 5, 7, 8 | Yes |
| D | 10 | No |
| E | 11 | No |

Critical path: 1/2/3 → 4 → 5 → 10 → 11
