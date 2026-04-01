# PLAN-v2.1.0 — The Evolution Loop

**Goal:** Implement the core optimization loop that makes environments self-improving.

**Design doc:** `docs/design/v2.0-kairn-evolve.md` (Section: v2.1.0 — The Evolution Loop, lines ~292-450)

**Scope:** Proposer agent, harness diff engine, mutation application, iteration tracking, rollback logic.

**Estimated complexity:** Large (12-15 steps, ~3-5 parallel groups)

---

## Implementation Steps

### Step 1: Proposer Types & System Prompt [parallel-safe]

**What to build:** Define the Proposal type and write the PROPOSER_SYSTEM_PROMPT constant.

**Files to create:**
- `src/evolve/proposer.ts` (types only, no logic yet)

**Key implementation details:**
- Define `Proposal` interface: `mutations: Mutation[]`, `reasoning: string`, `expectedScoreChange: number`
- Define `Mutation` interface: `type: 'file_add' | 'file_edit' | 'file_delete'`, `path: string`, `oldContent?: string`, `newContent?: string`, `rationale: string`
- Write `PROPOSER_SYSTEM_PROMPT` constant (~2500 words, from design doc)
- Export both types and prompt
- Types live in `src/evolve/types.ts`, prompt in proposer.ts

**Verification command:**
```bash
npm run build
grep -q "PROPOSER_SYSTEM_PROMPT" src/evolve/proposer.ts
```

**Commit message:** `feat(evolve): proposer types and system prompt`

---

### Step 2: Harness Diff Engine [parallel-safe]

**What to build:** Parse and apply unified diff format (.patch files) to the harness.

**Files to create:**
- `src/evolve/diff-engine.ts`

**Key implementation details:**
- `applyPatch(harness: HarnessSnapshot, patch: string): HarnessSnapshot` — parses a .patch file, applies hunks to harness files
- Handle three mutation types: file_add (new file), file_edit (modify), file_delete (remove)
- Error handling: missing file, invalid patch format → clear error messages
- Test the diff engine with a sample patch
- Use `src/evolve/trace.ts` utilities for file I/O

**Verification command:**
```bash
npm test -- src/evolve/__tests__/diff-engine.test.ts
npm run build
```

**Commit message:** `feat(evolve): harness diff engine for applying mutations`

---

### Step 3: Mutation Application to .claude/ [parallel-safe]

**What to build:** Apply a parsed Proposal to the current .claude/ directory, creating a new iteration snapshot.

**Files to create:**
- `src/evolve/mutate.ts`

