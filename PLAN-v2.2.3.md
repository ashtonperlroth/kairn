# PLAN v2.2.3 — End-to-End Loop Validation

> **Thesis:** The evolution loop's components are built (v2.0–v2.2.2). This version proves the full loop works end-to-end: mutations apply, scores move, and evolved > static is demonstrable with measurement rigor.

---

## Context

**Current state:** All evolve infrastructure exists (`loop.ts`, `proposer.ts`, `mutator.ts`, `runner.ts`, `scorers.ts`, `report.ts`, `diagnosis.ts`). JSON mode is wired up (v2.2.2). Delete mutations are typed (v2.2.1). But nobody has proven the loop actually improves a harness. The `apply` command is missing — users have to manually copy evolved harnesses.

**Existing CLI commands:**
- `kairn evolve init` → scaffold workspace + generate tasks
- `kairn evolve baseline` → snapshot .claude/ as iteration 0
- `kairn evolve run [--iterations N] [--task <id>]` → single task or full loop
- `kairn evolve report [--json]` → markdown/JSON report
- `kairn evolve diff <iter1> <iter2>` → harness diff between iterations

**Missing:** `kairn evolve apply [--iter N]` — adopt best harness into `.claude/`

**Key files:**
- `src/evolve/types.ts` — Score, EvolveResult, IterationLog, EvolveConfig
- `src/evolve/loop.ts` — `evolve()` function (the core loop)
- `src/evolve/runner.ts` — `runTask()`, `evaluateAll()`, isolated worktree workspaces
- `src/evolve/scorers.ts` — `passFailScorer()`, `llmJudgeScorer()`, `rubricScorer()`
- `src/commands/evolve.ts` — CLI entry points for all evolve subcommands

---

## Steps

### Step 1: `kairn evolve apply` — adopt best harness
> The highest-friction UX gap. Users can't adopt an evolved harness without manually copying files.

**New file:** `src/evolve/apply.ts`

```typescript
export interface ApplyResult {
  iteration: number;
  filesChanged: string[];
  diffPreview: string;
}

export async function applyEvolution(
  workspacePath: string,
  projectRoot: string,
  targetIteration?: number,  // undefined = best iteration
): Promise<ApplyResult>
```

**Behavior:**
1. Read iteration logs to find best iteration (or use `--iter N`)
2. Generate unified diff between current `.claude/` and target iteration's harness
3. Display diff preview to user (colored, like `evolve diff`)
4. On confirmation: copy target harness over `.claude/`, stage + commit with message `feat: apply evolved harness from iteration N (score: X%)`
5. If git is dirty, warn and require `--force`

**CLI in `src/commands/evolve.ts`:**
```
kairn evolve apply [--iter N] [--force] [--no-commit]
```

**Tests in `src/evolve/__tests__/apply.test.ts`:**
- Applies best iteration when no `--iter` flag
- Applies specific iteration when `--iter 2`
- Generates correct diff preview
- Creates git commit with correct message
- Errors when iteration doesn't exist
- Warns on dirty git state

**Acceptance:** `npm run build` passes, `npm test` passes, `kairn evolve apply --help` shows usage.

---

### Step 2: Variance controls — run each task N times
> LLM-as-judge scoring is noisy. A single run proves nothing. N runs with mean ± stddev proves something.

**Modify:** `src/evolve/types.ts`

Add to `EvolveConfig`:
```typescript
runsPerTask: number;  // default: 1 (existing behavior), set to 3 for rigor
```

Add to `Score`:
```typescript
variance?: {
  runs: number;
  scores: number[];
  mean: number;
  stddev: number;
};
```

**Modify:** `src/evolve/runner.ts` → `evaluateAll()`

When `runsPerTask > 1`:
1. Run each task N times (sequentially, same harness)
2. Collect N score values
3. Compute mean and stddev
4. Use mean as the canonical score for that task
5. Store all runs in `variance` field

**Modify:** `src/evolve/loop.ts`

- Thread `evolveConfig.runsPerTask` through to `evaluateAll()`
- No change to loop logic — it already uses `aggregate` which comes from `evaluateAll()`

**Modify:** `src/commands/evolve.ts`

- Add `--runs <n>` option to `evolve run` (default: 1)
- Add `runs_per_task` to `config.yaml` schema
- Display stddev in iteration table when runs > 1:
  ```
  Iter  Score        Mutations  Status
     0  80.0% ±4.2          -  baseline
     1  85.3% ±2.1          3  best
  ```

