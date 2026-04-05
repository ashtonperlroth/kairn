# Kairn Roadmap

> From local CLI to the coordination layer for agent environments.

Each version milestone links to a detailed design doc in `docs/design/` with implementation specifics.

---

## v1.x — Local CLI (Current)

### v1.0.0 ✅
- [x] `kairn init` — multi-provider setup (Anthropic, OpenAI, Google)
- [x] `kairn describe` — intent → environment compilation → .claude/ directory
- [x] `kairn list` — show saved environments
- [x] `kairn activate` — re-deploy saved environments
- [x] `kairn update-registry` — fetch latest tool catalog
- [x] 18 curated tools across search, code, data, communication, design
- [x] Security rules and deny lists by default
- [x] Session continuity patterns (help, tasks, decisions, learnings)

### v1.2.0 ✅
- [x] `kairn optimize` — scan existing codebases, audit and optimize harnesses
- [x] Project scanner (language, framework, deps, scripts, env keys, CI/CD)
- [x] Harness auditor (CLAUDE.md quality, missing commands/rules, MCP bloat)
- [x] Post-setup instructions with API key requirements and signup URLs
- [x] Correct model IDs + backward-compatible config migration

### v1.3.0 ✅ — Environment Quality ([design doc](docs/design/v1.3-environment-quality.md))
- [x] Structured CLAUDE.md template (7-section format enforced by compilation prompt)
- [x] Shell-integrated commands (`!git diff`, `!npm test` in slash commands)
- [x] Path-scoped rules with YAML frontmatter (api, testing, frontend)
- [x] Hooks in settings.json (auto-format, block-destructive, protect-secrets)
- [x] `/project:status` and `/project:fix` commands
- [x] Expanded registry (25-30 tools: Sentry, Vercel, Docker, SQLite, Chrome DevTools)
- [x] Improved TDD skill with subagent isolation pattern

### v1.4.0 ✅ — Advanced Patterns ([design doc](docs/design/v1.4-advanced-patterns.md))
- [x] Sprint contract pattern (`/project:sprint` — define acceptance criteria)
- [x] Multi-agent QA pipeline (`@qa-orchestrator` → `@linter` + `@e2e-tester`)
- [x] PostCompact hook for context re-injection
- [x] Context budget enforcement in compilation prompt
- [x] `kairn optimize --diff` — preview changes before writing
- [x] `kairn doctor` — validate environments against Claude Code spec

### v1.5.0 ✅ — Templates & Registry ([design doc](docs/design/v1.5-templates-registry.md))
- [x] Template gallery — pre-built environments (Next.js, API, Research, Content)
- [x] `kairn templates` — browse and activate templates
- [x] Registry management (`kairn registry list`, `kairn registry add`)
- [x] Community tool submissions
- [x] Hermes runtime adapter

### v1.6.0 ✅ — Interactive Compilation & CLI Polish ([design doc](docs/design/v1.6-interactive-compilation.md))
- [x] Clarification step before compilation (3-5 questions with suggested defaults)
- [x] `--quick` flag to skip clarifications
- [x] Branded CLI output (maroon/warm accent color palette)
- [x] Structured sections (header box, section dividers, key-value pairs)
- [x] Spinner during compilation (ora)
- [x] Branded error display
- [x] `--no-color` flag for piping/CI
- [x] Updated all commands with consistent visual design

### v1.7.0 ✅ — Boris Cherny Patterns & Verification ([design doc](docs/design/v1.7-boris-patterns.md))
- [x] Verification section in CLAUDE.md template (concrete verify commands per project)
- [x] Known Gotchas section in CLAUDE.md template (living memory of mistakes)
- [x] `/project:spec` command (interview-based spec creation before coding)
- [x] `/project:prove` command (verify implementation with tests/diffs/evidence)
- [x] `/project:grill` command (adversarial code review)
- [x] `/project:reset` command (clean restart with accumulated knowledge)
- [x] Statusline config in settings.json (branch + task count)
- [x] Debugging guidance in CLAUDE.md ("paste raw errors, use subagents")
- [x] Git workflow guidance ("small commits, conventional format")

### v1.8.0 ✅ — Secrets Management ([design doc](docs/design/v1.8-secrets-management.md))
- [x] Interactive API key collection after environment generation (prompted, masked input)
- [x] `.env` file generation with entered keys + empty placeholders for skipped
- [x] `.gitignore` auto-update to exclude `.env`
- [x] SessionStart hook to load `.env` into Claude Code via `CLAUDE_ENV_FILE`
- [x] `kairn keys` command (add/update keys for existing environments)
- [x] `kairn keys --show` (display which keys are set vs missing)
- [x] `--quick` flag skips key prompts (writes .env with empty placeholders)

### v1.9.0 ✅ — Autonomy Levels & Workflow Loops ([design doc](docs/design/v1.9-autonomy-levels.md))
- [x] Autonomy level selection during `kairn describe` (1-4)
- [x] **Level 1 (Guided):** `/project:tour`, SessionStart welcome, QUICKSTART.md, workflow reference in CLAUDE.md
- [x] **Level 2 (Assisted):** `/project:loop` (workflow-specific automated cycle), `@pm` agent
- [x] **Level 3 (Autonomous):** `/project:auto` (PM plans, loop executes in worktrees, PR delivery)
- [x] **Level 4 (Full Auto):** `/project:autopilot` (continuous execution with stop conditions)
- [x] Workflow-specific loops (code, research, content, bug-fix)
- [x] `@pm` agent (maintains roadmap, specs features, prioritizes, does NOT code)

