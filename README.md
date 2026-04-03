# Kairn — The Agent Environment Compiler

> Describe your workflow. Get an optimized Claude Code environment. Then evolve it automatically.

Kairn is a CLI that compiles natural language descriptions into minimal, optimal [Claude Code](https://code.claude.com/) agent environments — complete with MCP servers, slash commands, skills, subagents, rules, and security. Then it uses **automated evolution** (inspired by [Meta-Harness](https://yoonholee.com/meta-harness/), Stanford IRIS Lab 2026) to improve them through real-world task execution.

**v2.11.0** introduces a **Multi-Agent Compilation Pipeline** — the monolithic Pass 2 LLM call is replaced by an @orchestrator planner and 6 specialist agents (@sections-writer, @command-writer, @agent-writer, @rule-writer, @doc-writer, @skill-writer) that run in parallel phases, producing typed HarnessIR nodes. Eliminates JSON truncation failures and produces higher-quality harnesses. Previous highlights: persistent execution loops (v2.10), population-based evolution (v2.6), structured HarnessIR (v2.7), intent-aware routing (v2.5).

**No servers. No accounts. No telemetry. Runs locally with your own LLM key.**

---

## Install

```bash
npm install -g kairn-cli
```

Requires Node.js 18+. The command is `kairn`.

## Quick Start

```bash
# 1. Set up your LLM provider (Anthropic, OpenAI, Google, xAI, DeepSeek, Mistral, Groq, or custom)
kairn init

# 2. Describe your workflow (or scan an existing repo)
kairn describe "Build a Next.js app with Supabase auth"
# or
kairn optimize   # scans existing project at cwd

# 3. Start coding
claude
```

Kairn generates the entire `.claude/` directory — CLAUDE.md, settings.json, commands, rules, agents, hooks, security policies — tailored to your specific workflow. Then, optionally, evolve it:

```bash
# Set up evolution
kairn evolve init        # auto-generate 3-5 eval tasks
kairn evolve baseline    # snapshot current harness

# Optimize
kairn evolve run --iterations 5   # Run evolution loop
kairn evolve apply                 # Accept best harness
```

---

## What Gets Generated

```
.claude/
├── CLAUDE.md              # Workflow-specific system prompt (7 sections)
├── settings.json          # Permissions, hooks, security rules, intent routing
├── commands/              # Slash commands (/project:help, /project:plan, etc.)
├── rules/                 # Auto-loaded instructions (security, continuity, paths)
├── skills/                # Model-controlled capabilities (code, research, writing)
├── agents/                # Specialized subagents (@architect, @tester, etc.)
├── docs/                  # Pre-initialized project memory
├── hooks/                 # Intent router (Tier 1 regex + Tier 2 Haiku classifier)
│   ├── intent-router.mjs      # Project-specific regex patterns + fallthrough
│   ├── intent-learner.mjs     # Promotes recurring Tier 2 patterns to Tier 1
│   └── intent-log.jsonl       # Log of routed prompts (for learning)
└── QUICKSTART.md          # Interactive startup guide (Level 2-4)
.mcp.json                  # Project-scoped MCP server config
.env                       # API keys (gitignored, masked in output)
```

---

## Core Commands

### `kairn init`

Interactive setup. Pick your LLM provider, enter credentials. API key stored locally at `~/.kairn/config.json`.

**Supported providers:**
- **Anthropic** — Claude Sonnet 4.6, Opus 4.6, Haiku 4.5
- **OpenAI** — GPT-4.1, GPT-4.1 mini, o4-mini, GPT-5 mini
- **Google** — Gemini 2.5 Flash, Gemini 3 Flash, Gemini 2.5 Pro, Gemini 3.1 Pro
- **xAI** — Grok 4.1 Fast, Grok 4.20 (2M context, $0.20/M)
- **DeepSeek** — V3.2 Chat, V3.2 Reasoner (cheapest at $0.28/M)
- **Mistral** — Large 3, Codestral, Small 4 (open-weight)
- **Groq** — Llama 4, DeepSeek R1, Qwen 3 (free tier)
- **Custom** — any OpenAI-compatible endpoint (local Ollama, LM Studio)

### `kairn describe [intent] [options]`

**The main command.** Describe what you want your agent to do. Kairn compiles an optimal environment.

```bash
kairn describe "Build a Next.js REST API with PostgreSQL"
kairn describe "Research ML papers on GRPO training and summarize" --quick
```

**Features:**
- **Interactive clarification** — 3-5 yes/no questions to refine your workflow (skip with `--quick`)
- **Multi-pass compilation** — Skeleton pass (tool selection) → multi-agent harness generation → deterministic settings
- **Autonomy levels** — Choose how autonomous (1-4, default 2):
  - **Level 1 (Guided):** Manual workflow with `/project:tour`, help, and guidance
  - **Level 2 (Assisted):** `/project:loop` for workflow automation, `@pm` agent for planning
  - **Level 3 (Autonomous):** `/project:auto` for self-directed execution with PR delivery
  - **Level 4 (Full Auto):** `/project:autopilot` for continuous execution with stop conditions
- **Secrets collection** — Prompted for API keys after generation, written to `.env`
- **Intent routing** — Auto-generated `/project:*` command routing (both regex and Haiku-based)

### `kairn optimize [options]`

Scan an existing project and optimize its Claude Code environment. Detects language, framework, dependencies, and generates improvements.

```bash
kairn optimize          # Scan, audit, and overwrite .claude/
kairn optimize --diff   # Preview changes before writing
kairn optimize --audit-only    # Show issues without generating
```

**Features:**
- **Full project scan** — language, framework, dependencies, scripts, env keys, CI/CD, existing harness
- **Harness audit** — checks CLAUDE.md quality, missing commands/rules, MCP bloat, security configurations
- **Two modes:**
  - No `.claude/` → generate from scratch
  - Has `.claude/` → optimize + overwrite (shows audit issues first, asks for confirmation)
- **Diff preview** — see what would change before applying (with `--diff`)

### `kairn templates [options]`

Browse pre-built environment templates. Activate one to jumpstart a new project.

```bash
kairn templates                  # Browse gallery
kairn templates --activate nextjs       # Apply a template
```

**Available templates:**
- Next.js Full-Stack (React + Node + PostgreSQL + Supabase)
- API Service (Express/Fastify + database + testing)
- Research Project (paper analysis, literature review, synthesis)
- Content Writing (blog, documentation, marketing)

### `kairn doctor`

Validate the current environment against Claude Code best practices. Checks:
- CLAUDE.md structure and token count
- MCP server configuration completeness
- Security rules and hooks
- Command and agent definitions
- Environment variable references

### `kairn keys [options]`

Manage API keys for MCP servers in the current environment.

```bash
kairn keys           # Prompt for missing keys
kairn keys --show    # Show which keys are set vs missing
```

### `kairn list` / `kairn activate <env_id>`

Show saved environments (stored in `~/.kairn/envs/`) and re-deploy them to any directory.

```bash
kairn list                    # List all saved environments
kairn activate env_abc123     # Copy that environment to .claude/
```

### `kairn evolve` — Automated Harness Optimization

The heart of v2.x. Run your agent on real tasks, capture execution traces, diagnose failures, and mutate the harness iteratively.

#### `kairn evolve init`

Set up evolution for the current project. Auto-generates 3-5 concrete eval tasks based on your CLAUDE.md and project structure.

```bash
kairn evolve init
```

Creates `.kairn-evolve/tasks.yaml` with tasks like:
- "Add a new feature X to the codebase"
- "Fix this known bug Y"
- "Refactor the API layer for clarity"
- "Write comprehensive test coverage"
- "Update documentation after feature launch"

Uses 6 built-in templates: add-feature, fix-bug, refactor, test-writing, config-change, documentation.

#### `kairn evolve baseline`

Snapshot your current `.claude/` directory as iteration 0 (the baseline to improve against).

```bash
kairn evolve baseline
```

#### `kairn evolve run`

Run the full evolution loop. Evaluates all tasks, diagnoses failures, proposes mutations, re-evaluates.

```bash
kairn evolve run                        # 5 iterations (default)
kairn evolve run --iterations 3         # Custom iteration count
kairn evolve run --task <task_id>       # Run a single task
kairn evolve run --parallel 4           # Parallel task evaluation (4 concurrent)
kairn evolve run --runs 3               # Run each task 3 times, report mean ± stddev
```

**How it works (the loop):**

1. **Evaluate** — Run each eval task by spawning Claude Code in an isolated workspace. Capture full traces:
   - stdout, stderr
   - MCP tool calls (which tools, inputs, outputs)
   - Files changed (diffs)
   - Execution time, pass/fail status

2. **Diagnose** — A proposer agent (Opus) reads the full trace filesystem and performs causal reasoning:
   - "Task A failed because CLAUDE.md doesn't mention the /api path"
   - "Task B passed on iteration 1 but regressed on iteration 3 — the new security rule broke it"
   - "Tasks A and C both needed /project:fix but there's no /project:fix command"

3. **Mutate** — Propose minimal, targeted changes to the harness:
   - `replace`: Update a section in CLAUDE.md, a command, a rule
   - `add_section`: Insert new guidance into CLAUDE.md
   - `create_file`: Add a new command or rule
   - `delete_section`: Remove contradictory or bloat sections
   - `delete_file`: Remove unused commands/rules
   - `add_intent_pattern`: Add a new natural language pattern (v2.5.0)
   - `modify_intent_prompt`: Improve the Tier 2 Haiku classifier (v2.5.0)

4. **Re-evaluate** — Run all tasks again with the mutated harness. If scores improve → accept. If scores regress → rollback to previous best.

5. **Repeat** — Iterate N times (default 5). Each iteration cycles through evaluate → diagnose → mutate → re-evaluate.

**Scoring:**
- **pass/fail** (default) — task passes or fails
- **llm-judge** — LLM reads task output and scores (0-100)
- **rubric** — custom weighted scoring function

**Adaptive pruning (v2.2.7):**
On middle iterations, skip slow/expensive tasks above a confidence threshold. Re-run all tasks on the first and last iteration for rigor.

**Anti-regression guards (v2.2.8):**
- `maxMutationsPerIteration` (default: 3) — cap mutations per step
- `maxTaskDrop` (default: 20) — if any single task drops >20 points, rollback
- Loss-weighted proposer focus — proposer reads failures worst-first

#### `kairn evolve report`

Generate a human-readable summary of the evolution run.

```bash
kairn evolve report          # Markdown to stdout
kairn evolve report --json   # Machine-readable JSON
```

Shows:
- Evolution leaderboard (iterations × tasks × scores)
- Per-task trace diffs (what changed between iterations for the same task)
- Counterfactual diagnosis (which mutations helped/hurt which tasks)
- Wall time, token cost, iterations completed

#### `kairn evolve diff <iter1> <iter2>`

Show the harness changes between two iterations.

```bash
kairn evolve diff 0 3   # Show all mutations from baseline to iteration 3
```

#### `kairn evolve apply [--iter N]`

Copy the best (or specified) evolved harness back to `.claude/`.

```bash
kairn evolve apply         # Copy best iteration to .claude/
kairn evolve apply --iter 3    # Copy iteration 3 specifically
```

---

## Tool Registry

Kairn ships with **28 curated MCP servers** across 8 categories. Tools are auto-selected based on your workflow — fewer tools = less context bloat = better agent performance.

| Category | Tools |
|----------|-------|
| **Reasoning** | Context7, Sequential Thinking |
| **Code & DevTools** | GitHub MCP, Chrome DevTools |
| **Search & Research** | Exa, Brave Search, Firecrawl, Perplexity |
| **Browser Automation** | Playwright, Browserbase |
| **Data & Infrastructure** | PostgreSQL, Supabase, SQLite, Docker, Vercel |
| **Communication** | Slack, Notion, Linear, AgentMail, Gmail |
| **Security** | Semgrep, security-guidance |
| **Design** | Figma, Frontend Design |

---

## How the Pipeline Works

### Generation (kairn describe / kairn optimize)

1. **User input** — intent string or scanned project profile
2. **Clarification** (optional) — 3-5 yes/no questions to refine workflow
3. **Pass 1: Skeleton** — LLM selects minimal tool set and outlines the project
4. **Pass 2: Plan** — @orchestrator reads skeleton, emits a compilation plan (what agents/commands/rules to generate, in what phases)
5. **Pass 3: Specialist agents** — parallel fan-out to @sections-writer, @command-writer, @agent-writer, @rule-writer, @doc-writer, @skill-writer — each produces typed HarnessIR nodes
6. **Pass 3c: Linker** — validates cross-references between commands ↔ agents ↔ rules
7. **Pass 4: Assembly** — deterministic generation of `settings.json`, `.mcp.json`, intent patterns, hooks
8. **Write files** — `.claude/` directory + `.mcp.json` + `.env` (with masked keys)

### Evolution (kairn evolve run)

```
Baseline (.claude/ snapshot)
      │
      ▼
  Iteration 1
  ├─ Evaluate: run all tasks, capture traces
  ├─ Diagnose: proposer reads traces, reasons about failures
  ├─ Mutate: generate 1-3 harness mutations
  ├─ Re-evaluate: run all tasks again
  └─ Accept/rollback based on score improvement
      │
      ▼
  Iteration 2, 3, 4, 5...
      │
      ▼
  Best harness (apply to .claude/)
```

Each iteration is independent and can be retried. The proposer has memory of all prior iterations (v2.4.0 experience replay, coming soon).

### Self-Learning (v2.5.0)

```
Tier 1: regex hook intercepts prompt
        ├─ Matches pattern? → route to command + inject context
        └─ No match? → fallthrough to Tier 2

Tier 2: Haiku prompt hook
        ├─ Classify intent
        ├─ Route to command if confident
        └─ Log routing attempt (for learning)

SessionStart: intent-learner.mjs
        ├─ Read intent-log.jsonl (recent tier 2 routings)
        ├─ Promote recurring patterns to regex
        ├─ Update intent-router.mjs
        └─ Write audit trail
```

Over time, more patterns become regex (fast, free) instead of Haiku (slow, $0.001).

---

## Example Workflow

### Scenario: Build a Next.js API

```bash
cd /tmp/my-api
git init

kairn describe "Next.js REST API with Prisma ORM and PostgreSQL. OAuth login, JWT auth, rate limiting."

# Output:
# ✔ Pass 1: Selected 7 tools (GitHub, PostgreSQL, Vercel, Semgrep, Docker, Context7, Sequential Thinking)
# ✔ Pass 2: @orchestrator planned 6 agents across 3 phases
# ✔ Pass 3: Specialist agents generated 8 commands, 4 rules, 3 agents, 2 skills (73 lines in CLAUDE.md)
# ✔ Pass 4: Configured 2 MCP servers (PostgreSQL + GitHub)
# 
# Commands:
#   /project:help      Show available commands
#   /project:plan      Draft the API spec
#   /project:develop   Full development pipeline
#   /project:test      Run test suite
#   /project:fix       Issue-driven bug fixing
#   /project:deploy    Deploy to Vercel
#   /project:security  Audit for vulnerabilities
#   /project:batch     Run batches of independent tasks
#
# Env keys needed:
#   POSTGRES_URL
#   JWT_SECRET
#   GITHUB_TOKEN
#   VERCEL_TOKEN
#
# Paste your secrets (or press enter to skip):
# POSTGRES_URL: ***
# JWT_SECRET: ***
# GITHUB_TOKEN: (skipped)
# VERCEL_TOKEN: (skipped)
#
# Ready! Run: $ claude

claude   # Start Claude Code with the generated harness

# In Claude Code:
# > /project:plan
# Drafts the API specification with OAuth flow, database schema, endpoint design
#
# > /project:develop feature/auth
# Full pipeline: specs feature in detail, plans implementation, TDD red→green→refactor,
# writes tests, runs security audit, updates docs
#
# > /project:fix
# Shows recent issues, user picks one, Claude researches the bug, fixes it, runs tests
```

### Scenario: Optimize an Existing Project

```bash
cd /path/to/existing/next-app
# It has a manual .claude/ directory

kairn optimize

# Output:
# ✔ Scan: TypeScript, Next.js, 47 dependencies, 8 scripts
#
# Harness Audit:
#   CLAUDE.md: 187 lines ✓ (good)
#   MCP servers: 4
#   Commands: 5 (/help, /plan, /code, /test, /deploy)
#   Rules: 2 (security, continuity)
#
# Issues found:
#   ⚠ Missing /project:develop command (full development pipeline)
#   ⚠ No path-scoped rules (api.md, testing.md for different code domains)
#   ⚠ Hooks not configured (missing destructive command blocking)
#
# Generate optimized environment? This will overwrite existing .claude/ files.
# > Yes
#
# ✔ Environment compiled in 12s
# ✔ Files written: 4 new, 3 modified, 1 unchanged
#
# Ready! Run: $ claude
```

### Scenario: Evolve the Harness

```bash
# Harness is generated and working. Set up evolution:

kairn evolve init

# Auto-generated 5 eval tasks based on CLAUDE.md + project structure:
#   task-1: "Implement user profile page"
#   task-2: "Add password reset flow"
#   task-3: "Refactor authentication middleware"
#   task-4: "Write E2E tests for checkout flow"
#   task-5: "Update API documentation after feature release"

kairn evolve baseline    # Snapshot current .claude/ as iteration 0

kairn evolve run --iterations 5

# Iteration 1/5
#   Evaluating... [task-1] pass [task-2] fail [task-3] pass [task-4] fail [task-5] pass
#   Score: 3/5 (60%)
#
#   Diagnosing failures...
#   - Task 2 failed: "password reset" not mentioned in CLAUDE.md. Need /project:email command.
#   - Task 4 failed: E2E tests failed because missing /project:test. Added but not documented.
#
#   Proposing mutations:
#     - Add /project:email command with SMTP integration guidance
#     - Update CLAUDE.md "Authentication" section with password reset flow
#     - Add e2e.md path-scoped rule with Playwright patterns
#
# Iteration 2/5
#   Evaluating with mutated harness...
#   [task-1] pass [task-2] pass [task-3] pass [task-4] pass [task-5] pass
#   Score: 5/5 (100%) ✔ improvement! Accepting mutations.
#
# Iteration 3/5
#   Evaluating...
#   [task-1] pass [task-2] pass [task-3] pass [task-4] pass [task-5] pass
#   Score: 5/5 (100%) — no regression, but no improvement. Proposing refactements...
#   - CLAUDE.md got bloated (142 lines). Moving detail to rules/.
#   Iteration 3 score: 5/5. Accepting.
#
# Iterations 4-5: Scores plateau at 5/5. No more mutations.
#
# Final leaderboard:
#   Iteration 0 (baseline):   60% (3/5)
#   Iteration 1:              60% (3/5)
#   Iteration 2:             100% (5/5) ← best
#   Iteration 3:             100% (5/5)
#   Iteration 4:             100% (5/5)
#   Iteration 5:             100% (5/5)

kairn evolve report    # Detailed markdown summary
kairn evolve apply     # Copy iteration 2 to .claude/
```

---

## Architecture & Philosophy

### Design Principles

1. **Minimal over complete.** 5 well-chosen tools beat 50 generic ones.
2. **Workflow-specific over generic.** Every file generated relates to your actual task.
3. **Self-improving.** Environments get better with use via the evolution loop and self-learning intent router.
4. **Local-first.** No accounts, no servers, no telemetry. Runs offline with your own LLM key.
5. **Transparent.** You can inspect every generated file. Nothing is hidden.
6. **Security by default.** Every environment includes deny rules, hooks, and guidance.
7. **Prove it.** Evolved harnesses must demonstrably outperform static ones. Claims require measurement.

### What Makes Kairn Unique

**vs. Manual `.claude/` directories:**
- Auto-generated from codebase scan or workflow description
- Intent routing (don't memorize command names)
- Automated evolution (harness improves on real tasks)

**vs. Other agents (OMC, AutoCoder, etc.):**
- Kairn manages the *harness* (instructions, MCP, commands, rules, agents), not agents themselves
- Kairn uses the evolution loop to improve the harness (not the agent capability)
- Two-tier intent routing (regex + Haiku) is unique to Kairn v2.5.0+

**vs. DSPy, Meta-Harness, OpenEvolve:**
- Kairn is CLI-first and project-scoped (not a framework library)
- Integrated with Claude Code's native hooks API (not custom inference)
- Generates MCP configurations alongside harness (full integration)

---

## Roadmap

### v1.x ✅ (Complete)
Local CLI for generating and managing Claude Code environments. Includes advanced patterns (sprint contracts, multi-agent QA, autonomy levels), templates, secrets management, and Claude Code power patterns (TDD, verification, known gotchas).

### v2.x (Current — v2.11.0)
**Kairn Evolve** — automated harness optimization.

- **v2.0.0** ✅ Task Definition & Trace Infrastructure
- **v2.1.0** ✅ The Evolution Loop
- **v2.2.x** ✅ Diagnosis, Reporting, Parallel Evaluation, Anti-Regression Guards
- **v2.3.0** ✅ Eval Quality & Auth (Claude Code subscription OAuth, prompt caching)
- **v2.5.0** ✅ Intent-Aware Harnesses (two-tier routing: regex + Haiku, self-learning)
- **v2.6.0** ✅ Population-Based Training (parallel evolution branches, Thompson Sampling, KL regularization)
- **v2.7.0** ✅ Structured Harness IR (typed mutations, semantic diff, round-trip renderer)
- **v2.8.0** ✅ Evolution Quality (hybrid scoring, prompt caching, Sonnet proposer, targeted re-eval)
- **v2.9.0** ✅ Harness Quality: Anthropic Patterns (sprint contracts, model routing, expanded security)
- **v2.10.0** ✅ Persistent Execution Loop (/project:persist, progress tracking, auto-routing)
- **v2.11.0** 🔄 Multi-Agent Compilation Pipeline (orchestrator → specialist agents → HarnessIR)
- **v2.12.0** ⏳ Polish & Integration (dashboard, watch mode, CI/CD, describe→evolve)

### v3.x (Aspirational)
Broader harness scope (plugins, external tools), paid tool connections, hosted platform, learning system.

---

## Security

- **API keys stay local.** Stored at `~/.kairn/config.json`, never transmitted.
- **Every environment includes security rules.** Deny rules for `rm -rf`, `curl | sh`, reading `.env` and `secrets/`.
- **Curated registry only.** Every MCP server is manually verified.
- **Environment variable references.** MCP configs use `${ENV_VAR}` syntax — secrets never written to config files.
- **Path traversal protection.** Evolution mutations are validated against `../` injection.
- **Hooks in settings.json** — `PreToolUse` hooks block destructive commands, `PostCompact` hooks restore context.

---

## FAQ

**Q: Do I need a Kairn account?**
A: No. Kairn is a local CLI. Your API key for Claude/GPT/Gemini is configured once and stored locally.

**Q: Does Kairn send my code to external servers?**
A: No. All LLM calls use your own API key. Kairn CLI has no backend.

**Q: Can I use Kairn with Claude Code on a team?**
A: Yes. Generate the harness locally, commit `.claude/` to git. Team members run `claude` and get the same environment. The evolve loop runs locally per person (results don't auto-merge).

**Q: What if I want to keep my manual `.claude/` customizations?**
A: Use `kairn optimize --diff` to preview changes. You can selectively accept or reject them. For full control, don't use `optimize` — use `describe` once and then hand-edit the generated files.

**Q: How much does evolution cost?**
A: Depends on your model, iteration count, and task volume. A 5-iteration evolution run with 5 tasks on Anthropic:
- Evaluation: ~100K tokens per iteration (traces logged)
- Proposer: ~80K tokens per iteration (diagnosis + mutation)
- Re-evaluation: ~100K tokens per iteration
- **Total:** ~1.5M tokens = ~$15-50 (Opus/Claude 3) or ~$2-5 (Haiku)

**Q: Can I evolve just one task?**
A: Yes. `kairn evolve run --task <task_id>` runs a single task.

**Q: What's the intent router doing on my prompt?**
A: When you type a prompt like "deploy this", the intent router:
1. Checks Tier 1 regex patterns (fast, free)
2. If no match, sends to Tier 2 (Haiku, ~$0.001)
3. Injects `/project:deploy` into your message context
4. Claude reads that and executes the command

You can disable it with `"enableTier2": false` in settings.json if you find it intrusive.

---

## Contributing

Kairn is open-source. Contributions welcome:
- New MCP servers to the registry
- Eval task templates for new project types
- Improved proposer prompts
- Bug reports and UX feedback

---

## License

MIT

---

*Kairn — from kairos (the right moment) and cairn (the stack of stones marking the path). Choose the right moment. Mark the path for others.*
