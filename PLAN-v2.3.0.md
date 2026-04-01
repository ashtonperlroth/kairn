# PLAN-v2.3.0 — Advanced Scoring & Search + Quick Wins

**Goal:** Improve evolution visibility and iteration speed. Add advanced scoring capabilities, harness utilization metrics, and cost tracking. Plus: ship three quick-win features that unblock downstream work.

**Design doc:** `docs/design/v2.0-kairn-evolve.md` (Section: v2.3.0 — Advanced Scoring)

**Depends on:** v2.2.3 (Mutation Scope) — all evolution loop fixes must be complete

**Estimated complexity:** Medium (10 steps, 3 parallel groups)

**Structure:** Quick wins (infrastructure) + Medium features (tooling) + Scoring (core v2.3)

---

## Quick Win 1: Fix Hardcoded CLI Version [parallel-safe]

**What to build:** Read package.json version dynamically instead of hardcoding.

**Files to modify:**
- `src/cli.ts`

**Key implementation details:**
- `src/cli.ts:22` has `.version("1.9.0")` hardcoded
- Read from `package.json` at runtime using `import` or `readFileSync`
- Approach: Import `package.json` as module (ESM native):
  ```typescript
  import { version } from '../package.json' assert { type: 'json' };
  ```
  Then use `version` directly in `.version(version)`
- Fallback: If import fails, use `readFileSync('./package.json', 'utf-8')` and parse JSON
- Verify `npm run build` doesn't break the import

**Verification command:**
```bash
npm run build
npm test -- src/__tests__/cli.test.ts
npx tsx src/cli.ts --version  # Should output 2.3.0 or current package.json version
```

**Commit message:** `fix(cli): read version from package.json instead of hardcoding`

---

## Quick Win 2: Parallel Task Evaluation [depends-on: architecture review]

**What to build:** Run `evaluateAll` tasks in parallel with concurrency control.

**Files to modify:**
- `src/evolve/runner.ts` (if `evaluateAll` is here)
- OR `src/evolve/types.ts` + wherever `evaluateAll` is called

**Key implementation details:**
- Current: `evaluateAll` iterates tasks sequentially with `for await`
- Change: Use `Promise.all` with a concurrency limit (e.g., 2-3 parallel tasks)
- Use `pLimit` from `npm:p-limit` (already a dependency?) or build a simple queue
- Each task gets its own git worktree (already isolated), so parallelism is safe
- Iteration time: ~20 min (sequential) → ~5 min (parallel with 4 tasks @ 1.5 min each)
- Config: Read from `EvolveConfig.maxParallel` (default: 3, user-overridable via CLI flag `--max-parallel`)

**Verification command:**
```bash
npm run build
npm test -- src/evolve/__tests__/runner.test.ts  # Ensure isolation still works
# Manual: time npx tsx src/cli.ts evolve run --iterations 1 (should be ~5 min, not 20)
```

**Commit message:** `perf(evolve): parallelize task evaluation with concurrency limit`

---

## Quick Win 3: `kairn evolve apply` — Copy Best Harness [depends-on: 1]

**What to build:** CLI command to copy the best iteration's harness back to `.claude/` with confirmation.

**Files to modify:**
- `src/cli.ts` (add new command)
- `src/evolve/apply.ts` (NEW file)

**Key implementation details:**
- New command: `kairn evolve apply [options]`
- Options:
  - `--iter N` — apply a specific iteration (default: auto-detect best)
  - `--force` — skip confirmation
- Logic:
  1. Load iteration log from `.kairn-evolve/iterations.json`
  2. Find best iteration (highest aggregate score)
  3. Show diff between current `.claude/` and best harness (using existing `generateDiff`)
  4. Prompt user: "Apply harness from iteration {N}? (y/n)"
  5. If yes, copy best harness to `.claude/` and git commit
  6. Commit message: `feat: apply evolved harness from iteration {N} (score {S}%)`
- Error handling: No .kairn-evolve dir → error with hint to run `kairn evolve run` first

**Verification command:**
```bash
npm run build
npm test -- src/evolve/__tests__/apply.test.ts  # NEW test file
# Manual: npx tsx src/cli.ts evolve run --iterations 2, then kairn evolve apply
```

**Commit message:** `feat(evolve): add 'kairn evolve apply' to copy best harness to .claude/`

---

## Quick Win 4: Capture Tool Calls in Traces [depends-on: 1]

**What to build:** Parse Claude Code's tool_use blocks to extract actual tool invocations and MCP usage.

**Files to modify:**
- `src/evolve/runner.ts` (modify runner to capture tool output)

**Key implementation details:**
- Runner currently uses `--output-format text` → tool_calls.jsonl is always empty
- Switch to `--output-format stream-json` or keep text but parse tool_use from the transcript
- Parse the output to extract:
  - Tool calls (which MCP servers, which tools, how many times)
  - Slash commands (which agents were invoked)
  - Cost (tokens consumed)
