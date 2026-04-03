# Changelog

All notable changes to Kairn will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.12.0] — 2026-04-03

### Added
- **Existing-repo detection in `describe`** — detects project config files (package.json, pyproject.toml, Cargo.toml, etc.) and source directories, offers redirect to `kairn optimize` for better results on existing codebases
- **"Available Commands" section in CLAUDE.md** — generated environments now include a portable command reference section listing all `/project:*` commands with descriptions. Replaces regex-based intent routing with natural language instructions
- **Tech-stack-aware permissions** — `settings.json` allow-list derived from detected tech stack: Python (pytest, pip, uv), Rust (cargo), Go (go), Ruby (bundle, rake), Docker (docker, docker compose). Node.js permissions only added when JS/TS detected
- **Python formatter hook** — ruff format PostToolUse hook added for Python projects (alongside existing prettier for JS/TS)
- **Living docs with update hooks** — PostToolUse prompt hook nudges doc updates after meaningful Write/Edit operations. Placeholder-only docs (empty tables, filler text) are filtered out before writing
- **Environment variable documentation** — CLAUDE.md includes an "Environment Variables" section listing expected vars when tools require API keys
- **Animated compilation progress** — braille dot spinner (10 frames at 100ms), cumulative elapsed timer, and richer phase descriptions with agent names

### Changed
- `.env` deny rule is now conditional — only applied when project doesn't use env vars. Removes the security contradiction where .env was both injected and denied
- `buildSettings()` exported for testability
- `BatchProgress` interface extended with `detail` field for agent names

### Removed
- **Intent routing infrastructure** — deleted `src/intent/` directory (patterns.ts, router-template.ts, learner-template.ts, prompt-template.ts, types.ts) and all 5 test files. Regex-based routing on common English words ("test", "run", "help") caused persistent false positives
- **Intent hook generation** — `intent-router.mjs`, `intent-learner.mjs`, `intent-log.jsonl` no longer generated in `.claude/hooks/`
- **SessionStart .env injection hook** — removed `ENV_LOADER_HOOK` that contradicted the `Read(./.env)` deny rule

---

## [2.11.1] — 2026-04-02

### Changed
- **README restructured** — thesis-first format replacing documentation-order layout. New "What's Under the Hood" section surfaces PBT, Thompson sampling, Harness IR, multi-agent compilation, hybrid scoring, and persistent execution loops with real technical explanations. Sharper competitive positioning vs DSPy, OpenEvolve, and OMC. New Vision section on fleet-scale harness optimization. Examples condensed from 3 to 1. Total length cut 51% (621 → 304 lines) while increasing technical depth.

---

## [2.11.0] — 2026-04-02

### Added
- **Multi-agent compilation pipeline** — replaced monolithic Pass 2 LLM call with orchestrated specialist agents. Eliminates the JSON truncation bug (`Unterminated string at position 25609`) and produces higher-quality harnesses
- **@orchestrator** (`src/compiler/plan.ts`) — LLM planner that reads skeleton + intent and emits a `CompilationPlan` with phased agent tasks, dependency ordering, and per-agent token budgets. Falls back to deterministic plan on LLM failure
- **6 specialist agents** — each produces typed HarnessIR nodes:
  - `@sections-writer` → `Section[]` (CLAUDE.md sections)
  - `@command-writer` → `CommandNode[]` (with batching for 10+ commands)
  - `@agent-writer` → `AgentNode[]` (with modelRouting, batching for 8+ agents)
  - `@rule-writer` → `RuleNode[]` (path-scoped, mandatory security/continuity)
  - `@doc-writer` → `DocNode[]` (DECISIONS, LEARNINGS, SPRINT templates)
  - `@skill-writer` → `SkillNode[]` (TDD patterns)
- **@linker** (`src/compiler/linker.ts`) — cross-reference validation that detects broken `@agent` mentions in commands and `/project:command` references in agents, auto-patches broken refs, and injects mandatory help/security/continuity if missing
- **Batch execution engine** (`src/compiler/batch.ts`) — `executePlan()` with topological phase ordering, `runWithConcurrency()` for parallel agent execution, and TruncationError retry (doubles max_tokens, max 1 retry per agent)
- **Truncation detection** — `callLLM()` now checks `stop_reason === 'max_tokens'` (Anthropic) and `finish_reason === 'length'` (OpenAI), throwing `TruncationError` instead of returning partial JSON
- **HarnessIR on EnvironmentSpec** — `compile()` now sets `ir?: HarnessIR` on the returned spec, providing typed access alongside backward-compatible flat `harness.*` fields
- **Multi-phase progress display** — compilation shows plan summary, Phase A/B/C progress with agent counts, and per-agent retry warnings
- 247 new tests (1183 total, up from 936)

