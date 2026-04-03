# Ralph Loop Task: v2.12.0 — Generation Quality

## Context

**Version:** v2.12.0  
**Branch:** `feature/v2.12.0-generation-quality`  
**Design doc:** `docs/design/v2.12-generation-quality.md`  
**Plan:** `PLAN-v2.12.0.md`  
**ROADMAP:** See `ROADMAP.md` → v2.12.0 section  
**Current state:** main = v2.11.0 (multi-agent compilation pipeline shipped)

## Goal

Fix 6 critical generation flaws exposed by first real-world test on an existing Python/Docker ML project (inferix):

1. `describe` hallucinates project structure for existing repos → gate to `optimize`
2. Intent router false-positives on common English → replace with CLAUDE.md instructions
3. Hardcoded Node.js permissions for all projects → tech-stack-aware permissions
4. Empty scaffold docs waste context → living docs with update hooks
5. Compilation UX is minimal → animated spinner, richer progress
6. .env injection contradicts deny rule → honest handling

## Pre-Steps (before Phase 1)

1. Verify main is at v2.11.0: `git log --oneline -1 main`
2. Create feature branch: `git checkout -b feature/v2.12.0-generation-quality`
3. Bump version: edit `package.json` to `"version": "2.12.0"`
4. Commit: `git commit -am "chore: bump to v2.12.0"`

## Implementation Plan

Read `PLAN-v2.12.0.md` for full specification. Here are the ordered steps:

### Step 1: Existing-Repo Detection in `describe` (parallel-safe)
**Files:** `src/commands/describe.ts`

1. After config check (line ~30), before intent input:
   - List files in `process.cwd()` using `fs.readdir()`
   - Check for existence of: `package.json`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `go.mod`, `Gemfile`, `Dockerfile`, `docker-compose.yml`
   - Check for directories: `src/`, `lib/`, `app/`, `api/`
   - Count non-hidden files
   - If any config file found AND >5 non-hidden files → existing repo
2. If detected, print message and offer confirm prompt:
   ```
   This looks like an existing project with source code.
   For the best results, use: kairn optimize
   ? Run kairn optimize instead? [Y/n]
   ```
3. If confirmed: import `optimizeCommand` from `./optimize.js` and call `optimizeCommand.parseAsync([])`
4. If declined: continue with describe normally

**Tests:** `src/commands/__tests__/describe-hooks.test.ts` — test detection heuristic with mock file systems  
**Commit:** `feat(describe): detect existing repos and redirect to optimize`

### Step 2: Remove Intent Routing Infrastructure (parallel-safe)
**Files:** `src/compiler/compile.ts`, `src/adapter/claude-code.ts`

1. In `compile.ts`:
   - Remove imports: `generateIntentPatterns`, `compileIntentPrompt`, `renderIntentRouter`, `renderIntentLearner`
   - Remove the intent routing block (lines ~242-262): `generateIntentPatterns()`, `compileIntentPrompt()`, `renderIntentRouter()`, `renderIntentLearner()`
   - Remove `intentHooks` from spec assembly
   - Remove `intent_patterns` and `intent_prompt_template` from harness
   - In `buildSettings()`: remove the `UserPromptSubmit` hooks array entirely
   - In `buildSettings()`: remove the `SessionStart` hook for `intent-learner.mjs`

2. In `claude-code.ts` (or whichever adapter writes hooks to disk):
   - Stop writing `intent-router.mjs` and `intent-learner.mjs` to `.claude/hooks/`
   - Stop writing `intent-log.jsonl` and `intent-promotions.jsonl`

3. Do NOT delete `src/intent/` yet — just disconnect it. We'll clean up in a later step.

**Tests:** Update `src/commands/__tests__/describe-hooks.test.ts` — verify no intent hooks in output  
**Commit:** `refactor(compile): remove intent routing from generation pipeline`

### Step 3: Add "Available Commands" Section to CLAUDE.md
**Files:** `src/ir/renderer.ts`