- Store in `iterations/{N}/tool_calls.json` (easier to query than .jsonl)
- Format:
  ```json
  {
    "tools_used": ["web_search", "file_read"],
    "mcp_servers": ["filesystem", "web"],
    "agents_invoked": ["@planner", "@implementer"],
    "slash_commands": ["/project:ship", "/git"],
    "total_tokens": 45000
  }
  ```
- Note: This is infra for harness utilization metrics (Step 7) — don't try to do that analysis here

**Verification command:**
```bash
npm run build
npm test -- src/evolve/__tests__/runner.test.ts
# Manual: Run a task, check iterations/{N}/tool_calls.json exists and parses
```

**Commit message:** `feat(evolve): capture tool calls and MCP usage from runner output`

---

## Step 5: Harness Utilization Metrics [depends-on: 4]

**What to build:** Analyze tool_calls.json to measure harness coverage and tool relevance.

**Files to modify:**
- `src/evolve/metrics.ts` (NEW file)
- `src/evolve/proposer.ts` (pass utilization data to proposer context)

**Key implementation details:**
- Read tool_calls.json from iteration
- Metrics to compute:
  - **Tool utilization:** tools_used.length / total_tools_available (e.g., 3/28 = 11%)
  - **Agent utilization:** agents_invoked.length / total_agents (e.g., 2/5 = 40%)
  - **Bloat score:** rules in harness that were never used (e.g., "only 60% of rules were referenced")
  - **Specificity score:** if agent used tool X, but harness had 5 unused similar tools (e.g., "used 1/5 search tools")
- Pass these metrics to proposer in the context section:
  ```
  Tool Coverage: 11% (3 of 28 tools used)
  Unused MCP Servers: postgresql, slack, notion
  Agents Invoked: @planner, @implementer (60%)
  ```
- Proposer can use this to prioritize pruning (delete unused tools) or adding missing tools

**Verification command:**
```bash
npm run build
npm test -- src/evolve/__tests__/metrics.test.ts  # NEW test file
```

**Commit message:** `feat(evolve): add harness utilization metrics (tool/agent/rule coverage)`

---

## Step 6: Cost Tracking Per Iteration [parallel-safe]

**What to build:** Track and report API costs for each iteration.

**Files to modify:**
- `src/evolve/types.ts` (add cost fields to IterationLog)
- `src/evolve/baseline.ts` or `src/evolve/runner.ts` (capture tokens)
- `src/evolve/report.ts` (show cost breakdown)

**Key implementation details:**
- Add to `IterationLog`:
  ```typescript
  cost: {
    tokens_used: number;
    estimated_usd: number;  // Anthropic pricing: $3/$15 per M tokens
    wall_time_seconds: number;
  }
  ```
- Capture in runner:
  - Extract `usage.input_tokens` and `usage.output_tokens` from each LLM call
  - Sum across all tasks in iteration
  - Use Anthropic pricing: input = $3/M, output = $15/M (Claude 3.5 Opus)
- Show in `kairn evolve report`:
  ```
  Iteration 0:  score=93.0%  tokens=245,000  cost=$1.23
  Iteration 1:  score=94.5%  tokens=210,000  cost=$1.05
  Iteration 2:  score=93.2%  tokens=198,000  cost=$0.99
  ```
- Add CLI flag: `--budget $5` (error if cost exceeds budget before starting iteration)

**Verification command:**
```bash
npm run build
npm test -- src/evolve/__tests__/report.test.ts
# Manual: npx tsx src/cli.ts evolve report (should show cost column)
```

**Commit message:** `feat(evolve): track and report API cost per iteration`

---

## Step 7: Multi-Objective Scoring Framework [parallel-safe]

**What to build:** Enable custom scoring functions and multi-objective optimization.

**Files to modify:**
- `src/evolve/types.ts` (add ScoringFunction interface, multi-objective config)
- `src/evolve/scorers.ts` (factory for built-in scorers)

**Key implementation details:**
- Current: single score per task (0-100%)
- New: multi-objective with weights
  ```typescript
  interface ObjectiveScore {
    correctness: number;        // 0-100, from task verification
    efficiency: number;         // 0-100, based on tokens/latency
    cost_efficiency: number;    // 0-100, based on cost vs. performance
  }
  
  interface ScoringConfig {
    weights?: {
      correctness: number;      // default 0.7
      efficiency: number;       // default 0.2
      cost_efficiency: number;  // default 0.1
    }
  }
  ```
- Aggregate score: `correctness * 0.7 + efficiency * 0.2 + cost_efficiency * 0.1`
- Custom scoring: Allow user-defined scorer functions in `.kairn-evolve/custom-score.ts`
  - Proposer can suggest efficiency optimizations if efficiency score is low
  - Proposer can suggest cost cuts if cost_efficiency is low
- UI: Show breakdown in report:
  ```
  Iteration 1:
    Correctness:     98.0%  ████████████████████ (pass 4/4 tasks)
    Efficiency:      72.0%  ████████████████     (fast agents)
    Cost Efficiency: 85.0%  ███████████████████  (minimal tokens)
    ───────────────────────
    Weighted Score:  89.2%  ███████████████████
  ```

**Verification command:**
```bash
npm run build
npm test -- src/evolve/__tests__/scorers.test.ts
```