### v1.10.0 ✅ — Expanded Provider & Model Support ([design doc](docs/design/v1.10-expanded-providers.md))
- [x] xAI/Grok provider (Grok 4.1 Fast, Grok 4.20 — 2M context, $0.20/M)
- [x] DeepSeek provider (V3.2 Chat/Reasoner — cheapest at $0.28/M)
- [x] Mistral provider (Large 3, Codestral, Small 4 — open-weight)
- [x] Groq provider (Llama 4, DeepSeek R1, Qwen 3 — free tier)
- [x] Custom endpoint ("Other" — any OpenAI-compatible URL, local Ollama/LM Studio)
- [x] Updated Anthropic models (Sonnet 4.6, Opus 4.6, Haiku 4.5)
- [x] Updated OpenAI models (GPT-4.1, GPT-4.1 mini, o4-mini, GPT-5 mini)
- [x] Updated Google models (Gemini 3 Flash, Gemini 3.1 Pro, Gemini 2.5 Flash/Pro)
- [x] Cheap model routing for clarification step (Haiku/nano/flash regardless of compilation model)

### v1.10.1 ✅ — Robust Compilation ([design doc](docs/design/v1.10.1-robust-compilation.md))
- [x] Multi-pass compilation pipeline (skeleton → harness content → deterministic settings)
- [x] Pass 1: Tool selection + project outline (small JSON, max_tokens: 2048)
- [x] Pass 2: CLAUDE.md + commands + rules + agents + docs (full content, max_tokens: 8192)
- [x] Pass 3: settings.json + .mcp.json generated deterministically from registry (no LLM)
- [x] Retry logic for Pass 2 with concise fallback mode
- [x] Split SYSTEM_PROMPT into focused SKELETON_PROMPT and HARNESS_PROMPT
- [x] Fix: complex prompts (biotech, k8s, ML, music) no longer crash with JSON truncation

### v1.11.0 ✅ — Claude Code Power Patterns ([design doc](docs/design/v1.11-claude-code-power-patterns.md))
- [x] `/project:develop` — full development pipeline orchestrating subagents for spec, plan, implement (TDD), verify, review, and automated doc updates. Replaces monolithic `/ship`.
- [x] Automated and disciplined documentation: `TODO.md` removed; `docs/SPRINT.md` for living spec/plan; `@doc-updater` agent for `DECISIONS.md` and `LEARNINGS.md`.
- [x] New agents: `@architect`, `@planner`, `@implementer`, `@fixer`, `@doc-updater` (orchestrated by `/develop`).
- [x] Integration of Claude Code power patterns: `/project:ultraplan`, `/project:security`, `/project:batch`, `/project:review`, `/project:compact` (now as building blocks for `/develop`).
- [x] Engineering Standards, Tool Usage Policy, Git Safety, Coordinator Precision, Deferred Tool Discovery principles embedded in CLAUDE.md.

### v1.12.0 ✅ — Compilation UX ([design doc](docs/design/v1.12-compilation-ux.md))
- [x] Phase-by-phase progress display (registry → Pass 1 → Pass 2 → Pass 3 with ✔/◐/⚠ indicators)
- [x] Live elapsed timer (updates every second during active pass)
- [x] Time estimate based on model tier and prompt complexity
- [x] Retry visibility (⚠ warning when Pass 2 retries in concise mode)
- [x] Final summary line ("Environment compiled in 37s")

### v1.13.0 ✅ — Environment Bootstrapping ([design doc](docs/design/v1.13-environment-bootstrapping.md))
- [x] "First Turn Protocol" section in every generated CLAUDE.md (agent self-orients before working)
- [x] `/project:bootstrap` command for Level 2+ (gather runtime, project files, git state in one shot)
- [x] SessionStart bootstrap hook for Level 3-4 (automatic environment snapshot injection)
- [x] Project-type-aware runtime checks (Node, Python, Rust, Go detected from CLAUDE.md tech stack)
- [x] `.env` key masking in bootstrap output (show `KEY=***`, never values)
- [x] Saves 2-5 wasted exploration turns per session

### v1.14.0 ✅ — Completion Verification ([design doc](docs/design/v1.14-completion-verification.md))
- [x] Completion Verification checklist injected into all orchestrating commands
- [x] Phase 7 "Completion Gate" added to `/project:develop`
- [x] `/project:loop` exit condition upgraded: tests passing + verification passing
- [x] `/project:auto` requires verification before PR creation
- [x] `/project:autopilot` includes verification in stop condition evaluation
- [x] Project-type-aware verify commands (test suite + lint/typecheck auto-detected)
- [x] Three-perspective check: test engineer, code reviewer, requesting user
- [x] "Completion Standards" principle in CLAUDE.md

---

## v2.x — Kairn Evolve (Automated Harness Optimization)

