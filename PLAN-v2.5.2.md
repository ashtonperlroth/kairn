# PLAN v2.5.2 — Evolve Permissions Fix & Expanded Eval Menu

> **Thesis:** The evolve loop's signal is corrupted by two problems: (1) Claude Code permission prompts block agents in `--print` mode, wasting proposer mutations on workarounds instead of harness improvements; (2) the eval menu is too small (5 tasks) so every iteration grinds the same set, limiting proposer diversity. Fix permissions, expand the menu to 12 tasks, and enable mini-batch sampling.

---

## Context

**Current state:** `spawnClaude()` in `src/evolve/runner.ts` uses `claude --print --output-format text --max-turns 50` with NO permission bypass. The `slash-command-workflow` eval scores 5% consistently because the agent tries to write `.claude/commands/clean.md`, hits a permission prompt it can't answer in `--print` mode, and stops. The proposer has wasted 4 iterations trying to fix this via settings.json allow lists and prose instructions — none of which work because the permission system doesn't respect `Write(.claude/**)` globs correctly in non-interactive mode.

**Mini-batch sampling** is already implemented in `src/evolve/loop.ts` (lines 111-137) via `evalSampleSize` config. It's set to 0 (disabled). The adaptive pruning also exists (skip tasks above `pruneThreshold` on middle iterations). Both just need to be configured.

**Key files:**
- `src/evolve/runner.ts:207-248` — `spawnClaude()` function
- `.kairn-evolve/tasks.yaml` — eval task definitions
- `.kairn-evolve/config.yaml` — evolution config
- `src/commands/evolve.ts:21-34` — DEFAULT_CONFIG with `evalSampleSize: 0`

---

## Steps

### Step 1: Fix Permissions in Runner
> One-line fix that unblocks the entire evolve pipeline.

**Modify: `src/evolve/runner.ts`**

In `spawnClaude()`, add `--dangerously-skip-permissions` to the args array:

```typescript
const args = ['--print', '--output-format', 'text', '--max-turns', '50', '--dangerously-skip-permissions'];
```

**Why this is safe:** Evolve runs execute in disposable git worktrees that are pruned after each task. There is nothing to protect. The permission system tests Claude Code's permission matching, not harness quality — it's a confound that corrupts eval signal.

**Tests: `src/evolve/__tests__/runner.test.ts`**
- Verify `spawnClaude` passes `--dangerously-skip-permissions` in args
- Existing tests continue to pass

**Acceptance:** `npm run build` passes, `npm test` passes, the args array includes the flag.

---

### Step 2: Expand Eval Menu (5 → 12 tasks)
> Add 7 new medium-weight tasks that each test a specific harness dimension. Designed so a generic agent (no CLAUDE.md) would fail, but a harness-guided agent succeeds.

**Modify: `.kairn-evolve/tasks.yaml`**

Add the following 7 new tasks after the existing 5:

#### 2a. `fs-promises-convention` (convention-adherence, 120s, pass-fail)
- **Task:** "Add a utility function `loadJsonFile(filePath: string)` in `src/utils/json-loader.ts` that reads a JSON file and returns the parsed object. Wire it into the project."
- **Harness signal:** CLAUDE.md says "All file I/O via fs.promises." Without this, agents default to `fs.readFileSync`.
- **Scoring:** pass-fail — run `grep -r "readFileSync\|readSync\|writeFileSync\|writeSync" src/utils/json-loader.ts` in expected_outcome. Zero matches = pass.

#### 2b. `chalk-color-mapping` (convention-adherence, 120s, rubric)
- **Task:** "Add a `health` command to `src/commands/health.ts` that checks if `~/.kairn/config.json` exists and reports: success message if found, warning if config is empty, error if missing, info line showing the path checked. Wire into cli.ts."
- **Harness signal:** CLAUDE.md mandates exact color mapping: green=success, yellow=warn, red=error, cyan=info. Without this, agents use arbitrary colors.
- **Scoring:** rubric (4 criteria × 25 weight each): green for success, yellow for warning, red for error, cyan for info.

#### 2c. `error-boundary-pattern` (convention-adherence, 120s, rubric)
- **Task:** "Add a `validate` command to `src/commands/validate.ts` that checks if a `.kairn-evolve/tasks.yaml` exists and is valid YAML. Wire into cli.ts."
- **Harness signal:** CLAUDE.md says "catch at command level, friendly message, exit 1." Without this, agents scatter try/catch or let errors propagate.
- **Scoring:** rubric — (1) errors caught at command boundary not scattered (weight 40), (2) chalk.red for error display (weight 30), (3) process.exit(1) on failure (weight 30).

#### 2d. `security-path-validation` (rule-compliance, 180s, rubric)
- **Task:** "Add a function `resolveEnvPath(userPath: string): string` in `src/utils/paths.ts` that resolves a user-provided path to an environment directory under `~/.kairn/envs/`. The function must be safe against path traversal attacks."
- **Harness signal:** `.claude/rules/security.md` says "Sanitize all file paths — prevent path traversal (../)". Without this, agents accept raw paths.
- **Scoring:** rubric — (1) rejects `../` traversal attempts (weight 40), (2) resolves to within `~/.kairn/envs/` only (weight 30), (3) handles edge cases: empty string, absolute paths outside base (weight 30).