**Commit message:** `feat(evolve): multi-objective scoring (correctness × efficiency × cost)`

---

## Step 8: Search Strategy Selection [parallel-safe]

**What to build:** CLI option to choose evolution strategy (greedy, best-of-N, population-based).

**Files to modify:**
- `src/evolve/types.ts` (add `searchStrategy` to EvolveConfig)
- `src/evolve/loop.ts` (implement different strategies)
- `src/cli.ts` (add `--search-strategy` flag)

**Key implementation details:**
- Three strategies:
  - **Greedy (default):** Current loop — apply best mutation, move to next iteration
  - **Best-of-N:** Proposer generates 3 mutation sets, evaluate all, pick best before next iteration (slower, more thorough)
  - **Population-based:** Keep 3 best harnesses, mutate each independently, evolve for N iterations (like genetic algorithms)
- CLI: `kairn evolve run --iterations 3 --search-strategy best-of-n`
- Config file: can set default in `.kairn-evolve/config.json`
- Only implement structure/types here — actual algorithms in Step 9

**Verification command:**
```bash
npm run build
npm run typecheck
```

**Commit message:** `feat(evolve): add search strategy options (greedy, best-of-N, population)`

---

## Step 9: Prompt Caching Integration [parallel-safe]

**What to build:** Use Anthropic's ephemeral prompt caching to cache large trace reads.

**Files to modify:**
- `src/llm.ts` (add cache_control to system prompt in proposer calls)
- `src/evolve/proposer.ts` (mark large trace context as cacheable)

**Key implementation details:**
- Current: Proposer reads full traces (10K+ tokens) on every iteration
- With caching: Mark the trace as cacheable in first read, reuse cache on mutations
- Approach:
  ```typescript
  // In src/llm.ts, when jsonMode or large context:
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: traceData,
          cache_control: { type: "ephemeral" }
        }
      ]
    }
  ]
  ```
- Savings: ~85% reduction in prompt tokens on cache hits (estimated 8-10 tokens input cost vs 250 full trace)
- No CLI changes — automatic

**Verification command:**
```bash
npm run build
npm test -- src/__tests__/llm.test.ts  # Verify cache_control doesn't break calls
```

**Commit message:** `feat(evolve): use Anthropic ephemeral prompt caching for traces`

---

## Step 10: Validation Set (Train/Test Split) [parallel-safe]

**What to build:** Allow splitting tasks into train and held-out validation sets.

**Files to modify:**
- `src/evolve/types.ts` (add validationTasks to EvolveConfig)
- `src/evolve/loop.ts` (use validation set only for final scoring)
- `src/evolve/report.ts` (show train/validation scores separately)

**Key implementation details:**
- Current: Evolve loop optimizes on ALL tasks simultaneously
- New: Split tasks 70% train / 30% validation
- Loop behavior:
  - Iterations 0-N: Optimize on train set only (proposer reads train traces, applies mutations)
  - After loop: Score final harness on BOTH train and validation sets
  - Report shows:
    ```
    Iteration 2 (train):       score=94.5%
    Final (train vs validation):  train=94.5%, validation=91.8%
    ```
- Prevents overfitting — if validation score drops, harness is overfit
- Config: `--validation-split 0.3` or `--validation-tasks [task1,task2]`

**Verification command:**
```bash
npm run build
npm test -- src/evolve/__tests__/loop.test.ts
```

**Commit message:** `feat(evolve): add held-out validation set to prevent overfitting`

---

## Parallel Groups

**Group A [parallel, no dependencies]:**
- Step 1: Hardcoded version fix
- Step 6: Cost tracking
- Step 7: Multi-objective scoring
- Step 8: Search strategy selection
- Step 9: Prompt caching
- Step 10: Validation set

**Group B [after A]:**
- Step 2: Parallel task evaluation (architecture review first, then build)
- Step 3: `kairn evolve apply` (depends on version fix + stable iteration log)
- Step 4: Capture tool calls (core infrastructure)

**Group C [after B]:**
- Step 5: Harness utilization metrics (depends on tool calls capture)

---

## Success Criteria (v2.3.0 Complete)

- [ ] All 10 steps committed to feature branch
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (all new + existing tests green)
- [ ] **Iteration time:** ~5 min per iteration (from ~20 min with parallel eval)
- [ ] `kairn evolve apply --iter 1` copies best harness to .claude/ with confirmation
- [ ] `kairn --version` reads from package.json (not hardcoded)
- [ ] Tool calls captured in iterations/{N}/tool_calls.json
- [ ] Harness utilization metrics shown in proposer context
- [ ] `kairn evolve report` shows cost_usd column
- [ ] Multi-objective scores breakdown shown (correctness × efficiency × cost)
- [ ] `--search-strategy` flag options work (greedy/best-of-N/population)
- [ ] Anthropic ephemeral caching active (reduces proposer input tokens ~85%)
- [ ] Validation set split prevents overfitting (validation score visible in report)
- [ ] Integration test: `kairn evolve run --iterations 3 --validation-split 0.3 --search-strategy best-of-n` succeeds