### Changed
- `compile()` flow: Pass 1 (skeleton, unchanged) → Pass 2 (@orchestrator plan) → Pass 3 (specialist agents + @linker) → Pass 4 (deterministic assembly)
- `HARNESS_PROMPT` removed from `src/compiler/prompt.ts` — replaced by per-agent system prompts
- `EnvironmentSpec` type updated with optional `ir?: HarnessIR` field
- `CompileProgress.phase` extended with `'plan' | 'phase-a' | 'phase-b' | 'phase-c' | 'assembly'`
- `estimateTime()` updated for 3-pass pipeline (orchestrator + parallel phases + linker)
- `summarizeSpec()` now prefers IR counts when `spec.ir` is available
- Concurrency: 3 for API key users, 2 for OAuth users

### Fixed
- **JSON truncation bug** — Pass 2 no longer produces a single ~16K token JSON blob. Each specialist stays within its token budget (2048-4096), eliminating truncation failures entirely

---

## [2.10.0] — 2026-04-02

### Added
- **`/project:persist` command** — persistent execution loop generated in every code project harness. Reads acceptance criteria from `docs/SPRINT.md`, works criterion-by-criterion with structured progress tracking in `.claude/progress.json`, auto-retries on verification failure (max 3 per criterion), delegates to `@grill` for review gate before completion, resumes from `progress.json` on session restart
- **Persist-router hook** (`persist-router.mjs`) — `UserPromptSubmit` hook that detects complex tasks via 6 complexity signals (multi-step, feature-scope, refactor-scope, bug-with-repro, explicit, long-prompt) and routes them through `/project:persist`. Configurable: `persistence_routing: auto | manual | off`
- **Persistence-aware memory hooks** — `SessionEnd` now includes `progress.json` summary in `memory.json` when a persistence loop is active; `SessionStart` shows resume prompt with criteria progress count
- **`persistence-completion` eval template** — measures whether the persistence loop completes multi-criterion tasks. Rubric checks: all criteria met, structured tracking used, tests pass, review gate executed. Added to feature-development, full-stack, api-building, and maintenance workflow mappings
- **Autonomy-level routing** — `persistence_routing` automatically set by autonomy level: `manual` (L1-2), `auto` (L3-4)

### Changed
- Context budget increased from 4 to 5 hooks (auto-format, block-destructive, PostCompact, memory-persistence, plus one contextual)
- HARNESS_PROMPT and SYSTEM_PROMPT output schemas include `persist` command
- Hook selection guide includes persistence routing recommendation

---

## [2.9.0] — 2026-04-02

### Added
- **Sprint contract pattern** — `@architect` outputs now require numbered acceptance criteria in `docs/SPRINT.md`; `/project:develop` Phase 4 validates each criterion individually as a contract scorecard; `/project:spec` requires 3-8 testable conditions; `Sprint Contract` section added to CLAUDE.md template
- **Smart model routing** — agents include tiered routing guidance (Haiku/Sonnet/Opus) based on task complexity; `modelRouting` field added to `AgentNode` IR with parser and renderer support; `Model Selection` section added to HARNESS_PROMPT
- **Context reset protocol** — full PostCompact alternative that pipes CLAUDE.md + SPRINT.md + DECISIONS.md into `additionalContext` for long sessions (>2 hours or >3 compactions)
- **Memory persistence hooks** — `SessionStart`/`SessionEnd` hooks save/load `.claude/memory.json` so accumulated project context survives session boundaries
- **Expanded security rules** — PreToolUse patterns expanded from 5 to 20+ across 4 categories: credential leaks (API keys, AWS secrets, private keys), injection (SQL, path traversal), destructive ops (force push, recursive chmod, npm publish), network (reverse shell, data exfiltration)
- **Pruning policy** — principle #8 in ROADMAP: "Prune what's no longer load-bearing. Harness complexity should decrease over time, not only grow."

### Changed
- HARNESS_PROMPT security hook consolidated into a single comprehensive pattern covering all 20+ rules
- Hook templates restructured with categorized security subsections and expanded selection guide
- Settings templates include `SessionStart`/`SessionEnd` hook examples for memory persistence

---

## [2.8.0] — 2026-04-02

### Added
- **Hybrid scoring** — deterministic rubric criteria (shell command checks) alongside LLM-as-judge, with configurable weighted blend
- **Anthropic prompt caching** — `cacheControl: true` on system prompts for proposer and scorer calls (~85% token savings on repeated invocations)
- **Targeted re-evaluation** — after mutation, re-run only tasks whose harness files were touched (saves ~40% eval cost per iteration)