1. In `renderClaudeMd()`, after rendering all sections:
   - If IR has commands, generate an "## Available Commands" section
   - List each command with its name and first-line description:
     ```markdown
     ## Available Commands
     When the user explicitly asks to run a workflow, use the appropriate command:
     - `/project:build` — Build the Docker image
     - `/project:test` — Run the full test suite
     ...
     Only route when the user's clear intent is to execute a workflow.
     Never route questions, discussions, or code reviews.
     ```
   - Extract description from first non-heading line of each command's content

2. This section is generated deterministically from IR — no LLM needed.

**Tests:** `src/ir/__tests__/renderer.test.ts` — verify "Available Commands" section appears with correct commands  
**Commit:** `feat(renderer): add Available Commands section to CLAUDE.md`

### Step 4: Tech-Stack-Aware Permissions
**Files:** `src/compiler/compile.ts`

1. Refactor `buildSettings()`:
   - Replace hardcoded `allow` list with dynamic derivation
   - Always include: `"Read"`, `"Write"`, `"Edit"`
   - Check `skeleton.outline.tech_stack` for each language/tool:
     - Python detected → add `Bash(python *)`, `Bash(pip *)`, `Bash(pytest *)`, `Bash(uv *)`
     - TypeScript/JavaScript/Node → add `Bash(npm run *)`, `Bash(npx *)`
     - Rust → add `Bash(cargo *)`
     - Go → add `Bash(go *)`
     - Ruby → add `Bash(bundle *)`, `Bash(rake *)`
     - Docker → add `Bash(docker *)`, `Bash(docker compose *)`
   - If no language matched, include a conservative default set

2. Update PostToolUse formatter hook:
   - Existing: adds prettier hook when TS/JS detected (keep this)
   - New: add ruff/black hook when Python detected:
     ```json
     {
       "matcher": "Edit|Write",
       "hooks": [{
         "type": "command",
         "command": "FILE=$(cat | jq -r '.tool_input.file_path // empty') && [ -n \"$FILE\" ] && [[ \"$FILE\" == *.py ]] && ruff format \"$FILE\" 2>/dev/null || true"
       }]
     }
     ```

**Tests:** `src/compiler/__tests__/compile.test.ts` — test permissions for Python, Node, Go, Docker, mixed projects  
**Commit:** `feat(compile): tech-stack-aware permissions and formatter hooks`

### Step 5: Honest .env Handling
**Files:** `src/compiler/compile.ts`

1. In `buildSettings()`:
   - Remove the SessionStart hook that injects .env into CLAUDE_ENV_FILE
   - Keep the SessionStart welcome hook (the `.toured` check)
   - Make `Read(./.env)` deny conditional:
     - If `skeleton.tools.some(t => t.auth === 'env-key')` or skeleton indicates env vars → do NOT deny `.env`
     - Otherwise → keep `Read(./.env)` in deny list

2. In `renderClaudeMd()` (via renderer.ts):
   - If project uses env vars, add a section:
     ```markdown
     ## Environment Variables
     This project uses environment variables. Expected:
     - `DATABASE_URL` — Database connection string
     - `API_KEY` — External service API key
     Set these in your shell before starting Claude.
     ```
   - Populated from skeleton's tool requirements and .env.example keys (from scanner)

**Tests:** Verify .env injection hook absent, deny rule conditional  
**Commit:** `fix(compile): remove .env injection, make deny rule honest`

### Step 6: Living Docs
**Files:** `src/adapter/claude-code.ts`, `src/compiler/compile.ts`, `src/compiler/agents/doc-writer.ts`

1. In `claude-code.ts` → `writeEnvironment()`:
   - Before writing each doc file, check if content matches placeholder pattern:
     - Contains `(Add decisions here as they are made)` or `(Add learnings here as they are discovered)`
     - Or total non-header content < 50 characters
   - If placeholder: skip writing this file

