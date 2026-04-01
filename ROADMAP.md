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
- [ ] Failure taxonomy: was it the harness? the task? the model? the repo state? Log classification per task failure
- [ ] Canonical benchmark corpus: small set of stable, version-controlled tasks alongside project-specific evals
- [ ] Confidence intervals: report mean ± stddev across N runs per task in `kairn evolve report`
- [ ] Custom scoring functions (user-defined scoring scripts in `.kairn-evolve/`)

**Auth & Cost:**
- [ ] **Claude Code subscription auth (experimental)** — at `kairn init`, offer "Use Claude Code subscription" option that reads OAuth tokens from macOS Keychain (`Claude Code-credentials`), refreshes on expiry, and passes as API key. All LLM calls (compilation, proposer, scorer) bill to user's Claude subscription instead of separate API key. Upfront warning: undocumented, may break. Full system prompt and model selection support (OAuth token = API key for Anthropic SDK). Linux/Windows credential store support TBD.
- [ ] Prompt caching integration (Anthropic ephemeral caching for trace reads — ~85% token savings)
- [ ] Cost tracking per iteration (total tokens, USD cost, wall time) in report

**Iteration Speed:**
- [x] ~~Parallel task evaluation~~ — shipped in v2.2.5

**DX Quick Wins:**
- [ ] Fix hardcoded CLI version → read from package.json dynamically
- [ ] Capture tool calls & MCP usage from runner output → tool_calls.json
- [ ] Harness utilization metrics (which tools/agents/rules were used vs available)

### v2.4.0 — Intelligent Evolution (RL-inspired) [NEXT]
> The evolution loop is a text-space optimization algorithm. These features make it behave more like a proper optimizer: mini-batch sampling, meta-learning, exploration scheduling.

**Principal Proposer (meta-learner):**
- [ ] After N-1 normal iterations, a separate "Principal" LLM call reads ALL iteration logs (proposals, diffs, score deltas, rollback reasons) and synthesizes a single best harness from the baseline
- [ ] Different system prompt: "You are reviewing the entire evolution run. Cherry-pick the best mutations, avoid regressions, synthesize the optimal harness."
- [ ] Evaluated as the final iteration with full eval suite — the intelligent distillation of the entire run's learnings

**Mini-batch eval sampling (stochastic gradient):**
- [ ] Maintain a pool of 10-15 evals. Each iteration samples K (e.g., 5). Different subsets cycle through.
- [ ] Implicit regularization: can't overfit to one subset. Broader coverage over many iterations.
- [ ] Inspired by mini-batch SGD — see different "angles" of the harness each step.

**Exploration/exploitation schedule:**
- [ ] Early iterations: higher mutation cap, bolder changes, diverse eval samples (exploration)
- [ ] Late iterations: lower mutation cap, conservative refinements, full eval sweep (exploitation)
- [ ] Like epsilon-greedy with decay, or learning rate warmup → cosine annealing

**Experience replay (cross-run learning):**
- [ ] Persist a "proposer memory" of what mutations worked/failed across multiple `evolve run` sessions
- [ ] The proposer reads prior run summaries before proposing — learns from history, not just current traces
- [ ] This is the data flywheel: each run makes future runs smarter

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

### v2.6.0 — Structured Harness IR
> Raw Markdown mutation will corrupt formatting, accumulate contradictions, and break as files grow. A structured intermediate representation makes mutations composable, diffing meaningful, and format migration tractable.

- [ ] Harness IR: typed data model for CLAUDE.md sections, commands, rules, agents, settings
- [ ] Deterministic render: IR → .claude/ files (one-way, lossless)
- [ ] Mutations operate on IR nodes, not raw text (type-safe, composable)
- [ ] Diff engine compares IR trees, not string patches
- [ ] Migration path: parse existing .claude/ → IR → re-render (format upgrade for free)

### v2.7.0 — Polish & Integration
- [ ] `kairn evolve watch` — live dashboard during evolution (progress, scores, current mutation)
- [ ] Integration with `kairn describe` ("generate, then auto-evolve for 3 iterations")
- [ ] Integration with `kairn optimize` ("audit, then evolve the fixes")
- [ ] Template evolution (evolve a template against its canonical tasks)
- [ ] Export evolved environment as a new Kairn template
- [ ] CI/CD integration guide (run `kairn evolve` in GitHub Actions)
- [ ] Multi-objective scoring (correctness × efficiency × cost) with weighted aggregation
- [ ] Search strategy selection: greedy (default), best-of-N, population-based

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
