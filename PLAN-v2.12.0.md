# PLAN v2.12.0 — Generation Quality

**Status:** Ready for implementation  
**Priority:** High — first real-world test exposed critical generation flaws  
**Source:** Claude Code feedback on kairn-generated environment for `inferix` (Python/Docker ML inference project)  
**Branch:** `feature/v2.12.0-generation-quality`  
**Design doc:** `docs/design/v2.12-generation-quality.md`  
**Ralph task:** `RALPH-TASK.md`

---

## Problem Statement

Running `kairn describe` on an existing repository with real code produces a .claude/ environment that:
1. Halluccinates the project structure in CLAUDE.md (invented `app/api/`, `app/models/`, `main.py` — none exist)
2. Generates intent routing patterns that false-positive on common English words ("check", "run", "help")
3. Auto-promotes broader patterns over time via intent-learner (regression by design)
4. Hardcodes Node.js permissions (`npm run *`, `npx *`) for a Python project
5. Generates empty scaffold docs (DECISIONS.md, LEARNINGS.md) that waste context
6. Injects .env values via SessionStart hook while simultaneously denying `Read(./.env)` — security contradiction

The rules, safety hooks (PreToolUse destructive command blocking, PostCompact context restore), and slash commands were praised as strong.

---

## Changes

### 1. Gate `describe` to `optimize` for existing repos

**File:** `src/commands/describe.ts`

When `kairn describe` is run in a directory with existing source code, detect it early and redirect to `kairn optimize`.

**Detection heuristic** (run before clarification flow):
```
Has any of: package.json, pyproject.toml, requirements.txt, Cargo.toml, go.mod, Gemfile, 
            Dockerfile, docker-compose.yml, src/, lib/, app/, api/
AND the directory has >5 non-hidden files
```

**Behavior when detected:**
- Print: `This looks like an existing project with source code.`
- Print: `For the best results, use: kairn optimize`
- Print: `(kairn describe is designed for new projects or greenfield descriptions)`
- Offer a confirm prompt: `Run kairn optimize instead? [Y/n]`
- If yes: call `optimizeCommand.parseAsync()` (programmatic redirect)
- If no: continue with describe as-is (user override)

**Files to modify:**
- `src/commands/describe.ts` — add detection + redirect after config check, before intent input

---

### 2. Replace intent routing with CLAUDE.md instructions + optional prompt hook

**Problem:** Regex patterns on single words ("test", "fix", "run", "help", "check", "status", "build") fire on normal conversation. The intent-learner auto-promotes patterns, making it worse over time. Tier 2 LLM fallback runs on every message.

**New approach:**

A. **CLAUDE.md routing section** (portable, works with any LLM agent):
Add a section to the rendered CLAUDE.md that lists available commands with natural descriptions. This is generated from the IR commands.

```markdown
## Available Commands
When the user explicitly asks to run a workflow, use the appropriate command:
- `/project:build` — Build the Docker image
- `/project:test` — Run the full test suite
- `/project:deploy` — Deploy with safety checks
- `/project:lint` — Lint and format code
...

Only route to a command when the user's clear intent is to execute a workflow.
Never route questions, discussions, code reviews, or exploratory conversations.
When uncertain, ask the user what they want — don't assume.
```

B. **Optional strict prompt hook** (Claude Code only):
Replace the Tier 2 LLM prompt with a much stricter one in `settings.json`. No UserPromptSubmit hooks by default — only add if autonomy level >= 2.

If generated (autonomy level 2+), the prompt hook should be:
```
You are routing user intent to project commands. ONLY route if the user EXPLICITLY 
asks to perform one of these actions. If they're asking a question, discussing code, 
or the intent is ambiguous, respond naturally — do NOT route.

Commands: [list]

Respond with ONLY the command name if routing, or "NONE" if not routing.
```