### Changed
- **Default proposer model → Sonnet** — comparable mutation quality at ~5x lower cost than Opus
- `RubricCriterion` extended with optional `check` field for deterministic scoring

---

## [2.7.0] — 2026-04-02

### Added
- **Harness IR type model** (`src/ir/types.ts`) — typed intermediate representation for `.claude/` directories with 14 node types (Section, CommandNode, RuleNode, AgentNode, SkillNode, DocNode, HookNode, SettingsIR, McpServerNode, IntentNode), `IRMutation` discriminated union (17 mutation types), `IRDiff` structured diff, and factory functions
- **Parser** (`src/ir/parser.ts`) — reads existing `.claude/` directories into HarnessIR; CLAUDE.md section splitting with heading-to-ID resolution, YAML frontmatter extraction for rules/agents, settings.json hook parsing, `.mcp.json` server decomposition
- **Renderer** (`src/ir/renderer.ts`) — deterministic HarnessIR → file map conversion; CLAUDE.md rendering with section ordering, YAML frontmatter for rules and agents, settings.json merging, `.mcp.json` generation
- **Round-trip integration test** (`src/ir/__tests__/roundtrip.test.ts`) — proves parse→render→parse preserves all content on real `.claude/` directory and synthetic harnesses with double round-trip idempotency
- **IR mutation engine** (`src/ir/mutations.ts`) — 17 immutable mutation operations (update/add/remove/reorder sections, commands, rules, agents, MCP servers, settings) with `validateIRMutation` pre-condition checks
- **Semantic diff engine** (`src/ir/diff.ts`) — structural comparison of two HarnessIR trees by node ID/name, with `formatIRDiff` producing human-readable output using +/-/~/↕ markers
- **Legacy translation layer** (`src/ir/translate.ts`) — bridges text-based proposer `Mutation` objects to typed `IRMutation` values with raw_text fallback for unmappable operations
- **`measureComplexityFromIR()`** in `regularization.ts` — IR-aware complexity measurement counting nodes directly from in-memory IR tree (no disk I/O)

### Changed
- **Evolution mutator** (`src/evolve/mutator.ts`) — `applyMutations()` now uses IR pipeline internally: parse → translate → apply IR mutations → render. Copy-first/render-selectively strategy preserves untouched files byte-for-byte. Falls back to legacy approach if IR parsing fails
- **Evolution loop** (`src/evolve/loop.ts`) — baseline harness parsed to IR for complexity measurement; `measureComplexityFromIR` used when available with graceful fallback
- **`generateDiff()`** — delegates to `diffIR` + `formatIRDiff` for harness directories, producing semantic diffs instead of character-level patches

### Added (internal)
- 7 new source files in `src/ir/` (~3,400 LOC)
- 8 new test files with ~215 tests covering types, parser, renderer, round-trip, mutations, diff, translate, and IR integration
- `resolveSectionId()` exported from parser for reuse by translation layer

---

## [2.6.0] — 2026-04-01

### Added
- **Thompson Sampling for task selection** — Beta-distribution-based uncertainty-driven mini-batch sampling replaces uniform random; tasks with volatile scores get sampled more often, stable tasks less. `--sampling thompson|uniform` CLI flag (Thompson is default when `evalSampleSize > 0`)
- **KL Regularization** — complexity penalty prevents harness bloat by measuring lines, files, sections, and character-level diff from baseline. `effective_score = raw_score - λ * complexityCost * 100`. `--kl-lambda` CLI flag (default: 0.1, 0 = disabled)
- **`kairn evolve pbt`** — Population-Based Training runs N independent evolution branches concurrently (default: 3), each with its own workspace, RNG seed, and Thompson Sampling beliefs. Similar wall time to single run, 3x the exploration
- **Meta-Principal synthesis** — after all PBT branches complete, a Meta-Principal LLM agent reads all branch results (iteration logs, per-task score matrices, Thompson beliefs, complexity metrics) and synthesizes the optimal harness by cherry-picking the best mutations from each trajectory
- **Cross-branch score matrix** in synthesis prompt — enables the Meta-Principal to identify mutations that helped across multiple branches vs single-branch flukes
- **`rawScore` and `complexityCost` fields** in `IterationLog` — track pre-penalty scores and complexity drift per iteration

### Added (internal)
- `src/evolve/sampling.ts` — Thompson Sampling with Beta distributions (Marsaglia-Tsang gamma sampling)
- `src/evolve/regularization.ts` — harness complexity measurement and KL penalty
- `src/evolve/population.ts` — PBT branch manager (parallel evolve calls with workspace isolation)
- `src/evolve/synthesis.ts` — Meta-Principal cross-branch synthesis (prompt builder + LLM call + evaluation)
- 49 new tests across 5 test files (sampling, regularization, population, synthesis, PBT integration)

