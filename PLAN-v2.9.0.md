# PLAN v2.9.0 — Harness Quality: Anthropic Patterns

> **Thesis:** Kairn generates good harnesses. But comparative analysis against Anthropic's official harness design guidance, Everything Claude Code (ECC), and Oh-My-ClaudeCode (OMC) reveals 6 specific gaps in what Kairn produces. These are high-ROI improvements to the HARNESS_PROMPT and generated templates — they change what Kairn *outputs*, not how it *evolves*.

**Sources:**
- [Anthropic: Harness Design for Long-Running Apps](https://www.anthropic.com/engineering/harness-design-long-running-apps) — GAN-inspired Generator/Evaluator, sprint contracts, context resets, tool-based eval, pruning principle
- [Everything Claude Code (ECC)](https://github.com/affaan-m/everything-claude-code) — 151 skills, 36 agents, 102 security rules, memory persistence hooks, SessionStart/End lifecycle
- [Oh-My-ClaudeCode (OMC)](https://github.com/yeachan-heo/oh-my-claudecode) — smart model routing (auto-detect complexity → Haiku/Sonnet/Opus), magic keyword routing

---

## Context

**Current state:** Kairn v2.8.0 (feature/targeted-reeval) ships hybrid scoring, prompt caching, and Sonnet-as-default-proposer. The evolution loop is mature. But the HARNESS_PROMPT — what Kairn tells the LLM to generate — hasn't been updated since v1.14. The generated harnesses are missing patterns that Anthropic's own team proved essential.

**Problems this solves:**

1. **No sprint contracts:** `@architect` produces specs but `@verifier` doesn't validate against acceptance criteria. Anthropic proved this is the single most impactful harness pattern — "Force agents to agree on what done looks like before they write code."

2. **Hardcoded agent models:** Every generated agent has a fixed model tier. OMC auto-detects task complexity and routes accordingly, saving 30-50% on tokens for simple tasks.

3. **PostCompact only re-injects:** Anthropic found that full context resets with handoff artifacts outperform compaction for long sessions. "Compaction can preserve the model's anxiety about conversation length."

4. **No memory persistence across sessions:** ECC saves context to `.claude/memory.json` on SessionEnd and loads on SessionStart. Kairn-generated harnesses lose all accumulated context when a session ends.

5. **Thin security layer:** Kairn generates 5 PreToolUse patterns (rm -rf, curl|sh, .env, secrets, DROP TABLE). ECC has 102 rules. The gap is real — SQL injection, path traversal, prompt injection, API key leaks are all unguarded.

6. **No pruning principle:** Anthropic's key insight: "Every piece of a harness assumes a model limitation. When a new model is released, try removing parts." Kairn harnesses only grow — nothing is ever removed.

**Key files affected:**
- `src/compiler/prompt.ts` — HARNESS_PROMPT (primary target — Steps 1, 2, 5, 6)
- `src/templates/hooks.md` — hook templates (Steps 3, 4, 5)
- `src/templates/settings.md` — settings templates (Steps 3, 4)
- `src/ir/types.ts` — agent/hook IR types (Step 2)
- `ROADMAP.md` — version history and principles (Step 6)

---

## Steps

### Step 1: Sprint Contracts in HARNESS_PROMPT
> Anthropic's single highest-ROI pattern. @architect outputs must include acceptance criteria that @verifier validates against before coding starts.

**Modify: `src/compiler/prompt.ts` (HARNESS_PROMPT)**

Add to the `/project:develop` pipeline definition:
- Phase 1 (Spec) must output `## Acceptance Criteria` section with numbered, testable conditions
- Phase 4 (Verify) must validate EACH criterion individually, reporting PASS/FAIL per item
- `@verifier` agent definition gets a `## Contract Validation` section: reads `docs/SPRINT.md` acceptance criteria, runs tests/Playwright/manual checks, produces contract scorecard
- Add to `@architect` agent: "Your spec is a CONTRACT. The verifier will check every criterion. Vague criteria = guaranteed rework."

Also add to `/project:spec` command: "Output must include ## Acceptance Criteria with 3-8 numbered, testable conditions. Each criterion must be independently verifiable."

**Modify: HARNESS_PROMPT `claude_md` template**

Add to the Verification section:
```
## Sprint Contract
Before implementing, confirm acceptance criteria exist in docs/SPRINT.md.
After implementing, verify EACH criterion. Do not mark done until all pass.
```

**Tests: `src/commands/__tests__/describe-hooks.test.ts`**
- Compiled harness includes "Acceptance Criteria" in @architect agent
- Compiled harness includes "Contract Validation" in @verifier agent
- `/project:develop` command references contract validation in Phase 4

**Acceptance:**
- `npm run build && npx tsc --noEmit && npm test` clean
- Generate a test harness with `kairn describe` → verify SPRINT.md template includes acceptance criteria section

**Commit:** `feat(harness): add sprint contract pattern to HARNESS_PROMPT`

---

### Step 2: Smart Model Routing in Agent Templates
> OMC auto-detects complexity and routes to Haiku/Sonnet/Opus. Generated agents should include routing guidance, not hardcoded model tiers.

**Modify: `src/compiler/prompt.ts` (HARNESS_PROMPT)**

Replace hardcoded model assignments in agent definitions with a tiered routing table:

```markdown
## Model Selection (all agents)
- Haiku: simple file edits, linting, formatting, doc updates (<50 lines changed)
- Sonnet: implementation, testing, debugging, code review (50-500 lines)
- Opus: architecture decisions, spec writing, complex refactors (>500 lines or cross-cutting)

Default: Sonnet. Only escalate to Opus when the task involves multi-file architecture or ambiguous requirements.
```

Update each generated agent's frontmatter to include `model: auto` with a `## Model Routing` section explaining when to escalate:
- `@architect` → default Opus (always complex reasoning)
- `@planner` → default Sonnet (structured but not creative)
- `@implementer` → default Sonnet, escalate to Opus for cross-cutting changes
- `@fixer` → default Sonnet, use Haiku for single-file fixes
- `@doc-updater` → default Haiku (mechanical)
- `@linter` → default Haiku (deterministic)
- `@e2e-tester` → default Sonnet (needs reasoning for test design)

**Modify: `src/ir/types.ts`**

Add optional `modelRouting` field to `AgentNode`:
```typescript
modelRouting?: {
  default: 'haiku' | 'sonnet' | 'opus';
  escalateTo?: 'sonnet' | 'opus';
  escalateWhen?: string; // human-readable condition
};
```

**Modify: `src/ir/renderer.ts`**

Render `modelRouting` into agent YAML frontmatter when present.

**Modify: `src/ir/parser.ts`**

Parse `modelRouting` from agent YAML frontmatter when present.

**Tests:**
- Agent IR round-trips with `modelRouting` field
- Generated agents include Model Routing section
- Rendered frontmatter includes `model: auto` when routing is present

**Acceptance:**
- `npm run build && npx tsc --noEmit && npm test` clean
- Generated agents have routing guidance instead of hardcoded models

**Commit:** `feat(harness): add smart model routing to agent templates`

---

### Step 3: Context Reset Protocol
> Anthropic found full resets + handoff artifacts outperform PostCompact re-injection for long sessions. Add as an alternative hook.

**Modify: `src/templates/hooks.md`**

Add new hook template section "Context Reset (Alternative to PostCompact)":
```json
{
  "hooks": {
    "PostCompact": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "cat .claude/CLAUDE.md .claude/docs/SPRINT.md .claude/docs/DECISIONS.md 2>/dev/null | head -200 | jq -Rs '{continue: true, hookSpecificOutput: {hookEventName: \"PostCompact\", additionalContext: (\"CONTEXT RESET — Full project context re-injected:\\n\\n\" + .)}}'"
      }]
    }]
  }
}
```

**Modify: `src/compiler/prompt.ts` (HARNESS_PROMPT)**

Update the PostCompact hook section to offer two strategies:
1. **Re-inject** (current, default): "Re-read CLAUDE.md and SPRINT.md"
2. **Full Reset**: Pipe CLAUDE.md + SPRINT.md + DECISIONS.md content directly into additionalContext via command hook

Add guidance: "For sessions >2 hours or >3 compactions, prefer Full Reset. For short sessions, Re-inject is sufficient."

**Modify: `src/templates/settings.md`**

Add the full reset hook as an option alongside the existing re-inject hook.

**Tests:**
- Hook template includes both re-inject and full reset variants
- Selection guide references session length heuristic

**Acceptance:**
- `npm run build && npx tsc --noEmit && npm test` clean

**Commit:** `feat(harness): add context reset protocol as PostCompact alternative`

---

### Step 4: Memory Persistence Hooks
> ECC persists context across sessions via SessionStart/End hooks. Kairn-generated harnesses should include this pattern.

**Modify: `src/compiler/prompt.ts` (HARNESS_PROMPT)**

Add to "What You Must Always Include":
- A `SessionEnd` hook that saves key context to `.claude/memory.json`
- A `SessionStart` hook that loads `.claude/memory.json` and injects as additionalContext

**Modify: `src/templates/hooks.md`**

Add new section "Memory Persistence (SessionStart/End)":

SessionEnd hook (command type):
```bash
# Extract last 5 decisions, current sprint status, known gotchas
MEMORY=$(jq -n --arg decisions "$(tail -20 .claude/docs/DECISIONS.md 2>/dev/null)" \
               --arg sprint "$(head -30 .claude/docs/SPRINT.md 2>/dev/null)" \
               --arg gotchas "$(grep -A1 '^-' .claude/CLAUDE.md 2>/dev/null | grep -v 'none yet' | head -10)" \
               '{decisions: $decisions, sprint: $sprint, gotchas: $gotchas, timestamp: now | todate}')
echo "$MEMORY" > .claude/memory.json
```

SessionStart hook (command type):
```bash
# Load persisted memory and inject as context
if [ -f .claude/memory.json ]; then
  MEMORY=$(cat .claude/memory.json)
  echo "$MEMORY" | jq -r '{continue: true, hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: ("RESTORED SESSION MEMORY:\n" + (. | tostring))}}'
else
  echo '{"continue": true}'
fi
```

**Modify: `src/templates/settings.md`**

Add SessionStart and SessionEnd hook entries to the settings template.

**Tests:**
- Hook templates include memory persistence section
- Settings template includes SessionStart/End hooks
- Selection guide recommends for "all projects with multi-session workflows"

**Acceptance:**
- `npm run build && npx tsc --noEmit && npm test` clean

**Commit:** `feat(harness): add memory persistence hooks (SessionStart/End)`

---

### Step 5: Expand Security Rules (5 → 20+)
> ECC has 102 security rules. Kairn has 5. Close the gap with 15+ additional patterns covering the most common attack vectors.

**Modify: `src/compiler/prompt.ts` (HARNESS_PROMPT)**

Expand the PreToolUse hook patterns. Current 5:
1. `rm -rf /`
2. `DROP TABLE`
3. `curl | sh`
4. Fork bomb `:(){ :|:& };:`
5. `.env` / `secrets/` file access

Add 15+ new patterns grouped by category:

**Credential Leaks (4 new):**
- API key patterns in Bash output: `grep -qiE '(api[_-]?key|secret|token|password)\s*[:=]'`
- AWS credentials: `AWS_SECRET_ACCESS_KEY|AKIA[0-9A-Z]{16}`
- Private keys: `BEGIN.*PRIVATE KEY`
- `.env.local`, `.env.production`, `credentials.json`, `service-account.json`

**Injection (4 new):**
- SQL injection via Bash: `;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE)\s+`
- Shell injection: `\$\(.*\)|`.*`` (command substitution in untrusted input)
- Path traversal: `\.\./\.\./` (multiple parent traversals)
- Prompt injection in file writes: `<system>|</system>|IGNORE PREVIOUS`

**Destructive Operations (4 new):**
- Force push: `git push.*--force(?!-with-lease)`
- Recursive chmod/chown on root: `ch(mod|own).*-R\s+/`
- Package publish without confirmation: `npm publish(?!.*--dry-run)`
- Database drop: `DROP\s+DATABASE`

**Network (3 new):**
- Reverse shell: `nc\s+.*-e|/dev/tcp/|bash -i`
- Data exfiltration: `curl.*-d.*@|wget.*--post-file`
- Unencrypted credential transmission: `http://.*password|http://.*token`

**Modify: `src/templates/hooks.md`**

Restructure the "Block Destructive Commands" section into categorized subsections with the expanded patterns. Add a "Security Rule Selection Guide" table mapping project type → which categories to enable.

**Tests:**
- Hook template includes all 20+ patterns
- Each pattern has a test case (matches known bad, doesn't match legitimate use)
- `src/commands/__tests__/describe-hooks.test.ts` — compiled settings.json includes expanded deny patterns

**Acceptance:**
- `npm run build && npx tsc --noEmit && npm test` clean
- No false positives on common legitimate commands (`git push`, `npm install`, `curl https://api.example.com`)

**Commit:** `feat(harness): expand security rules from 5 to 20+ patterns`

---

### Step 6: Pruning Policy + ROADMAP Update
> Anthropic's meta-insight: harness complexity should DECREASE as models improve. Document this as a principle and update ROADMAP with v2.8.0 and v2.9.0.

**Modify: `ROADMAP.md`**

1. Redefine v2.8.0 to match what was actually built on feature/targeted-reeval:
```markdown
### v2.8.0 ✅ SHIPPED — Evolution Quality
> Hybrid scoring, Anthropic prompt caching, and proposer model optimization.

- [x] Hybrid scoring — deterministic rubric criteria alongside LLM-as-judge
- [x] Anthropic prompt caching for system prompts (~85% token savings on repeated calls)
- [x] Default proposer model switched from Opus to Sonnet (cost reduction, comparable quality)
- [x] Targeted re-evaluation (run only affected tasks after mutation)
```

2. Add v2.9.0 entry:
```markdown
### v2.9.0 — Harness Quality: Anthropic Patterns
> Comparative analysis against Anthropic's official harness design guidance, ECC (151 skills, 102 security rules), and OMC (smart model routing) revealed 6 gaps in generated harness quality.

- [ ] Sprint contracts — @architect outputs acceptance criteria, @verifier validates per-criterion before coding
- [ ] Smart model routing — agents include tiered routing (Haiku/Sonnet/Opus) based on task complexity
- [ ] Context reset protocol — alternative to PostCompact for long sessions (full reset + handoff artifact)
- [ ] Memory persistence hooks — SessionStart/End save/load .claude/memory.json
- [ ] Expanded security rules — PreToolUse patterns from 5 to 20+ (credential leaks, injection, destructive ops, network)
- [ ] Pruning policy — principle: harness complexity should decrease as models improve
```

3. Add to Principles section:
```markdown
8. **Prune what's no longer load-bearing.** Every harness section assumes a model limitation. When models improve, audit and remove scaffolding that the model handles natively. Harness complexity should decrease over time, not only grow.
```

**Modify: `CHANGELOG.md`**

Add v2.8.0 entry for the work that's already built on feature/targeted-reeval.

**Tests:** None (docs only).

**Acceptance:**
- ROADMAP.md has accurate v2.8.0 (what was built) and v2.9.0 (what's planned)
- Principles section includes pruning policy

**Commit:** `docs: v2.9.0 — ROADMAP, CHANGELOG, pruning policy principle`

---

## Execution Order

```
Step 6 (Docs/ROADMAP)            ← first: establish versioning truth
    │
Step 1 (Sprint Contracts)        ← HARNESS_PROMPT, highest ROI
    │
Step 2 (Smart Model Routing)     ← IR types + HARNESS_PROMPT
    │
    ├── Step 3 (Context Reset)   ← can parallel with Step 4 (both hook templates)
    │
    ├── Step 4 (Memory Persist)  ← can parallel with Step 3
    │
    ▼
Step 5 (Security Rules)          ← after Steps 3+4 (hooks.md modified by both)
```

Steps 3 and 4 can be parallel (they touch different hook event types).
All other steps are sequential.

---

## Complexity Estimate

| Step | New Files | Modified Files | New Tests | Lines (est.) |
|------|-----------|----------------|-----------|-------------|
| 1. Sprint Contracts | 0 | 1 (prompt.ts) | ~5 | ~80 |
| 2. Smart Model Routing | 0 | 3 (prompt.ts, types.ts, renderer.ts, parser.ts) | ~8 | ~120 |
| 3. Context Reset | 0 | 2 (hooks.md, prompt.ts) | ~3 | ~50 |
| 4. Memory Persist | 0 | 3 (hooks.md, settings.md, prompt.ts) | ~4 | ~60 |
| 5. Security Rules | 0 | 2 (hooks.md, prompt.ts) | ~15 | ~150 |
| 6. Docs/ROADMAP | 0 | 2 (ROADMAP.md, CHANGELOG.md) | 0 | ~80 |
| **Total** | **0 new** | **~6 modified** | **~35** | **~540** |

This is a lighter milestone than v2.7.0 (~1600 LOC). Mostly prompt engineering + hook templates + tests.

---

## Pre-Requisites

Before starting this plan:
1. Commit or stash the WIP change in `src/evolve/loop.ts` on feature/targeted-reeval
2. Merge feature/targeted-reeval into main as v2.8.0 (fix the version: `npm version 2.8.0`)
3. Create `feature/v2.9.0-harness-quality` from updated main
4. Run `npm run build && npm test` to confirm clean baseline

---

## Ralph Loop Prompt

```
Read PLAN-v2.9.0.md. Execute steps 1-6 in order (Steps 3 and 4 can be parallel). Step 6 (docs) goes FIRST to establish versioning truth. For each step: implement the change, run npm run build && npx tsc --noEmit && npm test to verify. Commit after each step passes with conventional commit format. After all steps: run the full test suite one final time and report the result.
```
