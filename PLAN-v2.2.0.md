# PLAN-v2.2.0 — Diagnosis & Reporting

**Goal:** Build the diagnosis engine and reporting layer that lets users understand *why* their harness evolved the way it did and *what* changed between iterations.

**Design doc:** `docs/design/v2.0-kairn-evolve.md` (Section: v2.2.0 — Diagnosis & Reporting, lines ~518-565)

**Depends on:** v2.1.0 (The Evolution Loop) — specifically: `EvolveResult`, `IterationLog`, `Trace`, `Proposal`, `Mutation` types, `writeIterationLog()`, `evolve()` function.

**Estimated complexity:** Medium (10 steps, 2 parallel groups)

---

## Implementation Steps

### Step 1: Report Types [parallel-safe]

**What to build:** Define types for the report, leaderboard, and diff output.

**Files to modify:**
- `src/evolve/types.ts`

**Key implementation details:**
- `EvolutionReport`: summary stats (iterations, bestIteration, bestScore, baselineScore, improvement, wallTime), scoreProgression (table data), keyChanges (per-iteration changelog)
- `ScoreProgressionRow`: iteration number, per-task pass/fail or score, aggregate
- `KeyChange`: iteration, fromScore, toScore, mutations applied, impact per task (helped/hurt/neutral)
- `DiffOutput`: iter1, iter2, harness file diffs, score delta per task
- `LeaderboardEntry`: iteration, aggregate score, rank, mutation count

**Verification command:**
```bash
npm run build
grep -q "EvolutionReport" src/evolve/types.ts
```

**Commit message:** `feat(evolve): report and diagnosis types`

---

### Step 2: Score Progression Table [parallel-safe]

**What to build:** Generate the iterations × tasks × scores leaderboard table from an `EvolveResult`.

**Files to create:**
- `src/evolve/report.ts`

**Key implementation details:**
- `function buildScoreProgression(result: EvolveResult, tasks: Task[]): ScoreProgressionRow[]`
  - For each iteration in result.iterations:
    - For each task: extract pass/score from taskResults
    - Compute aggregate
  - Return array of rows for table rendering
- `function buildLeaderboard(result: EvolveResult): LeaderboardEntry[]`
  - Sort iterations by score descending
  - Assign ranks (1-indexed)
- Pure functions, no I/O — unit testable
- Handle edge cases: 0 iterations (just baseline), rolled-back iterations (mark with ⚠)

**Verification command:**
```bash
npm test -- src/evolve/__tests__/report.test.ts
npm run build
```

**Commit message:** `feat(evolve): score progression table and leaderboard`

---

### Step 3: Key Changes Extraction [parallel-safe]

**What to build:** For each iteration, extract what mutations were applied and their impact on individual tasks.

**Files to modify:**
- `src/evolve/report.ts` (add function)

**Key implementation details:**
- `function extractKeyChanges(result: EvolveResult, tasks: Task[]): KeyChange[]`
  - For each iteration with a proposal (non-null):
    - List mutations applied (file, action, rationale)
    - Compare taskResults[iter] vs taskResults[iter-1] per task
    - Classify impact: helped (score went up), hurt (score went down), neutral
  - For rolled-back iterations: note the regression and rollback
- Returns array of KeyChange objects for rendering

**Verification command:**
```bash
npm test -- src/evolve/__tests__/report.test.ts
npm run build
```

**Commit message:** `feat(evolve): key changes extraction per iteration`

---

### Step 4: Counterfactual Diagnosis [parallel-safe]

**What to build:** Analyze when a mutation helped one task but hurt another, and generate causal hypotheses.

**Files to create:**
- `src/evolve/diagnosis.ts`

