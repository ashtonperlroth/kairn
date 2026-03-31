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

---

## v2.x — Hosted Compilation

- [ ] Free hosted compilation endpoint — no local LLM key needed
- [ ] Web dashboard for environment management
- [ ] Template marketplace — share and discover environments
- [ ] Detect and adapt to existing user MCP servers

---

## v3.x — Integrated Payments

- [ ] Zero-friction tool provisioning via Stripe MPP
- [ ] Usage tracking and spending controls
- [ ] BYOK (bring your own key) flow for non-MPP tools

---

## v4.x — Learning System

- [ ] Automated tool discovery (GitHub, npm, community)
- [ ] Usage-based quality scoring
- [ ] Workflow-to-environment recommendation model

---

## Principles

1. **Minimal over complete.** Fewer, well-chosen tools beat many generic ones.
2. **Workflow-specific over generic.** Every generated file relates to the actual task.
3. **Local-first.** Everything works offline. Hosted features are optional.
4. **Transparent.** Users can inspect every generated file.
5. **Security by default.** Every environment includes deny rules and security guidance.