### Changed
- `EvolveConfig` extended with `samplingStrategy`, `klLambda`, `pbtBranches` fields (all backward-compatible with defaults)
- `evolve run` displays sampling strategy and KL lambda in config summary
- Evolution loop uses penalized scores for rollback decisions when KL is active

---

## [2.5.2] — 2026-04-01

### Fixed
- **Permission blocking in evolve loop** — `spawnClaude()` now passes `--dangerously-skip-permissions` so eval agents in `--print` mode no longer stall on permission prompts in disposable worktrees

### Added
- **7 new eval tasks** (5 → 12 total) — `fs-promises-convention`, `chalk-color-mapping`, `error-boundary-pattern`, `security-path-validation`, `single-conventional-commit`, `inquirer-import-check`, `env-id-prefix`
- **Mini-batch sampling** enabled by default — `eval_sample_size: 5` samples 5 of 12 tasks on middle iterations (~40% cost reduction per evolution cycle)

### Changed
- `parallel_tasks` default increased to 2 (safe with worktree isolation)
- `prune_threshold` lowered from 95 to 90 for broader coverage with expanded task menu
- `runs_per_task` explicitly set to 1 in config

---

## [2.5.0] — 2026-04-01

### Added
- **Two-tier intent routing** — `kairn describe` now generates project-specific intent-aware hooks that intercept natural language and route to the correct workflow command
- **Tier 1 regex engine** (`.claude/hooks/intent-router.mjs`) — <10ms, $0 keyword matching with synonym expansion (e.g., "ship it" → `/project:deploy`)
- **Tier 2 prompt hook** — Haiku-powered semantic classification for ambiguous prompts (~$0.001/prompt), compiled with project-specific workflow + agent manifest
- **Intent pattern generation** — each generated command produces 1-3 regex patterns from command name, synonyms, and framework-specific verbs
- **Question filter** — informational queries ("what is deploy?", "how do I test?") do not trigger routing
- **Self-learning pattern promotion** (`.claude/hooks/intent-learner.mjs`) — runs on `SessionStart`, promotes recurring Tier 2 patterns to Tier 1 regexes after 3+ matches
- **Audit trail** — `.claude/hooks/intent-promotions.jsonl` records every promotion with timestamp, source prompts, and generated regex
- **`intent-routing` eval template** — test that NL prompts route to correct commands via `kairn evolve`
- **Evolve integration** — proposer reads intent patterns as harness context, baseline snapshots include `.claude/hooks/`

### Changed
- `EnvironmentSpec.harness` extended with `hooks`, `intent_patterns`, `intent_prompt_template` fields
- `HarnessContent` extended with `hooks` field
- `settings.json` output now includes `UserPromptSubmit` (Tier 1 + Tier 2) and `SessionStart` (learner) hooks
- `buildFileMap()` and `writeEnvironment()` now write `.claude/hooks/` directory
- Compilation pipeline (Pass 3) generates intent patterns, prompt template, and hook scripts
- `EvalTemplate` type includes `intent-routing`

---

## [2.2.0] — 2026-03-31

### Added
- **Counterfactual diagnosis** — identifies which harness mutations helped or hurt specific tasks by comparing per-task scores across consecutive iterations
- **Per-task trace diffing** — `diffTaskTraces()` compares two traces for the same task across iterations, showing score deltas, pass/fail changes, stdout differences, and file change diffs
- **`kairn evolve report`** — human-readable Markdown summary of an evolution run including overview metrics, per-iteration table, evolution leaderboard (iterations × tasks × scores), and counterfactual diagnosis section
- **`kairn evolve report --json`** — machine-readable JSON report with the same data for CI/pipeline integration
- **`kairn evolve diff <iter1> <iter2>`** — colored unified diff of harness changes between two iterations with per-task score comparison table

### Added (internal)
- `src/evolve/diagnosis.ts` — `diffTaskTraces()` and `diagnoseCounterfactuals()` utilities
- `src/evolve/report.ts` — `generateMarkdownReport()` and `generateJsonReport()` report generators
- `TraceDiff`, `CounterfactualEntry`, `CounterfactualReport`, `EvolutionReport` types in `src/evolve/types.ts`
- 24 new unit tests across `diagnosis.test.ts` and `report.test.ts`

---

## [1.14.0] — 2026-03-31

