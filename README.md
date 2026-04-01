# Kairn

> The agent environment compiler. Describe what you want done — get an optimized Claude Code environment. Then evolve it automatically.

Kairn is a CLI that compiles natural language workflow descriptions into minimal, optimal [Claude Code](https://code.claude.com/) agent environments — complete with MCP servers, slash commands, skills, subagents, and security rules.

**v2.1** adds **Kairn Evolve** — an automated optimization loop that runs your agent on real tasks, diagnoses failures from full execution traces, and mutates the harness until performance plateaus. Inspired by [Meta-Harness](https://yoonholee.com/meta-harness/) (Stanford IRIS Lab, 2026).

**No server. No account. Runs locally with your own LLM key.**

## Install

```bash
npm install -g kairn-cli
```

Requires Node.js 18+. The command is `kairn`.

## Quick Start

```bash
# 1. Set up your LLM key
kairn init

# 2. Describe your workflow
kairn describe "Build a Next.js app with Supabase auth"

# 3. Start coding
claude
```

Kairn generates the entire `.claude/` directory — CLAUDE.md, MCP servers, slash commands, skills, agents, rules — tailored to your specific workflow.

## What Gets Generated

```
.claude/
├── CLAUDE.md              # Workflow-specific system prompt
├── settings.json          # Permissions, hooks, and security deny rules
├── commands/              # Slash commands (/project:help, /project:plan, etc.)
├── rules/                 # Auto-loaded instructions (security, continuity)
├── skills/                # Model-controlled capabilities
├── agents/                # Specialized subagents
└── docs/                  # Pre-initialized project memory
.mcp.json                  # Project-scoped MCP server config
.env                       # API keys (gitignored, masked in output)
```

## Commands

### `kairn init`

Interactive setup. Pick your LLM provider and model, paste your API key. Key stays local at `~/.kairn/config.json`.

Supported providers:
- **Anthropic** — Claude Sonnet 4.6, Opus 4.6, Haiku 4.5
- **OpenAI** — GPT-4.1, GPT-4.1 mini, o4-mini, GPT-5 mini
- **Google** — Gemini 2.5 Flash, Gemini 3 Flash, Gemini 2.5 Pro, Gemini 3.1 Pro
- **xAI** — Grok 4.1 Fast, Grok 4.20 (2M context)
- **DeepSeek** — V3.2 Chat, V3.2 Reasoner (cheapest)
- **Mistral** — Large 3, Codestral, Small 4 (open-weight)
- **Groq** — Llama 4, DeepSeek R1, Qwen 3 (free tier)
- **Custom** — any OpenAI-compatible endpoint (local Ollama, LM Studio, etc.)

### `kairn describe [intent]`

The main command. Describe what you want your agent to do, and Kairn compiles an optimal environment.

```bash
kairn describe "Research ML papers on GRPO training and write a summary"
kairn describe "Build a REST API with Express and PostgreSQL" --quick
```

Features:
- **Interactive clarification** — 3-5 questions to understand your project (skip with `--quick`)
- **Multi-pass compilation** — skeleton pass (tool selection) + harness pass (content generation) + deterministic settings
- **Autonomy levels** — choose how autonomous the agent should be (1-4)
- **Secrets collection** — prompted for API keys after generation, written to `.env`

### `kairn optimize [--diff]`

Scan an existing project and optimize its Claude Code environment. Detects language, framework, dependencies, and generates improvements.

```bash
kairn optimize          # Write optimized environment
kairn optimize --diff   # Preview changes before writing
```

### `kairn templates`

Browse and activate pre-built environment templates.

```bash
kairn templates                        # Browse gallery
kairn templates --activate nextjs      # Apply a template
```

Available templates: Next.js Full-Stack, API Service, Research Project, Content Writing.

### `kairn doctor`

Validate the current environment against Claude Code best practices.

### `kairn keys [--show]`

Add or update API keys for MCP servers in the current environment.

### `kairn list` / `kairn activate <env_id>`

Show saved environments and re-deploy them to any directory.

### `kairn evolve`

Automated harness optimization. Run your agent on real tasks, capture traces, and evolve the environment.

```bash
# 1. Initialize — auto-generates project-specific eval tasks via LLM
kairn evolve init

# 2. Snapshot current .claude/ as the baseline
kairn evolve baseline

# 3. Run the evolution loop
kairn evolve run                    # 5 iterations (default)
kairn evolve run --iterations 3     # Custom iteration count
kairn evolve run --task <id>        # Run a single task
```

**How it works:**

1. **Define tasks** — `kairn evolve init` reads your CLAUDE.md and project structure, then uses the LLM to generate 3-5 concrete eval tasks from 6 built-in templates (add-feature, fix-bug, refactor, test-writing, config-change, documentation)
2. **Baseline** — `kairn evolve baseline` snapshots your current `.claude/` directory
3. **Evaluate** — runs each task by spawning Claude Code in an isolated workspace, capturing full traces (stdout, stderr, tool calls, files changed, timing)
4. **Diagnose** — a proposer agent (Opus) reads the full traces and performs causal reasoning to identify why tasks fail
5. **Mutate** — proposes minimal, targeted changes to CLAUDE.md, commands, rules, or agents
6. **Repeat** — re-evaluates with the mutated harness. Rolls back if scores regress.

Scoring: pass/fail (default), LLM-as-judge, or weighted rubric.

## Tool Registry

Kairn ships with 28 curated tools across 8 categories:

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

Tools are selected based on your workflow description. Fewer tools = less context bloat = better agent performance.

## How It Works

1. You describe your workflow in natural language
2. Kairn asks clarifying questions (or skip with `--quick`)
3. **Pass 1:** LLM selects the minimal tool set and outlines the project
4. **Pass 2:** LLM generates all harness content (CLAUDE.md, commands, rules, agents)
5. **Pass 3:** Settings and MCP config generated deterministically from the registry
6. Kairn writes the `.claude/` directory and `.mcp.json`
7. API keys are collected and written to `.env`

The LLM call uses your own API key. Nothing is sent to Kairn servers (there are none).

## Security

- **API keys stay local.** Stored at `~/.kairn/config.json`, never transmitted.
- **Every environment includes security rules.** Deny rules for `rm -rf`, `curl | sh`, reading `.env` and `secrets/`.
- **Curated registry only.** Every MCP server is manually verified.
- **Environment variable references.** MCP configs use `${ENV_VAR}` syntax — secrets never written to config files.
- **Path traversal protection.** Evolution mutations are validated against `../` injection.

## Philosophy

- **Minimal over complete.** 5 well-chosen tools beat 50 generic ones.
- **Workflow-specific over generic.** Every file generated relates to your actual task.
- **Self-improving.** Environments should get better with use, not just at generation time.
- **Local-first.** No accounts, no servers, no telemetry.
- **Transparent.** You can inspect every generated file. Nothing is hidden.

## License

MIT

---

*Kairn — from kairos (the right moment) and cairn (the stack of stones marking the path).*