C. **Remove entirely:**
- `intent-router.mjs` (regex router)
- `intent-learner.mjs` (auto-promotion)
- `intent-log.jsonl` (usage logging)
- `intent-promotions.jsonl` (promotion history)
- Tier 2 LLM prompt from settings.json UserPromptSubmit hooks
- The UserPromptSubmit hook entry that runs intent-router.mjs
- The SessionStart hook entry that runs intent-learner.mjs

**Files to modify:**
- `src/compiler/compile.ts` — remove `generateIntentPatterns`, `compileIntentPrompt`, `renderIntentRouter`, `renderIntentLearner` calls. Remove `intentHooks` from spec assembly.
- `src/ir/renderer.ts` — add "Available Commands" section to CLAUDE.md rendering
- `src/compiler/compile.ts` → `buildSettings()` — remove UserPromptSubmit hooks for intent routing, remove SessionStart hook for intent-learner
- `src/intent/` — delete entire directory (patterns.ts, prompt-template.ts, router-template.ts, learner-template.ts, types.ts) OR keep but don't call
- `src/adapter/claude-code.ts` — stop writing intent-router.mjs, intent-learner.mjs to disk

---

### 3. Tech-stack-aware permissions

**File:** `src/compiler/compile.ts` → `buildSettings()`

Current: always generates `Bash(npm run *)`, `Bash(npx *)` in allow list.

Fix: derive permissions from `skeleton.outline.tech_stack`:

```typescript
const allow = ["Read", "Write", "Edit"];

// Language-specific permissions
if (techStack.some(t => t.includes('python'))) {
  allow.push("Bash(python *)", "Bash(pip *)", "Bash(pytest *)", "Bash(uv *)");
}
if (techStack.some(t => t.includes('typescript') || t.includes('javascript') || t.includes('node'))) {
  allow.push("Bash(npm run *)", "Bash(npx *)");
}
if (techStack.some(t => t.includes('rust'))) {
  allow.push("Bash(cargo *)");
}
if (techStack.some(t => t.includes('go'))) {
  allow.push("Bash(go *)");
}
if (techStack.some(t => t.includes('ruby'))) {
  allow.push("Bash(bundle *)", "Bash(rake *)");
}
if (techStack.some(t => t.includes('docker'))) {
  allow.push("Bash(docker *)", "Bash(docker compose *)");
}
```

Also: the PostToolUse prettier hook already checks for TS/JS. Keep that conditional. For Python projects, consider adding a ruff/black formatter hook equivalent.

---

### 4. Docs scaffolding → living docs with update hooks

**Current:** Generates empty DECISIONS.md, LEARNINGS.md, SPRINT.md with placeholder rows. These are context noise.

**New approach:**

A. **Don't generate empty docs.** If the doc-writer agent produces only template content (detectable: contains "(Add decisions here as they are made)"), skip writing that file.

B. **Add a PostToolUse prompt hook** that reminds Claude to update docs after meaningful changes:
```json
{
  "matcher": "Write|Edit",
  "hooks": [{
    "type": "prompt",
    "prompt": "If this change involves an architectural decision, debugging insight, or task completion, consider updating the relevant file in .claude/docs/ (DECISIONS.md, LEARNINGS.md, or SPRINT.md). Only update if genuinely useful — don't add noise."
  }]
}
```

This means docs start empty/nonexistent and grow organically through use.

**Files to modify:**
- `src/adapter/claude-code.ts` — add filter: skip writing doc files if content matches placeholder pattern
- `src/compiler/compile.ts` → `buildSettings()` — add PostToolUse prompt hook for doc updates
- `src/compiler/agents/doc-writer.ts` — update prompt to generate substantive content or nothing (prefer no output over template filler)

---

### 5. Better compilation UX

**Current:** `createProgressRenderer()` in `src/ui.ts` shows:
- `◐ Pass 1: Analyzing... [0s]` → `✔ Pass 1: Selected 3 tools (tool-a, tool-b, tool-c) — 5s`
- Per-phase elapsed timer (updates every 1s)