### Added
- **Completion Verification checklist** injected into all orchestrating commands — forces self-review before marking any task complete, catching premature exits
- **Phase 7 "Completion Gate"** added to `/project:develop` — LLM-generated develop command now includes requirements check, state check, and 3-perspective check (test engineer, code reviewer, requesting user)
- **`/project:loop` exit condition upgraded** — tests passing is necessary but not sufficient; Completion Verification checklist must also clear before exiting the loop
- **`/project:auto` verification gate** — requires Completion Verification before PR creation; checklist results included in PR description
- **`/project:autopilot` stop condition** — Completion Verification failure after 2 fix attempts triggers autopilot stop
- **"Completion Standards" section** in generated CLAUDE.md — behavioral mandate that tests passing alone is not enough to mark done
- **Three-perspective check** in all verification gates: test engineer (failure modes), code reviewer (PR flags), requesting user (problem solved?)

### Changed
- **`/project:loop`** — Phase 6 is now "Completion Gate", Phase 7 is "Ship" (was Phase 6)
- **`/project:auto`** — Phase 5 is now "Completion Gate", Phase 6 is "PR", Phase 7 is "Next"
- **`/project:autopilot`** — loop includes verification step before PR; stop conditions expanded

---

## [1.13.0] — 2026-03-31

### Added
- **"First Turn Protocol" section** in every generated CLAUDE.md — instructs the agent to orient (pwd, ls, git status, runtime checks, read task files) before doing any work, saving 2-5 wasted exploration turns per session
- **`/project:bootstrap` command** for Level 2+ — compound shell command that gathers a full environment snapshot (working directory, project files, git status, language runtimes, package managers, masked .env keys)
- **SessionStart bootstrap hook** for Level 3-4 — automatic environment snapshot injected when Claude Code starts, so the agent has full runtime context from turn zero
- **Project-type-aware runtime checks** — `buildBootstrapHookCommand()` infers relevant checks (Node, Python, Rust, Go) from the generated CLAUDE.md tech stack content
- **`.env` key masking** — bootstrap output uses `sed 's/=.*/=***/'` to show which keys are set without exposing values

### Changed
- **HARNESS_PROMPT and SYSTEM_PROMPT** — item #16 added to "What You Must Always Include": First Turn Protocol section
- **`applyAutonomyLevel()`** — Level 2+ gets bootstrap command; Level 3+ gets SessionStart bootstrap hook alongside existing welcome hook

---

## [1.12.0] — 2026-03-31

### Changed
- **Phase-by-phase progress display** — `kairn describe` compilation now shows labeled phases (registry, Pass 1, Pass 2, Pass 3) with ✔/◐/⚠ status indicators instead of a single spinner
- **Live elapsed timer** — running `[Xs]` counter updates every second during each active compilation pass, eliminating "is it frozen?" anxiety
- **Time estimate** — model-tier and prompt-complexity based estimate shown before compilation starts (e.g., "~40s" for Sonnet, "~2-4 min" for complex Opus prompts); supports all 8 providers
- **Retry visibility** — when Pass 2 retries in concise mode, shows ⚠ warning line before continuing
- **Final summary** — compilation ends with "Environment compiled in Xs" showing actual wall-clock time

### Added
- `CompileProgress` interface in `src/types.ts` — structured progress events with phase, status, message, detail, elapsed, and estimate fields
- `createProgressRenderer()` in `src/ui.ts` — multi-line ANSI progress renderer with cursor repositioning and interval-based elapsed timer
- `estimateTime()` in `src/ui.ts` — heuristic time estimator supporting 19+ model variants across all providers

### Changed (internal)
- `compile()` callback signature changed from `(msg: string) => void` to `(progress: CompileProgress) => void`
- `validateSpec()` now returns warnings array instead of emitting via callback
- `optimize` command updated to work with new `CompileProgress` callback

---

## [1.11.0] — 2026-03-31

### Added
- **`/project:develop` command** — full development pipeline orchestrating subagents through spec → plan → TDD implement → verify → review → doc update phases; replaces monolithic `/ship` pattern
- **5 new agents** for code projects: `@architect` (opus — spec interview), `@planner` (opus — implementation planning), `@implementer` (sonnet — TDD-focused coding), `@fixer` (sonnet — targeted bug fixing), `@doc-updater` (haiku — automated DECISIONS.md and LEARNINGS.md updates)
- **Engineering Standards** section in generated CLAUDE.md — concise output rules, load-bearing code emphasis
- **Tool Usage Policy** section in generated CLAUDE.md — prefer dedicated tools over shell equivalents
- **Code Philosophy** section in generated CLAUDE.md — no premature abstractions, complete tasks fully

### Changed
- **`docs/SPRINT.md` replaces `docs/TODO.md`** — SPRINT.md is now the living spec/plan for short-term work; TODO.md is no longer generated
- **CLAUDE.md context budget** increased from 120 to 150 lines to accommodate new engineering sections
- **Agent budget** increased from 3 to 5 to support the `/develop` orchestration pipeline
- **Autonomy module** — all commands and agents now reference `docs/SPRINT.md` instead of `docs/TODO.md`
- **Status line** — task count now reads from `docs/SPRINT.md` instead of `docs/TODO.md`