> Inspired by [Meta-Harness](https://yoonholee.com/meta-harness/) (Lee et al., Stanford IRIS Lab, 2026), [DSPy](https://github.com/stanfordnlp/dspy) (Khattab et al.), [OpenEvolve](https://github.com/algorithmicsuperintelligence/openevolve), and [TextGrad](https://github.com/zou-group/textgrad). Instead of just generating environments, Kairn evolves them — running agents on real tasks, logging full traces, and using causal reasoning to improve the harness iteratively.

Full design doc: [`docs/design/v2.0-kairn-evolve.md`](docs/design/v2.0-kairn-evolve.md)

### v2.0.0 ✅ — Task Definition & Trace Infrastructure
- [x] Eval template menu — 6 built-in templates (add-feature, fix-bug, refactor, test-writing, config-change, documentation)
- [x] Auto-generated evals — LLM reads `.claude/CLAUDE.md` + project structure, selects templates, generates 3-5 concrete project-specific tasks
- [x] `kairn evolve init` — scaffold evolution workspace (`.kairn-evolve/`), auto-generate `tasks.yaml`, interactive "add another eval?" flow
- [x] Baseline snapshot (`kairn evolve baseline`) — copy current `.claude/` as iteration 0
- [x] Task runner — execute agent on a single task, capture full trace to filesystem
- [x] Trace schema: `traces/{iteration}/{task_id}/` containing stdout, tool_calls.json, files_changed.json, score.json
- [x] Pass/fail scorer (default) + LLM-as-judge scorer (configurable) + rubric scorer
- [x] `kairn evolve run --task <id>` — run a single task against current environment

### v2.1.0 ✅ — The Evolution Loop
- [x] `kairn evolve run` — full evaluation (run all tasks, aggregate scores)
- [x] Proposer agent — reads trace filesystem, diagnoses failures, proposes harness mutations
- [x] Harness diff engine — apply proposed mutations to CLAUDE.md / commands / rules / agents
- [x] Iteration loop: evaluate → diagnose → mutate → re-evaluate
- [x] `kairn evolve run --iterations N` — control search budget (default: 5)
- [x] Iteration log: `iterations/{N}/` with mutation_diff.patch, scores.json, proposer_reasoning.md
- [x] Rollback on regression (score drops → revert to previous best)

### v2.2.0 ✅ — Diagnosis & Reporting
- [x] Counterfactual diagnosis ("this CLAUDE.md change helped task A but hurt task B — why?")
- [x] Per-task trace diffing (what changed between iteration N and N+1 for the same task?)
- [x] `kairn evolve report` — human-readable Markdown summary of the evolution run
- [x] `kairn evolve report --json` — machine-readable for CI/pipelines
- [x] Evolution leaderboard (table of iterations × tasks × scores)
- [x] `kairn evolve diff <iter1> <iter2>` — show harness changes between iterations

### v2.2.1 ✅ SHIPPED
> Mutations were additive-only; MCP configuration excluded from scope; proposer biased toward growth rather than optimization.

- [x] Add `delete_section` and `delete_file` mutation actions to types and mutator
- [x] Include `.mcp.json` in harness scope (baseline snapshot, runner deployment, proposer reading)
- [x] Rebalance proposer prompt: consider both additions AND removals, list all mutation actions
- [x] Update proposer JSON parser to accept `delete_section` and `delete_file` actions
- [x] Tests: delete mutations, MCP snapshot, balanced proposer

### v2.2.2 ✅ SHIPPED
> **#1 blocker fixed:** Proposer was returning English prose instead of JSON. Added JSON mode to LLM call with fallback parsing.

- [x] Add `jsonMode` to `callLLM()` with assistant prefill (Anthropic) and `response_format` (OpenAI)
- [x] Robust JSON extraction in parser — handle prose-wrapped JSON (first `{` to last `}`)
- [x] Wire `jsonMode: true` in proposer LLM call
- [x] Tests: JSON extraction from prose, assistant prefill behavior

### v2.2.4 ✅ SHIPPED (was v2.2.3 plan)
> v2.2.1 shipped the mutation types and v2.2.2 fixed proposer JSON. This version proves the full loop works: mutations actually apply, scores actually move, evolved > static is demonstrable.

- [x] `kairn evolve apply [--iter N]` — copy best harness to `.claude/` with diff preview (highest-friction UX gap)
- [x] **Integration test:** full loop with deterministic mocks proves score improves, rollback works, errors recover
- [x] Variance controls: `--runs N` runs each task N times, reports mean ± stddev per task
- [ ] **Proof artifact:** before/after comparison showing evolved harness outperforms static on a held-out task (deferred to v2.3.0)

### v2.2.5 ✅ SHIPPED
> Parallel task evaluation — the single biggest wall-clock speedup for evolution runs.

- [x] Parallel task evaluation: `--parallel N` runs up to N tasks concurrently (promise-based, native)
- [x] `runWithConcurrency` utility with configurable concurrency limit
- [x] Backward compatible: `--parallel 1` (default) = sequential, identical to prior behavior

### v2.2.6 ✅ SHIPPED
> Bug fix: Anthropic API rejects assistant prefill on newer models.

- [x] Remove assistant prefill for Anthropic jsonMode — rely on prompt instructions + JSON extraction fallback

### v2.2.7 ✅ SHIPPED
> Harness-sensitive evals + adaptive eval pruning.

- [x] Adaptive eval pruning: skip tasks above threshold on middle iterations, run all on first/last
- [x] Harness-sensitive tasks.yaml: 5 evals testing harness quality (verification workflow, convention adherence, git discipline, slash commands, architecture mandate)
- [x] Blind proposer: stripped eval rubrics from proposer context to prevent gaming
- [x] Anti-gaming constraints in proposer system prompt

### v2.2.8 ✅ SHIPPED
> ML-inspired optimization controls for the evolution loop.

- [x] `maxMutationsPerIteration` (default: 3) — cap mutations per step, prevents catastrophic regressions
- [x] Loss-weighted proposer focus — traces sorted worst-first, proposer focuses on what's broken
- [x] `pruneThreshold` (default: 95) — configurable threshold for adaptive pruning
- [x] `maxTaskDrop` (default: 20) — per-task regression guard, rolls back if any task drops too much

### v2.2.10 ✅ SHIPPED
> Rollback noise trap fix.

- [x] After rollback, proposer proposes NEW mutations on best harness instead of re-evaluating unchanged harness
- [x] `.mcp.json` included in `evolve apply` output (harness scope fix)

### v2.3.0 ✅ SHIPPED
> The evolution loop is only as good as its eval signal. Before adding features, make measurement trustworthy.

**Eval Quality (the bottleneck):**
- [ ] Failure taxonomy: was it the harness? the task? the model? the repo state? Log classification per task failure *(deferred)*
- [ ] Canonical benchmark corpus: small set of stable, version-controlled tasks alongside project-specific evals *(deferred)*
- [ ] Confidence intervals: report mean ± stddev across N runs per task in `kairn evolve report` *(deferred)*
- [ ] Custom scoring functions (user-defined scoring scripts in `.kairn-evolve/`) *(deferred)*

**Auth & Cost:**
- [ ] **Claude Code subscription auth (experimental)** *(deferred — OAuth approach needs revisiting)*
- [x] ~~Prompt caching integration~~ — shipped in v2.8.0
- [ ] Cost tracking per iteration (total tokens, USD cost, wall time) in report *(deferred)*

**Iteration Speed:**
- [x] ~~Parallel task evaluation~~ — shipped in v2.2.5

**DX Quick Wins:**
- [ ] Fix hardcoded CLI version → read from package.json dynamically *(deferred)*
- [ ] Capture tool calls & MCP usage from runner output → tool_calls.json *(deferred)*
- [ ] Harness utilization metrics (which tools/agents/rules were used vs available) *(deferred)*

### v2.4.0 — Intelligent Evolution (RL-inspired) [ABSORBED]
> Most items absorbed into later versions. Kept for historical reference.

**Principal Proposer (meta-learner):**
- [x] ~~Principal-style synthesis~~ — absorbed into v2.6.0 PBT Meta-Principal and v2.13.0 architect proposer

**Mini-batch eval sampling (stochastic gradient):**
- [x] ~~Mini-batch sampling~~ — shipped in v2.5.2 (eval_sample_size) and v2.6.0 (Thompson sampling)

**Exploration/exploitation schedule:**
- [x] ~~Explore/exploit schedule~~ — shipped in v2.13.0 (configurable schedule: explore-exploit, constant, adaptive)

**Experience replay (cross-run learning):**
- [x] ~~Cross-run learning~~ — shipped in v2.13.0 (knowledge base at `~/.kairn/knowledge/`)

### v2.5.0 ✅ — Intent-Aware Harnesses (Two-Tier Evolving Router)
> "No commands to memorize, just describe what you want" — but project-specific, compiled from the codebase, and self-improving. Inspired by OMC's keyword detection but uses Claude Code's native prompt hooks for semantic fallback.

Full design doc: [`docs/design/v2.5-intent-routing.md`](docs/design/v2.5-intent-routing.md)

**Generation pipeline (kairn describe):**
- [x] Intent pattern compilation: each generated command → 1-3 regex patterns (name, synonyms, framework verbs)
- [x] Generate `.claude/hooks/intent-router.mjs` — Tier 1 regex engine with project-specific patterns
- [x] Generate Tier 2 prompt template — compiled workflow + agent manifest baked into `settings.json` prompt hook
- [x] Generate `.claude/hooks/intent-learner.mjs` — background pattern promotion (Tier 2 → Tier 1)
- [x] Write `UserPromptSubmit` + `SessionStart` hooks into `.claude/settings.json`
- [x] Extend `EnvironmentSpec.harness` with `hooks`, `intent_patterns`, `intent_prompt_template`

**Evolution pipeline (kairn evolve):**
- [x] Proposer reads intent patterns + Tier 2 prompt as harness context
- [x] New mutation targets: `add_intent_pattern`, `modify_intent_prompt`
- [x] Harness snapshot/apply includes `.claude/hooks/` directory
- [x] New eval template: `intent-routing` — test that NL prompts route to correct commands

**Self-learning (background, no CLI command):**
- [x] Tier 2 routings logged to `.claude/hooks/intent-log.jsonl`
- [x] `intent-learner.mjs` runs on `SessionStart`: promotes recurring Tier 2 patterns to Tier 1 regexes
- [x] Audit trail: `.claude/hooks/intent-promotions.jsonl`
- [x] Data flywheel: Run 1 (40% regex) → Run 10 (90% regex) — harness learns user vocabulary

### v2.5.2 ✅ SHIPPED — Evolve Permissions Fix & Expanded Eval Menu
> The evolve loop's signal is corrupted by permission prompts blocking agents in `--print` mode, and the eval menu is too small (5 tasks) for diverse proposer signal. Fix both.

- [x] `--dangerously-skip-permissions` in `spawnClaude()` — eval worktrees are disposable, permission system is a confound
- [x] Expanded eval menu: 5 → 12 tasks (7 new medium-weight harness-sensitivity probes)
- [x] Mini-batch sampling enabled: `eval_sample_size: 5` — each middle iteration samples 5 of 12 tasks
- [x] New eval dimensions: fs.promises convention, chalk color mapping, error boundary pattern, security path validation, conventional commit format, @inquirer/prompts check, env\_ ID prefix
- [x] Clean baseline reset (remove permission-workaround mutations from prior iterations)

### v2.6.0 ✅ SHIPPED — Population-Based Harness Evolution
> A single sequential trajectory wastes wall-clock time on dead ends and overfits to its task sample. PBT runs N independent trajectories with different task subsets, a Meta-Principal synthesizes the best harness, Thompson Sampling drives uncertainty-aware task selection, and KL regularization prevents harness bloat.

Full plan: [`PLAN-v2.6.0.md`](PLAN-v2.6.0.md)

**Thompson Sampling (uncertainty-driven task selection):**
- [x] Beta distribution per task (`alpha`/`beta` params) — uncertain tasks sampled more often
- [x] Replaces uniform random mini-batch sampling in `loop.ts`
- [x] Beliefs persist across iterations in `task-beliefs.json`
- [x] `--sampling thompson|uniform` CLI flag (Thompson is default)

**KL Regularization (complexity penalty):**
- [x] `measureComplexity()` — counts lines, files, sections, rules across harness
- [x] `computeComplexityCost()` — weighted diff from baseline (normalized 0-1)
- [x] `effective_score = raw_score - λ * complexityCost * 100`
- [x] `--kl-lambda` CLI flag (default: 0.1, 0 = disabled)
- [x] Prevents CLAUDE.md bloat — proposer must earn every addition

**Population-Based Training (parallel evolution branches):**
- [x] `kairn evolve pbt` — spawn N parallel evolution trajectories (default: 3)
- [x] Each branch: independent workspace, unique RNG seed, own Thompson beliefs
- [x] Branches run concurrently — similar wall time to single run, 3x exploration
- [x] Meta-Principal reads ALL branch results, cherry-picks best mutations, synthesizes final harness
- [x] Synthesis evaluated against full task suite — must beat best individual branch
- [x] `kairn evolve apply --pbt` to deploy the winning harness

### v2.7.0 ✅ SHIPPED — Structured Harness IR ([design doc](docs/design/v2.7-harness-ir.md))
> Raw Markdown mutation will corrupt formatting, accumulate contradictions, and break as files grow. A structured intermediate representation makes mutations composable, diffing meaningful, and format migration tractable.

Full plan: [`PLAN-v2.7.0.md`](PLAN-v2.7.0.md)

- [x] **Harness IR type model** — typed data model for CLAUDE.md sections, commands, rules, agents, skills, docs, hooks, settings, MCP servers, intents
- [x] **Parser** — `.claude/` directory → HarnessIR (CLAUDE.md section splitting, YAML frontmatter, settings.json, .mcp.json)
- [x] **Renderer** — HarnessIR → `.claude/` files (deterministic, lossless, round-trip tested)
- [x] **Round-trip test** — parse→render→parse preserves all content on real and synthetic harnesses
- [x] **IR mutations** — 17 typed mutation operations (sections, commands, rules, agents, MCP, settings) with immutable application and pre-condition validation
- [x] **Semantic diff engine** — compares IR trees by node ID/name, produces human-readable diffs with +/-/~/↕ markers
- [x] **Legacy translation layer** — bridges text-based proposer Mutations to typed IRMutations with raw_text fallback
- [x] **Evolution loop integration** — mutator uses IR pipeline internally (parse→translate→apply→render), copy-first/render-selectively preserves untouched files, IR-aware complexity measurement for KL regularization

### v2.8.0 ✅ SHIPPED — Evolution Quality
> Hybrid scoring, Anthropic prompt caching, proposer model optimization, and targeted re-evaluation.

- [x] **Hybrid scoring** — deterministic rubric criteria alongside LLM-as-judge (weighted blend, configurable)
- [x] **Anthropic prompt caching** for system prompts (~85% token savings on repeated proposer/scorer calls)
- [x] **Default proposer model → Sonnet** — comparable quality at ~5x lower cost than Opus
- [x] **Targeted re-evaluation** — after mutation, re-run only tasks whose scores are likely affected (saves ~40% eval cost)

### v2.9.0 ✅ SHIPPED — Harness Quality: Anthropic Patterns ([plan](PLAN-v2.9.0.md))
> Comparative analysis against [Anthropic's official harness design guidance](https://www.anthropic.com/engineering/harness-design-long-running-apps), [Everything Claude Code](https://github.com/affaan-m/everything-claude-code) (151 skills, 102 security rules), and [Oh-My-ClaudeCode](https://github.com/yeachan-heo/oh-my-claudecode) (smart model routing) revealed 6 gaps in generated harness quality.

- [x] **Sprint contracts** — @architect outputs acceptance criteria, @verifier validates per-criterion before coding
- [x] **Smart model routing** — agents include tiered routing (Haiku/Sonnet/Opus) based on task complexity, with `modelRouting` IR field
- [x] **Context reset protocol** — alternative to PostCompact for long sessions (full reset + handoff artifact)
- [x] **Memory persistence hooks** — SessionStart/End save/load `.claude/memory.json` across sessions
- [x] **Expanded security rules** — PreToolUse patterns from 5 to 20+ (credential leaks, injection, destructive ops, network)
- [x] **Pruning policy** — principle: harness complexity should decrease as models improve

### v2.10.0 ✅ SHIPPED — Persistent Execution Loop ([design doc](docs/design/v2.10-persistent-execution.md))
> Inspired by OMC's Ralph loop. The single biggest gap between Kairn-generated harnesses and production agent workflows: persistence. Today, `/project:develop` runs once linearly. If it fails, the user restarts manually. A persistence loop keeps working until all acceptance criteria pass, tracks progress across retries, and auto-routes complex tasks through the loop.

**Core: `/project:persist` command (generated in every harness)**
- [x] PRD-driven persistence loop: reads acceptance criteria from `docs/SPRINT.md`, works story-by-story until all pass
- [x] Structured progress tracking in `.claude/progress.json` — what's done, what failed, what's next
- [x] Auto-retry on verification failure — if a criterion fails, loop back to fix (max 3 retries per criterion)
- [x] Reviewer gate before completion — delegates to `@grill` or `@reviewer` agent before marking done
- [x] Session-persistent via `memory.json` — if the session ends mid-loop, next session resumes from `.claude/progress.json`

**Auto-routing hook: detect tasks that benefit from persistence**
- [x] `UserPromptSubmit` hook analyzes incoming prompts for complexity signals:
  - Multi-step tasks ("implement X then Y then Z")
  - Feature requests ("add authentication with OAuth")
  - Refactors ("migrate from X to Y")
  - Bug fixes with reproduction steps ("when X happens, Y breaks")
- [x] Routes matching prompts through `/project:persist` instead of one-shot execution
- [x] Simple tasks (questions, single file edits, lookups) pass through normally
- [x] Configurable: `persistence_routing: auto | manual | off` in harness config

**What this extracts from OMC Ralph (distilled, not copied):**
- [x] Story-by-story acceptance tracking (OMC's `prd.json` → our `progress.json`)
- [x] Retry-until-done loop (OMC's iteration counter → our criterion-level retry)
- [x] Reviewer verification gate (OMC's architect pass → our `@grill` agent)
- [x] Session persistence (OMC's state files → our `memory.json` + `progress.json`)
- [x] NOT copied: OMC's 150 skills, ultrawork parallelism, tmux workers, plugin system — those are OMC-specific complexity that most projects don't need

**Implementation in HARNESS_PROMPT:**
- [x] `/project:persist` command template added to "For Code Projects, Additionally Include"
- [x] `UserPromptSubmit` routing hook template added to hooks.md
- [x] `progress.json` schema defined (stories, criteria, status, retries, timestamps)
- [x] Evolve eval template: `persistence-completion` — test that the loop actually completes multi-step tasks

### v2.11.0 — Multi-Agent Compilation Pipeline ([design doc](docs/design/v2.11-multi-agent-compilation.md))
> The monolithic Pass 2 LLM call produces a ~16K token JSON blob — hitting truncation limits and capping harness quality. Decompose compilation into specialist agents that each produce typed HarnessIR nodes, orchestrated by an LLM planner. Unifies compilation and evolution around the same IR representation. Scales to swarm-sized environments (100+ agents).

**Architecture: Orchestrator → DAG of Specialists → Linker → HarnessIR**

**@orchestrator (LLM planner):**
- [x] Reads skeleton + intent, emits `CompilationPlan` (phases, agents, items, dependencies, token budgets)
- [x] Decides command/agent/rule granularity based on project complexity
- [x] Partitions large compilations into batches (scales to 200+ agents for swarm use cases)

**Specialist agents (parallel, typed output):**
- [x] `@sections-writer` → `Section[]` (CLAUDE.md content following mandatory template)
- [x] `@command-writer` → `CommandNode[]` (`!` shell integration, `$ARGUMENTS`, orchestration prompts)
- [x] `@agent-writer` → `AgentNode[]` (YAML frontmatter, `modelRouting`, persona design)
- [x] `@rule-writer` → `RuleNode[]` (path-scoped YAML frontmatter, constraint format)
- [x] `@doc-writer` → `DocNode[]` (DECISIONS.md, LEARNINGS.md, SPRINT.md templates)
- [x] `@skill-writer` → `SkillNode[]` (TDD skill, research skill, etc.)

**Cross-reference validation:**
- [x] `@linker` validates `@agent` mentions in commands, command references in agents, rule scope coverage
- [x] Patches broken cross-references before assembly

**Batch execution engine:**
- [x] `executePlan()` with topological phase ordering and concurrency control
- [x] Reuses `runWithConcurrency` pattern from evolve runner
- [x] Configurable concurrency: 3 (API key), 2 (OAuth)

**HarnessIR as compilation output:**
- [x] `compile()` produces `HarnessIR` directly (not flat JSON strings)
- [x] `EnvironmentSpec.harness` updated to reference `HarnessIR`
- [x] Adapters (claude-code, hermes-agent) consume `HarnessIR` via renderer
- [x] Evolve loop receives `HarnessIR` directly from compilation (no re-parse)

**Truncation detection:**
- [x] `callLLM()` checks `stop_reason === 'max_tokens'` and throws `TruncationError`
- [x] Per-agent retry with increased budget or batch splitting

**UX: Multi-phase progress display:**
- [x] Phase-by-phase progress (Pass 2 plan → Pass 3a parallel → Pass 3b parallel → Pass 3c linker)
- [x] Per-agent retry visibility (`⚠ @agent-writer truncated, retrying...`)
- [ ] Individual agent failure isolation (one agent fails ≠ whole compilation fails) *(deferred — low priority, current retry logic sufficient)*

### v2.12.0 — Generation Quality ([design doc](docs/design/v2.12-generation-quality.md), [plan](PLAN-v2.12.0.md))
> First real-world test (inferix — Python/Docker ML project) exposed 6 critical generation flaws. CLAUDE.md hallucinated project structure, intent router false-positives on common English, hardcoded Node.js permissions for Python projects, empty scaffold docs waste context, .env injection contradicts deny rules. Rules and safety hooks praised as strong.

**describe → optimize gating:**
- [x] Detect existing repos in `kairn describe` (package.json, requirements.txt, Dockerfile, src/, >5 files)
- [x] Show redirect prompt: "This looks like an existing project. Use `kairn optimize` for better results."
- [x] Programmatic redirect to `optimizeCommand` on confirm

**Intent routing overhaul:**
- [x] Remove `intent-router.mjs`, `intent-learner.mjs`, intent-log/promotions files from generation
- [x] Remove `src/intent/` directory (patterns.ts, prompt-template.ts, router-template.ts, learner-template.ts)
- [x] Add "Available Commands" section to CLAUDE.md via `renderClaudeMd()` (portable, works with any agent)
- [x] Optional strict prompt hook in `settings.json` for Claude Code (autonomy level 2+ only)
- [x] Remove UserPromptSubmit regex hook and SessionStart learner hook from `buildSettings()`

**Tech-stack-aware permissions:**
- [x] Derive `settings.json` allow-list from skeleton tech_stack (Python→pytest/pip, Go→go, Rust→cargo, Docker→docker)
- [x] Remove hardcoded `Bash(npm run *)`, `Bash(npx *)` — only add when Node.js detected
- [x] Add PostToolUse formatter hook for Python (ruff/black) when Python detected

**Living docs (not empty scaffolds):**
- [x] Filter empty placeholder docs in adapter — skip writing if content matches template filler
- [x] Add PostToolUse prompt hook nudging doc updates after meaningful Write/Edit operations
- [x] Update `@doc-writer` prompt to produce substantive content or nothing

**Compilation UX improvements:**
- [x] Animated spinner frames in `createProgressRenderer()` (braille dots or ora-style)
- [x] Cumulative elapsed timer alongside per-phase timer
- [x] Richer phase descriptions with agent names ("Writing rules: security, continuity...")

**Honest .env handling:**
- [x] Remove SessionStart .env injection hook from all generated settings.json
- [x] Make `Read(./.env)` deny conditional: only deny when project doesn't use env vars
- [x] Document expected env vars in CLAUDE.md when project needs them

### v2.13.0 — Principal-as-Architect (Creative Evolution) ([design doc](docs/design/v2.13-principal-architect.md))
> The proposer is gradient descent with a tiny learning rate — it fixes what's broken but can't imagine what's possible. The Principal-as-Architect adds an exploration mode that proposes structural improvements, not just reactive patches. Combined with a cross-repo research protocol, this closes the feedback loop between evolve discoveries and generation templates.

**Architect Proposer (exploration mode):**
- [x] New system prompt: "You are an agent environment ARCHITECT. Reimagine the harness structure, not just patch failures."
- [x] Higher mutation budget (5-10 per call vs. proposer's 3)
- [x] Runs every Nth iteration (configurable, default: every 5th) — interleaved with reactive proposer
- [x] Separate scoring: architect proposals evaluated on full task suite before acceptance
- [x] Rollback protection: architect proposals held in staging until they prove ≥ current best

**Cross-repo research protocol:**
- [x] `kairn evolve research` command — clone N GitHub repos, run evolve on each, catalog convergent mutations
- [x] Convergence analyzer: identify mutations that appear in ≥M/N repos (stable patterns)
- [x] Research report: which patterns improve scores universally vs. project-specifically
- [x] Feed convergent patterns back into generation templates (closing the loop)

**Cross-pollination knowledge base:**
- [x] Persist high-scoring patterns across evolve runs in `~/.kairn/knowledge/`
- [x] Proposer + architect read knowledge base before proposing (experience replay, cross-repo)
- [x] Patterns tagged by project type (Python, Node, Docker, monorepo, etc.)

**Exploration/exploitation schedule:**
- [x] Early iterations: architect mode (high mutation budget, bold structural changes)
- [x] Middle iterations: reactive proposer (targeted fixes, trace-grounded)
- [x] Late iterations: conservative refinement (1-2 mutations, full eval sweep)
- [x] Configurable schedule: `--schedule explore-exploit` or `--schedule constant`

### v2.14.0 — Semantic Codebase Analyzer ([plan](PLAN-v2.14.0.md))
> The scanner extracts a project's bill of materials (name, deps, scripts) but not its meaning (what the code does, how modules interact, the domain). This is why generated harnesses are generic — the LLM agents never see source code. v2.14.0 adds a semantic analysis stage between scan and compile that reads actual source files, extracts domain knowledge via LLM, and produces a structured `ProjectAnalysis` that enriches the compilation intent. Uses [Repomix](https://github.com/yamadashy/repomix) for intelligent file sampling, language-specific heuristics for prioritization, and fails hard if analysis cannot be completed (no hallucinated harnesses).

**Codebase Analyzer (`kairn analyze`):**
- [x] `analyzeProject()` function — new stage between `scanProject()` and `compile()`
- [x] Repomix integration — use as library for intelligent file packing with token budget (5000 tokens)
- [x] Language-specific sampling strategies (Python, TypeScript, Go, Rust) — entry points, domain patterns, exclude patterns
- [x] Always-include files: README.md, README.rst, config files (*.toml, *.yaml, *.yml)
- [x] LLM semantic analysis — produces structured `ProjectAnalysis` JSON from sampled code
- [x] `kairn analyze` standalone command — run analysis and display results without compiling
- [x] `kairn analyze --refresh` — force re-analysis, bypassing cache

**ProjectAnalysis schema (structured JSON output):**
- [x] `purpose` — one-line project goal (specific: "Bayesian posterior estimation for PK models", not "data processing")
- [x] `domain` — category (e.g., "simulation-based inference", "web API", "CLI tool")
- [x] `key_modules[]` — name, path, description, responsibilities for each major component
- [x] `workflows[]` — name, description, trigger, steps for main user/system flows
- [x] `architecture_style` — how the project is structured (monolithic, microservice, plugin, etc.)
- [x] `deployment_model` — how it runs (serverless, containerized, CLI, etc.)
- [x] `dataflow[]` — from/to/data edges showing how data moves between modules
- [x] `config_keys[]` — name/purpose for environment variables and configuration

**Analysis caching:**
- [x] Cache `ProjectAnalysis` to `.kairn-analysis.json` in project root
- [x] Cache includes content hash of sampled files — invalidates on source changes
- [x] `kairn optimize` reads cache if valid, skips re-analysis
- [x] `kairn analyze --refresh` forces re-analysis regardless of cache

**Pipeline integration:**
- [x] `buildOptimizeIntent()` accepts `ProjectAnalysis` alongside `ProjectProfile`
- [x] Enriched intent includes: purpose, domain, key modules with responsibilities, workflows with steps, dataflow edges
- [x] All compilation agents (sections-writer, command-writer, agent-writer, etc.) receive domain-specific context
- [x] Fail hard if analyzer cannot produce valid analysis — no fallback to metadata-only (prevents generic output)

**Error handling (fail-hard policy):**
- [x] `AnalysisError` class with structured error types (no_entry_point, empty_sample, llm_parse_failure)
- [x] If no source files match sampling heuristics → throw with actionable message
- [x] If LLM returns unparseable analysis → throw, do not proceed to compile
- [x] `kairn optimize` shows clear error: "Cannot analyze codebase. Run `kairn analyze` to diagnose."

### v2.15.0 — Context Enrichment & IR Persistence ([plan](PLAN-v2.15.0.md))
> The analyzer extracts 60K tokens of source code, compresses it to ~1K of ProjectAnalysis, and then every downstream agent only sees the summary. The raw evidence is discarded. Meanwhile, the evolve loop's proposer and architect operate blind — they can read the harness files and traces but have never seen the actual project source code or the structured IR. This version plumbs existing data through to every agent that needs it, and adds SWE-bench-style evaluations to the evolve loop.

**Context enrichment for compilation agents:**
- [x] Cache packed source code to `.kairn/packed-source.txt` alongside `analysis.json`
- [x] `buildOptimizeIntent()` accepts `packedSource` parameter — raw code included as evidence section
- [x] Compilation agents (sections-writer, command-writer, agent-writer, etc.) receive ~62K tokens of context (vs. ~2K today)
- [x] ProjectAnalysis acts as structured table of contents; packed source is the raw evidence

**Context enrichment for evolve proposers:**
- [x] `buildProposerUserMessage()` accepts optional `projectContext` (ProjectAnalysis + key source files + HarnessIR)
- [x] `buildArchitectUserMessage()` accepts same `projectContext`
- [x] ProjectAnalysis (~1K tokens) always included when available — zero-cost, high signal
- [x] Key source files (~10K tokens) included for evolve proposers — entry points + domain files subset
- [x] HarnessIR structure summary included — semantic map of sections, commands, rules, agents, MCP servers

**HarnessIR persistence:**
- [x] Serialize IR to `iterations/{N}/harness-ir.json` after every mutation application in the evolve loop
- [x] Persist IR to `.kairn/harness-ir.json` after initial compilation
- [x] IR available for proposer context, cross-iteration structural diffing, and multi-platform rendering (v3.0 adapter thesis)
- [x] `kairn analyze --ir` flag to display the current harness IR structure

**SWE-bench-style evaluations for the evolve loop:**
- [x] New eval template: `real-bug-fix` — apply a known bug, task the agent with fixing it from the issue description alone
- [x] New eval template: `real-feature-add` — add a small, well-defined feature with acceptance criteria
- [x] New eval template: `codebase-question` — ask the agent a factual question about the codebase that requires reading source code
- [x] Eval task generator reads `ProjectAnalysis` to produce domain-specific tasks (not generic harness-sensitivity probes)
- [x] Mixed eval suite: 50% harness-sensitivity probes (existing), 50% SWE-bench-style substantive tasks (new)
- [x] Score breakdown in `kairn evolve report`: harness adherence score vs. substantive task score

### v2.16.0 — Multi-Language Monorepo Sampling ([plan](PLAN-v2.16.0.md))
> The analyzer assumes one language per project. Monorepos with mixed languages (Python API + TypeScript frontend, Go services + JS dashboard) fail with "No sampling strategy for language: unknown" or silently ignore half the codebase. This version makes the entire sampling pipeline language-plural.

**Multi-language detection:**
- [x] `detectLanguageLocations()` returns all languages found at root and in immediate subdirectories
- [x] `ProjectProfile.languages: string[]` added alongside existing `language` (derived as `languages[0]`)
- [x] Subdirectory-level detection with frequency-based ordering

**Strategy merging:**
- [x] `mergeStrategies()` combines entry points, domain patterns, config patterns, and exclude patterns from all detected languages
- [x] Single-language projects produce a 1-element merge (identical to current behavior)
- [x] `analyzeProject()` resolves each language's strategy independently, then merges

**Monorepo-aware scoping:**
- [x] Domain patterns scoped to the subdirectory where each language was detected
- [x] Entry points scoped to their subdirectory (e.g., `main.py` → `api/main.py`)
- [x] Proportional priority hints based on language frequency (more subdirs → higher within-tier priority)

**Downstream compatibility:**
- [x] All callers updated from `profile.language` to `profile.languages` where appropriate
- [x] LLM prompt: "Analyze this Python/TypeScript project:" (joined language names)
- [x] No changes to ProjectAnalysis, HarnessIR, or RepomixResult schemas

### v2.17.0 — Polish & Integration
- [ ] `kairn evolve watch` — live dashboard during evolution (progress, scores, current mutation)
- [ ] Integration with `kairn describe` ("generate, then auto-evolve for 3 iterations")
- [ ] Integration with `kairn optimize` ("audit, then evolve the fixes")
- [ ] Template evolution (evolve a template against its canonical tasks)
- [ ] Export evolved environment as a new Kairn template
- [ ] CI/CD integration guide (run `kairn evolve` in GitHub Actions)
- [ ] Multi-objective scoring (correctness × efficiency × cost) with weighted aggregation

---

## Future Directions (Aspirational)

> These are directional ideas, not committed milestones. They depend on v2.x proving its thesis (evolved > static with rigor) and on finding a monetization trigger.

### Broad Harness Scope (v2.x → v3.x evolution)
The "harness" is bigger than `.claude/`. Today Kairn manages instructions and MCP configs. The full harness includes everything that shapes agent behavior:

**Current scope (v2.x):**
- `.claude/` — instructions, commands, rules, agents, settings.json
- `.mcp.json` — MCP server configurations

**Near-term expansion (v2.6+):**
- `.claude/plugins/` — Claude Code plugin configs
- Tool API key connections (`.env` with Sentry, Vercel, etc. keys)
- The proposer should be able to suggest "add Sentry MCP server" as a mutation

**Runtime-agnostic scope (v3.x / Hermes / OpenClaw):**
- Runtime-specific configs (`.hermes/config.yaml`, OpenClaw equivalents)
- API-authenticated external tool connections (not just local MCP)
- Plugin/extension configs per runtime
- The evolution loop operates on a runtime-agnostic harness IR, adapters write runtime-specific files

### Paid Tool Connections & Micropayments
When the proposer discovers that adding an external tool (Sentry, Datadog, a paid MCP server) would improve task scores, the user needs a way to connect and pay:
- **BYOK (Bring Your Own Key):** User provides API keys for tools the proposer suggests — current model, works today
- **Stripe MPP / x402 micropayments:** "This mutation adds Sentry monitoring. Connect for $0.02/query?" — proposer-initiated tool acquisition with per-use billing
- **Tool marketplace with metered billing:** Browse, connect, and pay for tool access within Kairn — the evolution loop becomes a discovery mechanism for useful tools

### Harness Generator Quality
- Upgrade agent template quality (learn from OMC's agent design patterns: role scoping, `disallowedTools`, `<Why_This_Matters>`, model tiering)
- Generate per-environment **WORKFLOWS.md** walkthrough (context-aware, regenerated after evolve)

### Extended Marketplace Integration
- Plugin search: Claude Code plugin marketplaces (anthropics, omc, openai-codex) alongside MCP server directories (Smithery, mcp.run, glama.ai)
- Agent template library: parameterized by project type, proposer can suggest additions during evolution

### Hosted Platform
- Free hosted compilation endpoint (requires: auth, multi-tenancy, trace privacy, abuse prevention, uptime)
- Web dashboard, template marketplace
- Payments integration (Stripe MPP, BYOK, x402)

### Learning System
- Automated tool discovery (GitHub, npm, community)
- Usage-based quality scoring
- Cross-project evolution data flywheel

---

## Principles

1. **Minimal over complete.** Fewer, well-chosen tools beat many generic ones.
2. **Workflow-specific over generic.** Every generated file relates to the actual task.
3. **Local-first.** Everything works offline. Hosted features are optional.
4. **Transparent.** Users can inspect every generated file.
5. **Security by default.** Every environment includes deny rules and security guidance.
6. **Self-improving.** Environments should get better with use, not just at generation time.
7. **Prove it.** Evolved harnesses must demonstrably outperform static ones. Claims without measurement rigor are noise.
8. **Prune what's no longer load-bearing.** Every harness section assumes a model limitation. When models improve, audit and remove scaffolding that the model handles natively. Harness complexity should decrease over time, not only grow.