2. In `buildSettings()` → PostToolUse hooks:
   - Add a prompt hook for doc updates:
     ```json
     {
       "matcher": "Write|Edit",
       "hooks": [{
         "type": "prompt",
         "prompt": "If this change involves an architectural decision, debugging insight, or task completion, consider updating .claude/docs/. Only update if genuinely useful — don't add noise."
       }]
     }
     ```

3. In `doc-writer.ts`:
   - Update system prompt to include: "If you cannot produce meaningful content for a document (only template placeholders), return an empty content field. Empty is better than filler."

**Tests:** Verify placeholder docs filtered, prompt hook present  
**Commit:** `feat(compile): living docs with update hooks, filter empty scaffolds`

### Step 7: Compilation UX
**Files:** `src/ui.ts`, `src/compiler/batch.ts`

1. In `createProgressRenderer()`:
   - Add spinner frames: `const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];`
   - Replace `◐` with animated frame cycling (increment index in `updateElapsed`)
   - Add cumulative timer line at top of render output: `Total elapsed: 45s`
   - Show estimated time remaining: `~30s remaining` (from `estimateTime()` - elapsed)

2. In `batch.ts` → `executePlan()`:
   - Emit richer progress events including agent names:
     ```
     Pass 3 (phase-a): Writing sections, rules, docs... [5s]
     ```
   - Include item names from plan in progress message

**Tests:** Snapshot tests for progress output format  
**Commit:** `feat(ui): animated spinner, cumulative timer, richer progress`

### Step 8: Delete Intent Infrastructure
**Files:** `src/intent/` (entire directory)

1. Delete:
   - `src/intent/patterns.ts`
   - `src/intent/prompt-template.ts`
   - `src/intent/router-template.ts`
   - `src/intent/learner-template.ts`
   - `src/intent/types.ts`
   - `src/intent/__tests__/` (all test files)

2. Remove any remaining imports of intent modules elsewhere in codebase

3. Update `src/types.ts` if `EnvironmentSpec` still references intent fields:
   - Remove `intent_patterns` and `intent_prompt_template` from harness type
   - Or mark as optional with `?`

**Tests:** `npm run build` succeeds, `npx vitest run` passes (intent tests gone, no broken imports)  
**Commit:** `refactor: remove intent routing infrastructure (replaced by CLAUDE.md instructions)`

### Step 9: Integration & Regression
**Files:** Various

1. Full regression: `npx vitest run` — all existing tests must pass
2. Build: `npm run build` — clean build
3. CLI smoke test: `node dist/cli.js describe --help`
4. CLI smoke test: `node dist/cli.js optimize --help`
5. If possible: manual test `kairn describe` in empty dir → should work normally
6. If possible: manual test `kairn describe` in ~/Projects/inferix → should redirect to optimize

**Commit:** `test: integration and regression tests for v2.12.0`

### Step 10: Finalize
1. `npm run build` — must succeed
2. `npx vitest run` — all tests pass
3. Update CHANGELOG.md with v2.12.0 entry
4. `node dist/cli.js --help` — verify commands
5. `git log --oneline -15` — verify commit history

**Commit:** `chore: bump to v2.12.0, update CHANGELOG`

## Key Constraints

- **TDD mandatory:** RED → GREEN → REFACTOR for every step
- **Strict TypeScript:** no `any`, no `ts-ignore`, `.js` extensions on imports
- **Max 3 fix rounds** in review phase
- **Preserve all existing tests** that aren't intent-related — none may break
- **Backward compatible:** existing environments continue to work

## Success Criteria

1. `kairn describe` in existing repo → detects and offers optimize redirect
2. `kairn describe` in empty dir → works as before
3. Generated settings.json has NO intent-router/intent-learner hooks
4. Generated settings.json has correct permissions for detected tech stack
5. Generated CLAUDE.md has "Available Commands" section listing all commands
6. No .env injection hook in generated settings.json
7. Empty template-only docs are NOT written to disk
8. Compilation shows animated spinner with cumulative timer
9. All existing tests pass (with intent tests removed)
10. `npm run build` clean