### Removed
- `docs/TODO.md` — no longer generated in new environments (use `docs/SPRINT.md` instead)
- `/project:tasks` — removed from default command set (task tracking consolidated into SPRINT.md)

---

## [1.10.1] — 2026-03-31

### Changed
- **Multi-pass compilation pipeline** — `kairn describe` now compiles in 3 passes instead of 1 monolithic LLM call, fixing JSON truncation on complex prompts (biotech, k8s, ML, music production)
  - **Pass 1 (Skeleton):** Tool selection + project outline, small JSON output (max_tokens: 2048)
  - **Pass 2 (Harness):** CLAUDE.md + commands + rules + agents + docs (max_tokens: 8192)
  - **Pass 3 (Settings):** settings.json + .mcp.json generated deterministically from registry (no LLM call)
- **Split compilation prompts** — `SYSTEM_PROMPT` split into focused `SKELETON_PROMPT` and `HARNESS_PROMPT`, reducing per-call context size
- **Retry logic** — Pass 2 automatically retries with concise mode if JSON parsing fails (max 80 lines CLAUDE.md, max 5 commands)

### Added
- `SkeletonSpec` and `HarnessContent` TypeScript interfaces for multi-pass pipeline
- `buildSettings()` and `buildMcpConfig()` deterministic builders (no LLM needed for security rules, hooks, and MCP config)

### Fixed
- Complex prompts (biotech, k8s, ML training, music production) no longer crash with `Failed to parse LLM response as JSON` at position ~23000-26000

---

## [1.10.0] — 2026-03-31

### Added
- **5 new LLM providers** — xAI (Grok), DeepSeek, Mistral, Groq, and custom OpenAI-compatible endpoints join Anthropic, OpenAI, and Google
- **Custom endpoint support** — "Other" provider option for local models (Ollama, LM Studio) or any OpenAI-compatible API with configurable base URL, model name, and optional API key
- **Updated model menus** — Anthropic (Sonnet 4.6, Opus 4.6, Haiku 4.5), OpenAI (GPT-4.1, GPT-4.1 mini, o4-mini, GPT-5 mini), Google (Gemini 2.5/3 Flash, Gemini 2.5/3.1 Pro), xAI (Grok 4.1 Fast, Grok 4.20), DeepSeek (V3.2 Chat/Reasoner), Mistral (Large 3, Codestral, Small 4), Groq (Llama 4, DeepSeek R1, Qwen 3)
- **Cheap model routing** — clarification step uses the cheapest model per provider (Haiku, nano, flash, etc.) regardless of selected compilation model
- **`src/providers.ts` module** — shared provider configs, model menus, and helper functions used by init and compiler

### Changed
- **`kairn init`** — now offers 8 provider choices (was 3); custom endpoint flow prompts for base URL and model name
- **`KairnConfig` type** — added optional `base_url` field for custom endpoints
- **`LLMProvider` type** — expanded from 3 to 8 variants (anthropic, openai, google, xai, deepseek, mistral, groq, other)
- **Compiler LLM routing** — unified OpenAI-compatible path for all non-Anthropic providers using shared `PROVIDER_CONFIGS`

### Fixed
- **`optimize` command** — removed invalid third argument in `collectAndWriteKeys` call that caused type error

---

## [1.9.0] — 2026-03-31

### Added
- **Autonomy level selection** — `kairn describe` prompts for autonomy level (1-4) during setup; `--quick` defaults to Level 1
- **Level 1 (Guided):** `/project:tour` command (interactive environment walkthrough), SessionStart welcome hook, `QUICKSTART.md` doc, workflow reference in CLAUDE.md
- **Level 2 (Assisted):** `/project:loop` command (workflow-specific automated cycle with approval gates), `@pm` agent (plans, specs, prioritizes — does not code)
- **Level 3 (Autonomous):** `/project:auto` command (PM-driven loop with worktree isolation and PR delivery)
- **Level 4 (Full Auto):** `/project:autopilot` command (continuous execution with stop conditions: max 5 features, test failure, Escape)
- **`src/autonomy.ts` module** — deterministic generation of level-specific commands, agents, hooks, and docs
- **Compiler prompt updated** — LLM tailors CLAUDE.md workflow sections based on autonomy level

### Changed
- **`EnvironmentSpec` type** — added `autonomy_level` field (1-4, defaults to 1)
- **Adapter** — applies autonomy-level content before writing files

---