**New progress event:** `'task-run'` (for `Run 2/3 of task-X...`)

**Tests:**
- `evaluateAll` with `runsPerTask: 3` runs each task 3 times
- Mean and stddev computed correctly
- Single run (default) has no variance field
- CLI displays stddev when present

**Acceptance:** `npm run build` passes, `npm test` passes. Running `kairn evolve run --runs 3 --task some-task` shows 3 runs with mean ± stddev.

---

### Step 3: Integration test — loop applies mutations and score improves
> Prove the loop works end-to-end in a controlled test environment.

**New file:** `src/evolve/__tests__/integration.test.ts`

**Setup:** Create a minimal test project with:
- A `.claude/CLAUDE.md` that is intentionally weak (e.g., missing verification section, no git rules, vague instructions)
- A `tasks.yaml` with 2-3 simple tasks that will score poorly against the weak harness
- Mock or stub the LLM calls (proposer + scorer) with deterministic responses:
  - Proposer returns a known mutation that adds the missing section
  - Scorer returns higher score when the section is present

**Test flow:**
1. `snapshotBaseline()` → creates iteration 0 harness
2. `evolve()` with `maxIterations: 3`
3. Assert: `result.bestScore > result.baselineScore`
4. Assert: `result.bestIteration > 0` (loop actually improved)
5. Assert: iteration logs contain non-null proposals with mutations
6. Assert: mutation diffs are non-empty strings

**Why mock?** Real LLM calls are expensive, slow, and non-deterministic. The integration test should prove the *loop mechanics* work (evaluate → propose → mutate → re-evaluate → score increases). Real LLM validation is the proof artifact (Step 4).

**Tests:**
- Full loop: baseline → propose → mutate → re-evaluate → score improves
- Rollback: score drops → loop reverts to best iteration
- Proposer error: loop skips mutation, copies harness forward
- Perfect score: loop exits early

**Acceptance:** `npm test` passes with the integration test suite. No flaky tests (deterministic mocks).

---

### Step 4: Proof artifact — evolved > static on a real project
> Not a code step. A live demonstration that the evolution loop improves a harness.

**Run against Kairn itself:**
1. `cd ~/Projects/kairn-v2`
2. `kairn evolve init` (or reuse existing `.kairn-evolve/`)
3. `kairn evolve baseline`
4. `kairn evolve run --iterations 5 --runs 3`
5. `kairn evolve report > PROOF-v2.2.3.md`
6. `kairn evolve apply` (adopt best harness)

**Expected proof artifact:** `PROOF-v2.2.3.md` showing:
- Baseline score (iteration 0) with stddev
- Best score (iteration N) with stddev
- Improvement delta with statistical significance (mean ± stddev doesn't overlap)
- The specific mutations that helped (from report)

**Commit message:** `docs: proof artifact — evolved > static by X points (v2.2.3)`

**Acceptance:** `PROOF-v2.2.3.md` exists, shows improvement with variance data. If no improvement: investigate why, fix, re-run. The version doesn't ship until evolved > static is demonstrated.

---

## Execution Order

```
Step 1 (apply)     → Step 2 (variance) → Step 3 (integration test) → Step 4 (proof)
   [new feature]      [measurement]         [loop correctness]          [thesis validation]
```

Steps 1 and 2 are independent and can be built in parallel.
Step 3 depends on Step 2 (variance fields in types).
Step 4 depends on all three.

---

## Completion Criteria

- [ ] `kairn evolve apply` works (copies best harness, shows diff, commits)
- [ ] `--runs N` produces mean ± stddev for each task
- [ ] Integration test suite passes with deterministic mocks
- [ ] `PROOF-v2.2.3.md` shows evolved > static with variance data
- [ ] `npm run build` clean, `npm test` all green
- [ ] Version bumped to 2.2.3 in package.json (already done)
- [ ] ROADMAP.md updated (v2.2.3 marked ✅)
- [ ] CHANGELOG.md updated

---

## Ralph Loop Prompt

```
/ralph-loop Read PLAN-v2.2.3.md. Execute steps 1-3 in order. For each step: write failing tests first (RED), implement until tests pass (GREEN), then clean up (REFACTOR). Run npm run build and npm test after each step. Commit after each step passes. Step 4 is a live run — skip it in the loop. --max-iterations 15 --completion-promise 'Steps 1-3 complete: apply command works, variance controls work, integration tests pass'
```