#### 2e. `single-conventional-commit` (workflow-compliance, 120s, pass-fail)
- **Task:** "Fix the description string in `src/cli.ts` — change 'Agent Environment Compiler' to 'Agent Environment Compiler & Optimizer'. Commit the change."
- **Harness signal:** CLAUDE.md says "conventional commits: feat:, fix:, docs:, refactor:, test:" and "small, focused commits." Without this, agents use freeform messages.
- **Scoring:** pass-fail — check `git log -1 --format=%s` matches `^(feat|fix|docs|refactor|test|chore|style|ci|perf|build)(\(.+\))?:`.

#### 2f. `inquirer-import-check` (convention-adherence, 120s, pass-fail)
- **Task:** "Add an interactive `confirm` prompt to the `describe` command that asks 'Generate environment?' before compilation. Use the project's preferred prompts library."
- **Harness signal:** CLAUDE.md Known Gotchas says "Use `@inquirer/prompts` not old `inquirer` package." Without this, agents import the wrong package.
- **Scoring:** pass-fail — `grep -r "from 'inquirer'" src/` should find zero matches; `grep -r "@inquirer/prompts" src/commands/describe.ts` should find at least one.

#### 2g. `env-id-prefix` (convention-adherence, 120s, pass-fail)
- **Task:** "Add a `createEnvironmentId()` function in `src/utils/ids.ts` that generates a new environment ID. Follow the project's ID convention."
- **Harness signal:** CLAUDE.md says "IDs: `crypto.randomUUID()` prefixed with `env_`." Without this, agents use nanoid, uuid, or Math.random.
- **Scoring:** pass-fail — file contains `crypto.randomUUID()` AND the string `env_`.

---

### Step 3: Configure Sampling
> Enable mini-batch sampling so each middle iteration runs ~5 of the 12 tasks.

**Modify: `.kairn-evolve/config.yaml`**

```yaml
model: claude-sonnet-4-6
proposer_model: claude-opus-4-6
scorer: pass-fail
max_iterations: 5
parallel_tasks: 2
eval_sample_size: 5
prune_threshold: 90
runs_per_task: 1
```

Changes from current:
- `eval_sample_size: 5` — each middle iteration samples 5 tasks from the non-pruned pool
- `parallel_tasks: 2` — run 2 tasks concurrently (safe with worktree isolation)
- `prune_threshold: 90` — lower from 95 to 90 so more tasks get carried forward (we have more tasks now)

**Behavior per iteration:**
- **Iteration 0 (baseline):** Runs all 12 tasks — full baseline measurement
- **Iterations 1-3 (middle):** Prune tasks ≥90%, sample 5 from remainder — diverse signal, lower cost
- **Iteration 4 (final):** Runs all 12 tasks — comprehensive final score

**Cost estimate:** ~35 task runs per cycle (12 + 5×3 + 12) vs. ~60 previously (12×5). ~40% reduction.

---

### Step 4: Reset Baseline Harness
> The evolved iterations accumulated permission workarounds (expanded Bash patterns, write-permissions.md rule file). With `--dangerously-skip-permissions`, these are dead weight. Reset to clean baseline.

**Action:** After Step 1 is verified, re-run `kairn evolve baseline` to snapshot the current `.claude/` directory (which does NOT have the permission hacks — those were only in evolved iterations). This gives a clean starting point for the next evolution run.

**Verify:** The baseline harness should NOT contain:
- `.claude/rules/write-permissions.md`
- Excessive Bash patterns in settings.json (the 20+ patterns added by the proposer)

---

### Step 5: Smoke Test
> Run a single iteration to prove everything works.

```bash
npx tsx src/cli.ts evolve run --iterations 1
```

**Verify:**
- `slash-command-workflow` no longer scores 5% due to permission blocks
- New tasks execute and produce meaningful scores
- Sampling works on iteration 1 (if >1 iteration, check that middle iters sample)
- No permission-related errors in stderr

**Acceptance:** All 12 tasks execute. No permission failures. Aggregate baseline score is established.

---

## Execution Order

```
Step 1 (permissions fix)
    │
    ├── Step 2 (expand tasks.yaml)     ← independent of Step 1
    │
    ▼
Step 3 (config sampling)              ← after Step 2 (needs task count)
    │
    ▼
Step 4 (reset baseline)               ← after Steps 1+2+3
    │
    ▼
Step 5 (smoke test)                    ← after all
```

Steps 1 and 2 are independent and can be done in parallel.

---

## Completion Criteria

- [ ] `spawnClaude()` passes `--dangerously-skip-permissions` flag
- [ ] `tasks.yaml` has 12 tasks (5 existing + 7 new)
- [ ] `config.yaml` has `eval_sample_size: 5` and `parallel_tasks: 2`
- [ ] Runner test verifies the new flag
- [ ] `npm run build` clean
- [ ] `npm run typecheck` clean
- [ ] `npm test` all green
- [ ] Version bumped to 2.5.2 in package.json
- [ ] ROADMAP.md updated (v2.5.2 section added)
- [ ] CHANGELOG.md updated

---

## Ralph Loop Prompt

```
Read PLAN-v2.5.2.md. Execute steps 1-5 in order (Steps 1 and 2 can be parallel). For each step: implement the change, run npm run build && npm run typecheck && npm test to verify. Commit after each step passes with conventional commit format. Step 5 (smoke test) is optional — run it only if all prior steps pass and time permits. Do NOT run the full evolve loop — just verify the individual pieces work.
```