## [1.8.0] — 2026-03-31

### Added
- **Interactive API key collection** — after `kairn describe` or `kairn optimize` writes environment files, prompts for each required API key with masked input; entered keys saved to `.env`, skipped keys get empty placeholders
- **`.env` file generation** — writes project-scoped `.env` with entered keys and empty placeholders for skipped keys
- **`.gitignore` auto-update** — automatically appends `.env` to `.gitignore` to prevent accidental commits
- **SessionStart hook** — generated `settings.json` includes a hook that loads `.env` into `CLAUDE_ENV_FILE` so MCP servers can access API keys
- **`kairn keys` command** — add or update API keys for existing environments; detects required vars from `.mcp.json`, prompts for missing keys
- **`kairn keys --show`** — display which keys are set (masked) vs missing, with signup URLs
- **`--quick` flag** skips key prompts in `describe`, writes `.env` with empty placeholders instead

### Added (internal)
- **`src/secrets.ts` module** — shared utilities for key collection, `.env` reading/writing, `.gitignore` management, and env var detection from `.mcp.json`

---

## [1.7.0] — 2026-03-31

### Added
- **Verification section** in CLAUDE.md template — concrete verify commands (build, test, lint, type check) per project type; research projects get source-citation verification
- **Known Gotchas section** in CLAUDE.md template — living memory that grows with corrections, auto-prune guidance at 10 items
- **`/project:spec` command** — interview-based spec creation (5-8 questions → structured spec in docs/SPRINT.md)
- **`/project:prove` command** — verification on demand (run tests, diff vs main, rate confidence HIGH/MEDIUM/LOW)
- **`/project:grill` command** — adversarial code review (challenges each change, rates BLOCKER/SHOULD-FIX/NITPICK)
- **`/project:reset` command** — clean restart preserving learnings (stash + reimplementation)
- **Statusline config** — auto-generated `statusLine` in settings.json for code projects (git branch + open task count)
- **Debugging guidance** in CLAUDE.md — "paste raw errors, use subagents for deep investigation"
- **Git workflow guidance** in CLAUDE.md — small commits, conventional format, <200 lines per PR

### Changed
- **CLAUDE.md context budget** increased from 100 to 120 lines to accommodate new sections
- **Seed templates updated** — all 4 templates include new sections; code templates include new commands + statusline

---

## [1.6.0] — 2026-03-30

### Added
- **Interactive clarification flow** — LLM generates 3-5 clarifying questions with suggested defaults before compilation, eliminating hallucinated project details
- **`--quick` / `-q` flag** — Skip clarification questions for fast compilation (old behavior)
- **Branded CLI output** — Maroon/warm stone color palette with block-character KAIRN wordmark logo
- **`src/ui.ts` styling module** — Centralized `ui.*` functions for headers, sections, key-value pairs, tool display, env var setup, and error boxes
- **`src/logo.ts`** — Full banner (wordmark + braille cairn art) and compact banner for all commands
- **Ora spinner** — Animated progress spinner during compilation and scanning (replaces line-overwrite hack)
- **Branded error display** — Error boxes with styled headers for all failure modes
- **`--no-color` flag** — Global flag to disable colored output for piping/CI (also respects `NO_COLOR` env var)

### Changed
- **All 9 commands redesigned** — Consistent visual design with branded banners, section headers, key-value pairs, and styled status indicators across init, describe, optimize, list, activate, doctor, registry, templates, and update-registry

---

## [1.5.0] — 2026-03-30

### Added
- **Template gallery** — 4 curated pre-built environments (Next.js Full-Stack, API Service, Research, Content Writing) installed automatically on `kairn init`
- **`kairn templates`** — Browse and filter available templates with `--category` and `--json` options
- **`kairn activate` template fallback** — Activate templates by ID when not found in saved environments
- **`kairn registry list`** — Browse all tools (bundled + user-defined) with `--category` and `--user-only` filtering
- **`kairn registry add`** — Interactively add custom tool definitions to the user registry with validation
- **User registry** — Custom tools stored in `~/.kairn/user-registry.json`, merged with bundled registry (user tools take precedence by ID)
- **Hermes runtime adapter** — `--runtime hermes` flag on `describe` and `optimize` generates `~/.hermes/config.yaml` and `~/.hermes/skills/` from any EnvironmentSpec
- **CONTRIBUTING.md** — Guide for community tool submissions via PR

### Changed
- **Registry loader refactored** — Deduplicated `loadRegistry()` from 3 files into shared `src/registry/loader.ts`
- **Templates directory** — `~/.kairn/templates/` created automatically alongside envs directory

---

## [1.4.0] — 2026-03-30