**Key implementation details:**
- `async function applyMutations(proposal: Proposal, sourceHarness: HarnessSnapshot, targetDir: string): Promise<void>`
- For each mutation in proposal:
  - If `file_add`: write to `targetDir/{path}`
  - If `file_edit`: read from sourceHarness, apply diff, write to targetDir
  - If `file_delete`: skip (don't write the file)
- Create necessary directories
- Validate: all files in targetDir are valid .claude/ files (CLAUDE.md, commands/*.md, rules/*.md, agents/*.md, settings.json, .mcp.json)
- Return updated HarnessSnapshot for the next iteration
- Use async/await, fs.promises

**Verification command:**
```bash
npm test -- src/evolve/__tests__/mutate.test.ts
npm run build
```

**Commit message:** `feat(evolve): apply mutations to harness`

---

### Step 4: Proposer LLM Call & Parsing [parallel-safe]

**What to build:** Call the proposer model with full trace context, parse the response into Proposal.

**Files to create:**
- Complete `src/evolve/proposer.ts` (add runtime logic)

**Key implementation details:**
- `async function propose(iteration: number, config: EvolveConfig): Promise<Proposal>`
- Load: current harness from `.kairn-evolve/iterations/{iteration}/harness/`
- Load: all traces from `.kairn-evolve/traces/{iteration}/`
- Build proposer context (harness files, traces, history)
- Call LLM: `src/llm.ts:callLLM()` with proposerModel (Opus), PROPOSER_SYSTEM_PROMPT, context prompt
- Parse response: extract mutation list from LLM response (structured format: JSON in markdown code block or raw)
- Return Proposal object
- Include retry logic if parse fails (ask LLM for valid JSON)
- Error handling: network error, timeout, invalid JSON → clear messages

**Verification command:**
```bash
npm run build
# Manual: `npm test -- src/evolve/__tests__/proposer.test.ts` (mocked LLM calls)
```

**Commit message:** `feat(evolve): proposer LLM call and response parsing`

---

### Step 5: Iteration Tracker [parallel-safe]

**What to build:** Track iteration state, scores, mutations, and rollback information.

**Files to create:**
- Add to `src/evolve/types.ts`: `IterationState`, `IterationHistory`
- `src/evolve/iteration-tracker.ts`

**Key implementation details:**
- `IterationState`: iteration number, harness snapshot path, proposal applied, scores object, mutations applied (diff)
- `IterationHistory`: array of IterationState, current best iteration, best score
- `async function writeIterationState(state: IterationState): Promise<void>` → writes to `.kairn-evolve/iterations/{N}/metadata.json`
- `async function readIterationHistory(): Promise<IterationHistory>` → reads all metadata.json files, returns sorted history
- `async function getBestIteration(): Promise<IterationState>` → returns iteration with highest aggregate score
- Use JSON serialization, fs.promises, path safety

**Verification command:**
```bash
npm test -- src/evolve/__tests__/iteration-tracker.test.ts
npm run build
```

**Commit message:** `feat(evolve): iteration state tracking and history`

---

### Step 6: Rollback Logic [parallel-safe]

**What to build:** When a mutation causes score to drop, revert to the previous best harness.

**Files to create:**
- `src/evolve/rollback.ts`

**Key implementation details:**
- `async function shouldRollback(previousScores: Scores, currentScores: Scores): Promise<boolean>`
  - Compare aggregate score (mean of all tasks)
  - If current < previous by >= 5%: return true
- `async function rollbackToPrevious(iteration: number): Promise<void>`
  - Load previous best iteration harness
  - Copy back to `.kairn-evolve/iterations/{iteration}/harness/`
  - Update iteration metadata to mark as "rolled back"
- Log rollback reason in metadata for diagnosis
- Handle edge case: iteration 0 (baseline) cannot roll back

**Verification command:**
```bash
npm test -- src/evolve/__tests__/rollback.test.ts
npm run build
```

**Commit message:** `feat(evolve): rollback on regression`

---

### Step 7: Evaluation Loop Orchestrator [parallel-safe]

**What to build:** Orchestrate the full evolution loop: evaluate → diagnose → mutate → evaluate again.

**Files to create:**
- Add to `src/evolve/runner.ts`: `evaluateAllTasks()` function (batch version)
- `src/evolve/evolve-loop.ts`

**Key implementation details:**
- `async function runEvolutionLoop(config: EvolveConfig, maxIterations: number): Promise<void>`
  - For iteration 0: run all tasks against baseline harness, save scores
  - For iteration 1..N:
    - Invoke @proposer: read traces, propose mutations
    - Apply mutations to harness
    - Run all tasks against new harness
    - Evaluate scores
    - Check rollback condition
    - If rollback: revert harness, update metadata
    - Otherwise: save new iteration as baseline for next
  - After N iterations: write summary
- Track elapsed time, cost (token count) per iteration
- Graceful exit: Ctrl+C between iterations (saves state)

**Verification command:**
```bash
npm test -- src/evolve/__tests__/evolve-loop.test.ts
npm run build
```

**Commit message:** `feat(evolve): evolution loop orchestration`

---

### Step 8: Proposer Subagent Delegation (Optional v2.2)

**What to build:** Instead of calling LLM directly, optionally delegate proposer reasoning to a subagent.

**Status:** Out of scope for v2.1.0. Keep for v2.2 (Diagnosis & Reporting).

---

### Step 9: CLI: `kairn evolve run --iterations N` [parallel-safe]

**What to build:** Wire the evolution loop into the CLI.

**Files to modify:**
- `src/commands/evolve.ts`

**Key implementation details:**
- `kairn evolve run --iterations 5` (default: 1, i.e., just baseline eval)
- Parse CLI option, validate: 1 <= iterations <= 50
- Check prerequisites: `.kairn-evolve/` exists, `tasks.yaml` exists, baseline exists
- Call `runEvolutionLoop(config, iterations)`
- Print progress after each iteration: `Iteration 3/5 — Aggregate score: 0.75 (was 0.70) ✓`
- Final summary: best iteration, score improvement, wall time
- Error handling: task fails → report which task, continue to next

**Verification command:**
```bash
npm run build
node dist/cli.js evolve run --help
```

**Commit message:** `feat(evolve): CLI integration for evolution loop`

---

### Step 10: Iteration Log & Metadata [parallel-safe]

**What to build:** Save evolution progress to filesystem for reporting and diagnosis.

**Files to modify:**
- `src/evolve/iteration-tracker.ts` (extend)

**Key implementation details:**
- Write to `.kairn-evolve/iterations/{N}/`:
  - `metadata.json`: iteration number, timestamp, scores, mutations applied
  - `mutation-diff.patch`: unified diff of all changes made in this iteration
  - `proposer-reasoning.md`: reasoning from the proposer (plain text explanation of why mutations were proposed)
- Make metadata.json include: best_score, best_iteration, should_continue (true if likely to improve further)
- Compute "score trajectory" for next iteration decision

**Verification command:**
```bash
npm test -- src/evolve/__tests__/iteration-tracker.test.ts
npm run build
```

**Commit message:** `feat(evolve): iteration logging and metadata`

---

### Step 11: Cost Tracking [parallel-safe]

**What to build:** Track API costs and tokens per iteration.

**Files to create/modify:**
- `src/evolve/cost-tracker.ts`
- Extend `src/llm.ts` to return token counts

**Key implementation details:**
- Track per iteration: tokens_used, tokens_cached, api_cost (using Anthropic pricing)
- Store in metadata.json: `{ ..., costs: { tokens: N, api_cost: "$X.YZ" } }`
- Accumulate total cost across all iterations
- Display in final report: "Total cost: $47.32 across 5 iterations"
- Warn if cost exceeds budget (configurable in config.yaml)

**Verification command:**
```bash
npm run build
grep -q "cost_tracker" src/evolve/evolve-loop.ts
```

**Commit message:** `feat(evolve): track API costs and tokens per iteration`

---

### Step 12: Tests for Full Loop [parallel-safe]

**What to build:** Comprehensive test suite for the evolution loop.

**Files to create:**
- `src/evolve/__tests__/evolve-loop.test.ts` (full integration)
- `src/evolve/__tests__/proposer.test.ts` (with mocked LLM)
- `src/evolve/__tests__/mutation-roundtrip.test.ts` (apply mutation, revert, verify)

**Key test scenarios:**
- Baseline evaluation passes, scores saved
- Proposer generates valid mutations
- Mutations apply cleanly to harness
- Scores improve after mutation
- Rollback triggered on regression
- Cost tracking accumulates correctly
- Iteration metadata written correctly

**Verification command:**
```bash
npm test
```

**Commit message:** `test(evolve): comprehensive evolution loop tests`

---

### Step 13: Integration Test: Full Evolution Run [sequential-after-step-12]

**What to build:** End-to-end test that runs a small evolution (2-3 iterations) on a test project.

**Files to create:**
- `src/evolve/__tests__/e2e-evolution.test.ts`

**Setup:** Create a minimal test harness + 2 simple tasks (one always passes, one needs improvement)

**Scenario:**
- Initialize evolution workspace
- Run baseline evaluation (both tasks)
- Run iteration 1 (proposer suggests improvement to CLAUDE.md)
- Verify improved iteration has better score
- Rollback logic triggered if score drops

**Verification command:**
```bash
npm test -- src/evolve/__tests__/e2e-evolution.test.ts --timeout 60000
npm run build
```

**Commit message:** `test(evolve): end-to-end evolution loop integration test`

---

### Step 14: CLI Output & UX Polish [sequential-after-step-13]

**What to build:** Pretty-printed progress, spinners, and clear reporting during evolution run.

**Files to modify:**
- `src/commands/evolve.ts` (enhance run subcommand output)

**Key implementation details:**
- Use `ora` spinners for long-running phases (evaluate, propose, mutate)
- Display per-iteration progress bar or live score updates
- Use `ui.ts` helpers: `ui.section()`, `ui.success()`, `ui.info()`, `ui.kv()`
- Show: iteration N/M, elapsed time, current aggregate score, delta from previous
- Color code: green (improvement), yellow (no change), red (regression, rolled back)
- Final summary box with best iteration, improvement %, total cost

**Verification command:**
```bash
npm run build
# Manual: kairn evolve run --iterations 2 (watch output)
```

**Commit message:** `feat(evolve): evolution run output and UX polish`

---

### Step 15: Wire evolveCommand to CLI [sequential-final]

**What to build:** Ensure `evolveCommand` is exported and registered in main CLI.

**Files to verify:**
- `src/cli.ts` includes `evolveCommand`

**Verification command:**
```bash
npm run build
node dist/cli.js evolve --help
node dist/cli.js evolve run --help
```

**Commit message:** `feat: wire evolve command to main CLI`

---

## Success Criteria (v2.1.0 Complete)

- [ ] All 15 steps committed to feature branch
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (all new tests green)
- [ ] `npm run lint` passes (no TS errors, ESLint clean)
- [ ] `kairn evolve run --iterations 3` works end-to-end
- [ ] Iteration metadata written to `.kairn-evolve/iterations/{N}/`
- [ ] Rollback logic tested and working
- [ ] Cost tracking accurate
- [ ] Code follows patterns from v2.0.0
- [ ] Review checklist passes (spec compliance + code quality)

---

## Parallel Groups

**Group A (no dependencies):** Steps 1, 2, 3, 4, 5, 6, 7, 10, 11
- Can all start at once, most complete in parallel
- Step 4 depends on Step 1 (proposer types)
- Others are independent

**Group B (after Group A):** Steps 9, 12, 13
- Require the functional modules from Group A
- Comprehensive testing

**Group C (final):** Steps 14, 15
- Polish and integration, run sequentially at the end

---

## Notes

- The proposer system prompt is critical — it drives the quality of mutations
- Cost tracking and iteration logging are important for future diagnosis (v2.2)
- Rollback prevents the evolution from getting stuck in bad local optima
- Start with simple greedy search (mutate once, evaluate, keep if better); v2.3 will add population-based / beam search
