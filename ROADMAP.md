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
