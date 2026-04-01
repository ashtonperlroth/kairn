# Ralph Loop Task — Execute Feature Implementation

## Objective

Implement the next feature milestone using the Ralph Loop with specialized subagents.

When you receive a version (e.g., "v2.0.0" or "v2.1.0"), execute this sequence:

### Phase 0: Orient

1. Read `ROADMAP.md` — find the target version, extract checklist items
2. Read the matching design doc at `docs/design/v*.md`
3. Verify git is clean: `git status`
4. Create/checkout feature branch: `git checkout -b feature/$version` (or verify you're on the branch)

### Phase 1: Plan

Invoke `@architect`:

> "Read ROADMAP.md for v$version and the design doc. Produce a `PLAN-v$version.md` with numbered steps. Each step: what to build, files to create, dependencies, verification command, commit message. Mark `[parallel-safe]` steps. Identify parallel groups: which steps can run simultaneously? Create a dependency graph."

After @architect completes, commit:
```bash
git add PLAN-v$version.md
git commit -m "plan: v$version implementation plan"
```

### Phase 2: Build

Read the generated `PLAN-v$version.md`. Execute steps in order, respecting dependencies.

**For parallel-safe steps (no dependencies):** Spawn multiple `@implementer` instances simultaneously using the @-mention syntax. Example:

> "Use @implementer to execute steps 1, 3, and 5 from PLAN-v2.1.0.md in parallel. Each implementer should: read the assigned step, read the design doc, follow TDD (RED→GREEN→REFACTOR), build, verify, and commit when done."

**For sequential steps:** Spawn one `@implementer` at a time.

For each step (or parallel group):

Invoke `@implementer`:

> "Execute step N from `PLAN-v$version.md`. Read the plan, read the design doc at `docs/design/v*.md`. Follow TDD: write tests first (RED), implement minimum code (GREEN), refactor cleanly (REFACTOR). Run npm run build. Verify step's verification command. Commit when done."

After each step:
- Verify: `npm run build` passes
- Verify: step's verification command passes  
- Verify: commit exists in git log

If a step fails: invoke `@debugger` with the error output.

Continue until all steps complete.

### Phase 3: Quality Gate

Invoke `@reviewer`:

> "Review the implementation of v$version. Check spec compliance: does every item in ROADMAP.md checklist have matching implementation? Check code quality: TS strict mode, error handling, patterns match src/commands/describe.ts and existing code. Output structured PASS/FAIL report with evidence. Be specific about what's missing or wrong."

Read the review output.

### Phase 4: Fix Loop (if needed)

If reviewer reports BLOCKERS or SHOULD-FIX:

Invoke `@debugger`:

> "Fix these review findings: [paste findings]. Read the relevant code, understand the issue, implement the fix, then run npm run build and npm test. When everything passes, commit with a descriptive message."

Then re-invoke `@reviewer` to re-check.

Repeat max 3 times. If still failing, stop and report.

### Phase 5: Finalize

1. Verify:
   ```bash
   npm run build
   node dist/cli.js --help
   ```

2. Final git log:
   ```bash
   git log --oneline -N
   ```
   (Show the last N commits from your feature branch)

3. Report:
   ```
   ━━━ RALPH LOOP COMPLETE ━━━━━━━━━━━━━━━━━━━━
   Version:    v$version
   Commits:    [count] (show git log)
   Review:     PASS
   
   Ready for: merge, ROADMAP/CHANGELOG update, version bump, PR/ship
   ```

---

## Subagent Reference

| Agent | Tools | Role |
|-------|-------|------|
| `@architect` | Read, Glob, Grep | Reads design doc → produces PLAN with deps (Phase 1) |
| `@implementer` | Read, Write, Edit, Bash, Glob, Grep | Executes ONE step using TDD (Phase 2, can parallelize) |
| `@reviewer` | Read, Glob, Grep, Bash | Spec compliance + code quality check (Phase 3) |
| `@debugger` | Read, Write, Edit, Bash, Grep, Glob | Fixes errors/review issues (Phase 2/4) |

---

## Key Rules

1. **Never skip Phase 3** (quality gate) — this is your safety check
2. **Parallel @implementer only for steps marked `[parallel-safe]`** — honor dependencies
3. **All commits use conventional format:** `feat:`, `fix:`, `test:`, `refactor:`, `docs:`
4. **Do NOT bump version or update ROADMAP/CHANGELOG yet** — that's post-merge
5. **Stop after Phase 5** — report completion to overseer (Hermes)
6. **Rollback on stuck build:** If `npm run build` fails for >5 minutes, stop and call `@debugger`

---

## For v2.2.0 Specifically

The design doc is in `docs/design/v2.0-kairn-evolve.md` (same doc covers v2.0-v2.4, section v2.2.0 starts at line ~518).

Key features to implement:
- Counterfactual diagnosis ("mutation X helped task A but hurt task B — why?")
- Per-task trace diffing between iterations
- `kairn evolve report` — Markdown summary of evolution run
- `kairn evolve report --json` — machine-readable for CI
- Evolution leaderboard (iterations × tasks × scores table)
- `kairn evolve diff <iter1> <iter2>` — harness changes between iterations

Builds on v2.1.0: uses `EvolveResult`, `IterationLog`, `Trace`, `Proposal`, `Mutation` types from `src/evolve/types.ts`, and `writeIterationLog()` from `src/evolve/trace.ts`.

PLAN-v2.2.0.md has 10 steps grouped into 3 parallel groups (A: 6 parallel, B: 3 parallel, C: 1 final).