**Key implementation details:**
- `function diagnoseCounterfactuals(result: EvolveResult, tasks: Task[]): CounterfactualDiagnosis[]`
  - For each iteration with mutations:
    - Find tasks whose scores diverged (one improved, another regressed)
    - For each divergent pair: generate a diagnosis string explaining the conflict
    - Example: "Iteration 2: Adding 'always use middleware/' to CLAUDE.md helped auth (+33%) but hurt refactor (-33%) — the instruction is too specific for general refactoring tasks"
  - Uses pure logic — no LLM call (that's v2.3 territory)
  - Simple heuristic: if mutation touches CLAUDE.md and task A improves while task B regresses, flag it
- `CounterfactualDiagnosis`: { iteration, mutation, helpedTasks, hurtTasks, hypothesis }

**Verification command:**
```bash
npm test -- src/evolve/__tests__/diagnosis.test.ts
npm run build
```

**Commit message:** `feat(evolve): counterfactual diagnosis engine`

---

### Step 5: Trace Diffing Between Iterations [parallel-safe]

**What to build:** Compare traces for the same task across two iterations to show what changed in agent behavior.

**Files to create:**
- `src/evolve/diff.ts`

**Key implementation details:**
- `async function diffTraces(workspacePath: string, taskId: string, iter1: number, iter2: number): Promise<TraceDiff>`
  - Load trace for taskId at iteration iter1 and iter2
  - Compare: stdout diff (first 500 lines), tool_calls sequence diff, files_changed diff, score delta
  - Use simple line-by-line diff for stdout (no external dep — implement basic LCS or just show additions/removals)
  - `TraceDiff`: { taskId, iter1, iter2, stdoutDelta, toolCallsDelta, filesChangedDelta, scoreDelta }
- `async function diffHarness(workspacePath: string, iter1: number, iter2: number): Promise<string>`
  - Load harness at iter1 and iter2
  - Compare all files, produce unified diff string
  - Used by `kairn evolve diff <iter1> <iter2>` CLI command

**Verification command:**
```bash
npm test -- src/evolve/__tests__/diff.test.ts
npm run build
```

**Commit message:** `feat(evolve): trace and harness diffing between iterations`

---

### Step 6: Markdown Report Generator [parallel-safe]

**What to build:** Render the full evolution report as Markdown (like the example in the design doc).

**Files to modify:**
- `src/evolve/report.ts` (add render functions)

**Key implementation details:**
- `function renderMarkdownReport(report: EvolutionReport): string`
  - ## Summary section: iterations, best, baseline, improvement
  - ## Score Progression table: | Iter | task1 | task2 | ... | Aggregate |
    - Use ✔/✘ for pass-fail, numeric for scored
    - Highlight regressions with ⚠
  - ## Key Changes: per-iteration changelog with mutation details
  - ## Counterfactual Diagnosis (if any divergent impacts found)
  - ## Cost Summary (if cost data available from v2.1's iteration metadata)
- `function renderJsonReport(report: EvolutionReport): string`
  - JSON.stringify with 2-space indent
  - Machine-readable format for CI pipelines

**Verification command:**
```bash
npm test -- src/evolve/__tests__/report.test.ts
npm run build
```

**Commit message:** `feat(evolve): markdown and JSON report rendering`

---

### Step 7: CLI: `kairn evolve report` [depends-on: 1-6]

**What to build:** Wire the report command into the CLI.

**Files to modify:**
- `src/commands/evolve.ts`

**Key implementation details:**
- `kairn evolve report` — reads `.kairn-evolve/iterations/*/metadata.json`, builds report, prints Markdown to stdout
- `kairn evolve report --json` — same but outputs JSON
- `kairn evolve report --output <file>` — write report to file instead of stdout
- Prerequisites check: `.kairn-evolve/` exists, at least one iteration completed
- Error handling: no iterations → "No evolution data found. Run `kairn evolve run` first."
- Use `ui.section()` for branded header, then raw Markdown output for the report body

**Verification command:**
```bash
npm run build
node dist/cli.js evolve report --help
```

**Commit message:** `feat(evolve): CLI report command with --json and --output flags`

---

### Step 8: CLI: `kairn evolve diff <iter1> <iter2>` [depends-on: 5]

**What to build:** Wire the diff command into the CLI.

**Files to modify:**
- `src/commands/evolve.ts`

**Key implementation details:**
- `kairn evolve diff <iter1> <iter2>` — shows harness changes between two iterations
- `kairn evolve diff <iter1> <iter2> --task <id>` — shows trace diff for a specific task
- Parse iter1 and iter2 as integers, validate they exist in `.kairn-evolve/iterations/`
- Display: unified diff format (colored with chalk if terminal supports it)
- Error handling: iteration doesn't exist → "Iteration N not found. Available: 0, 1, 2, ..."

**Verification command:**
```bash
npm run build
node dist/cli.js evolve diff --help
```

**Commit message:** `feat(evolve): CLI diff command for harness and trace comparison`

---

### Step 9: Tests [depends-on: 1-6]

**What to build:** Comprehensive test suite for diagnosis and reporting.

**Files to create:**
- `src/evolve/__tests__/report.test.ts`
- `src/evolve/__tests__/diagnosis.test.ts`
- `src/evolve/__tests__/diff.test.ts`

**Key test scenarios:**
- Report from 0 iterations (just baseline)
- Report from 3 iterations with 1 rollback
- Score progression table renders correctly (pass-fail and numeric)
- Key changes correctly identify helped/hurt tasks
- Counterfactual diagnosis flags divergent impacts
- Trace diff handles missing traces gracefully
- Harness diff produces valid unified diff
- JSON report is valid JSON and matches schema
- Markdown report contains all expected sections

**Verification command:**
```bash
npm test
```

**Commit message:** `test(evolve): comprehensive diagnosis and reporting tests`

---

### Step 10: Integration & Polish [depends-on: 7-9]

**What to build:** End-to-end wiring, help text, and output formatting.

**Files to modify:**
- `src/commands/evolve.ts` (verify all subcommands listed in help)

**Key implementation details:**
- Verify `kairn evolve --help` shows: init, baseline, run, report, diff
- Verify `kairn evolve report --help` shows all flags
- Verify `kairn evolve diff --help` shows usage
- Clean up any TypeScript warnings
- Ensure all new exports are properly wired

**Verification command:**
```bash
npm run build
npm test
node dist/cli.js evolve --help
node dist/cli.js evolve report --help
node dist/cli.js evolve diff --help
```

**Commit message:** `feat(evolve): v2.2.0 integration and CLI polish`

---

## Parallel Groups

**Group A (no dependencies):** Steps 1, 2, 3, 4, 5, 6
- All independent — types, report logic, diagnosis, diffing, rendering
- Can all run simultaneously

**Group B (after Group A):** Steps 7, 8, 9
- CLI wiring and tests — depend on the functional modules
- Can run in parallel within this group

**Group C (final):** Step 10
- Integration verification, sequential

---

## Success Criteria (v2.2.0 Complete)

- [ ] All 10 steps committed to feature branch
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (all new + existing tests green)
- [ ] `kairn evolve report` generates Markdown report from iteration data
- [ ] `kairn evolve report --json` outputs valid JSON
- [ ] `kairn evolve diff 0 1` shows harness changes between iterations
- [ ] Counterfactual diagnosis flags conflicting mutation impacts
- [ ] Score progression table renders correctly
- [ ] Code follows v2.0/v2.1 patterns
- [ ] Review checklist passes (spec compliance + code quality)