### Added
- **Sprint contract pattern** — `/project:sprint` command for defining acceptance criteria before coding, writes to `docs/SPRINT.md`
- **Multi-agent QA pipeline** — `@qa-orchestrator` (sonnet), `@linter` (haiku), `@e2e-tester` (sonnet, Playwright) agent templates in generated environments
- **PostCompact hook** — Auto re-reads CLAUDE.md and SPRINT.md after context compaction to restore project context
- **Context budget enforcement** — Strict limits in compilation prompt (≤6 MCP servers, ≤100 lines CLAUDE.md, ≤3 skills, ≤3 agents) with post-compilation validation warnings
- **`kairn optimize --diff`** — Preview what would change before writing, with colored diff output and apply prompt
- **`kairn doctor`** — Validate .claude/ environments against best practices with weighted scoring (10 checks, pass/warn/fail)

---

## [1.3.0] — 2026-03-30

### Added
- **Structured CLAUDE.md template** — Mandatory 7-section format (Purpose, Tech Stack, Commands, Architecture, Conventions, Key Commands, Output) enforced by compilation prompt
- **Shell-integrated commands** — Generated slash commands use `!` prefix for live shell output (git status, test results, build output)
- **Path-scoped rules** — YAML frontmatter `paths:` support for domain-specific rules (api.md, testing.md, frontend.md)
- **Hooks in settings.json** — Auto-generated PreToolUse hook to block destructive commands; PostToolUse formatter hook for projects with Prettier/ESLint/Black
- **`/project:status` command** — Live git status, recent commits, and TODO overview using `!` prefix
- **`/project:fix` command** — Issue-driven development with `$ARGUMENTS` for issue numbers
- **Improved TDD skill** — 3-phase isolation pattern (RED → GREEN → REFACTOR) replacing generic TDD instruction
- **10 new tools in registry** (28 total): Sentry, Vercel, Docker Toolkit, Chrome DevTools, SQLite, Stripe, Memory (Knowledge Graph), E2B Sandbox, GPT Researcher, Jira
- **Optimize audit checks** — Now flags missing hooks and missing path-scoped rules

---

## [1.1.0] — 2026-03-31

### Added
- **`kairn optimize`** — Scan existing codebases and generate or optimize Claude Code environments
  - Project scanner detects: language, framework, dependencies, test/build/lint commands, Docker, CI/CD, env keys
  - Harness auditor checks: CLAUDE.md length, missing commands, missing rules, MCP server count
  - `--audit-only` flag to inspect without generating changes
  - `--yes` flag to skip confirmation prompts
- Backward-compatible config migration — old configs (v1.0.0 format with `anthropic_api_key`) auto-migrate to new format without requiring `kairn init`

### Fixed
- Anthropic model IDs updated to current API names:
  - `claude-sonnet-4-6` (was `claude-sonnet-4-20250514`)
  - `claude-opus-4-6` (was `claude-opus-4-20250514`)
  - `claude-haiku-4-5-20251001` (was `claude-3-5-haiku-20241022`)

## [1.0.0] — 2026-03-30

### Added
- **`kairn init`** — Interactive API key setup with multi-provider support (Anthropic, OpenAI, Google) and model selection
- **`kairn describe`** — Compile natural language intent into optimized Claude Code environments
  - LLM-powered environment compilation
  - Generates: CLAUDE.md, settings.json, .mcp.json, commands/, rules/, skills/, agents/, docs/
  - `--yes` flag to skip confirmation
  - Progress indicator during compilation
- **`kairn list`** — Show all saved environments from `~/.kairn/envs/`
- **`kairn activate`** — Re-deploy a saved environment to any directory (accepts partial ID matching)
- **`kairn update-registry`** — Fetch latest tool catalog from GitHub with backup and validation
- Bundled tool registry with 18 curated tools across 6 tiers:
  - Universal: Context7, Sequential Thinking, security-guidance
  - Code: GitHub MCP, Playwright, Semgrep
  - Search: Exa, Brave Search, Firecrawl, Perplexity
  - Data: PostgreSQL (Bytebase), Supabase
  - Communication: Slack, Notion, Linear, AgentMail
  - Design: Figma, Frontend Design
- Claude Code adapter generating full .claude/ directory structure
- Hermes-inspired patterns in every environment:
  - `/project:help` command (environment guide)
  - `/project:tasks` command (TODO management)
  - `rules/continuity.md` (session memory via DECISIONS.md, LEARNINGS.md)
  - `rules/security.md` (essential security instructions)
- Security deny rules by default (rm -rf, curl|sh, .env, secrets/)
- Robust LLM error classification (auth, rate limit, billing, network, model not found)
- JSON parsing resilience (extracts JSON from wrapped responses)