**Improvements:**

A. **Animated spinner** — cycle through frames: `◐ ◓ ◑ ◒` or `⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏` (braille dots, like ora)
   - Already using `ora` in optimize.ts but NOT in describe.ts's progress renderer
   - Switch `createProgressRenderer` to use ora-style frames in the interval

B. **Cumulative elapsed timer** — show total time at top: `Total: 45s`

C. **Phase descriptions** — instead of just "Pass 3 (phase-a): Running 4 agents...", show what each agent is doing:
   - `◐ Writing rules: security, continuity, secrets... [3s]`
   - `◐ Generating commands: build, test, deploy, lint... [5s]`

D. **Estimated time remaining** — use the `estimateTime()` function but subtract elapsed.

E. **Consider:** A small "Did you know?" tip that rotates while waiting (optional, low priority).

**Files to modify:**
- `src/ui.ts` → `createProgressRenderer()` — add spinner frames, cumulative timer
- `src/compiler/batch.ts` — emit richer progress events with agent names
- `src/commands/describe.ts` — pass richer progress info to renderer

---

### 6. Fix .env security contradiction

**Current:** 
- `Read(./.env)` is in the deny list
- SessionStart hook reads .env and injects values into `CLAUDE_ENV_FILE`
- This bypasses the deny rule — security theater

**Fix:**

Remove the .env injection hook entirely. Make the deny rule honest.

In `buildSettings()`:
- If the skeleton indicates env var usage (tools with auth requirements, or detected .env.example), do NOT add `Read(./.env)` to deny. Instead, add to CLAUDE.md: "This project uses environment variables. Expected vars: [list]. Set them in your shell before starting Claude."
- If no env vars needed: keep `Read(./.env)` in deny, don't generate injection hook.
- Either way: remove the SessionStart .env injection hook from all generated settings.json.

**Files to modify:**
- `src/compiler/compile.ts` → `buildSettings()` — remove SessionStart .env hook; make `Read(./.env)` deny conditional
- `src/ir/renderer.ts` — add env var documentation section to CLAUDE.md when applicable

---

## File Impact Summary

| File | Changes |
|------|---------|
| `src/commands/describe.ts` | Add existing-repo detection + redirect to optimize |
| `src/compiler/compile.ts` | Remove intent hook generation, tech-stack-aware permissions, conditional .env deny |
| `src/ir/renderer.ts` | Add "Available Commands" section, add env var docs section |
| `src/adapter/claude-code.ts` | Stop writing intent-router.mjs/intent-learner.mjs, filter empty docs |
| `src/compiler/agents/doc-writer.ts` | Improve prompt to avoid template filler |
| `src/intent/` | Remove or deprecate entire directory |
| `src/ui.ts` | Animated spinner, cumulative timer, richer phase descriptions |
| `src/compiler/batch.ts` | Emit richer progress events |

---

## Testing

1. Run `kairn describe` in ~/Projects/inferix → should detect existing code and redirect to optimize
2. Run `kairn describe` in an empty directory → should proceed normally
3. Run `kairn optimize` in ~/Projects/inferix → should produce accurate CLAUDE.md with real structure
4. Verify generated settings.json has no intent-router/intent-learner hooks
5. Verify generated settings.json has correct permissions for Python (not npm/npx)
6. Verify generated CLAUDE.md has "Available Commands" section
7. Verify no .env injection hook in settings.json
8. Verify empty docs are not written (or are not template-only)
9. Run compilation and verify spinner animation + elapsed timer

---

## Non-Goals (for this release)

- Evolve pipeline improvements (separate release)
- Agent count reduction (Claude's feedback said 11 agents is too many — we disagree; context cost is low)
- CLAUDE.md length optimization (already has a 150-line warning; the problem was hallucinated content, not length)
- MCP server selection improvements (not flagged in this feedback)
