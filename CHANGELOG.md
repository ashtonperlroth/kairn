# Changelog

All notable changes to Kairn will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
