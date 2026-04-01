# PLAN-v2.2.3 — Mutation Scope Expansion (Bugfix Release)

**Goal:** Expand the evolution loop's mutation vocabulary and harness scope so it can remove bloat and optimize MCP configuration — not just add instructions.

**Design doc:** `docs/design/v2.0-kairn-evolve.md` (Section: v2.2.1 — Mutation Scope Expansion, Bug 3/4/5 details)

**Depends on:** v2.2.2 (Proposer JSON Fix) — all proposer fixes must land first

**Estimated complexity:** Small (7 steps, 2 parallel groups)

---

## Implementation Steps

### Step 1: Expand Mutation Type [parallel-safe]

**What to build:** Add `delete_section` and `delete_file` to the `Mutation.action` union type.

**Files to modify:**
- `src/evolve/types.ts`

**Key implementation details:**
- Change `action: 'replace' | 'add_section' | 'create_file'` → `action: 'replace' | 'add_section' | 'create_file' | 'delete_section' | 'delete_file'`
- `delete_section`: requires `oldText` (the text to remove), `newText` should be empty string
- `delete_file`: only requires `file` and `rationale`, `newText` can be empty string
- No other type changes needed — `oldText` is already optional

**Verification command:**
```bash
npm run build
npm run typecheck
```

**Commit message:** `feat(evolve): add delete_section and delete_file mutation actions`

---

### Step 2: Implement Delete Handlers in Mutator [depends-on: 1]

**What to build:** Handle the two new mutation actions in `applyMutations()`.

**Files to modify:**
- `src/evolve/mutator.ts`

**Key implementation details:**
- After the `create_file` branch in the if/else chain, add:
  - `delete_section`: Read file, verify `oldText` exists in content, replace `oldText` with empty string, write back. Skip if `oldText` is missing or not found in file.
  - `delete_file`: `await fs.rm(filePath, { force: true })`. Use `force: true` so missing files don't throw.
- Security: path traversal check (`..`) already exists above — new actions inherit it
- The `generateDiff` function already handles deleted files (shows all lines as `-`)

**Verification command:**
```bash
npm run build
npm test -- src/evolve/__tests__/mutator.test.ts
```

**Commit message:** `feat(evolve): implement delete_section and delete_file in mutator`

---

### Step 3: Update Proposer JSON Parser for Delete Actions [depends-on: 1]

**What to build:** Allow `parseProposerResponse()` to accept the new action types.

**Files to modify:**
- `src/evolve/proposer.ts`

**Key implementation details:**
- In `parseProposerResponse()`, the action validation currently does:
  ```typescript
  if (action !== 'replace' && action !== 'add_section' && action !== 'create_file') {
    continue;
  }
  ```
  Add `'delete_section'` and `'delete_file'` to the valid set.
- For `delete_section`, require `oldText` (same as `replace`)
- For `delete_file`, `oldText` is not required

**Verification command:**
```bash
npm run build
npm test -- src/evolve/__tests__/proposer.test.ts
```

**Commit message:** `feat(evolve): accept delete mutations in proposer response parser`

---

### Step 4: MCP in Baseline Snapshot [parallel-safe]

**What to build:** Copy `.mcp.json` from project root into the harness snapshot alongside `.claude/`.

**Files to modify:**
- `src/evolve/baseline.ts`

**Key implementation details:**
- In `createBaseline()` (or wherever the iteration 0 harness is created):
  - After copying `.claude/` to `iterations/0/harness/`, also check for `.mcp.json` at project root
  - If it exists, copy it to `iterations/0/harness/mcp.json`
  - If it doesn't exist, skip silently (not all projects use MCP)
- In the harness copy function used between iterations (e.g. `copyDir`), `mcp.json` will be included automatically since it's now inside the harness directory
- Note: file is stored as `mcp.json` (no leading dot) inside harness dir to distinguish it from the project-root `.mcp.json`

**Verification command:**
```bash
npm run build
npm test -- src/evolve/__tests__/baseline.test.ts
```

**Commit message:** `feat(evolve): include .mcp.json in harness baseline snapshot`

---

### Step 5: MCP in Runner Workspace [depends-on: 4]

**What to build:** When creating isolated workspaces, deploy the harness's `mcp.json` as `.mcp.json` at workspace root.

**Files to modify:**
- `src/evolve/runner.ts`

**Key implementation details:**
- In `createIsolatedWorkspace()`, after copying `.claude/` from harness into the workspace:
  - Check if harness contains `mcp.json`
  - If yes, copy it to `.mcp.json` at workspace root (with leading dot)
  - This ensures Claude Code in the isolated workspace sees the evolved MCP config
- Handle both worktree and copy paths

**Verification command:**
```bash
npm run build
npm test -- src/evolve/__tests__/runner.test.ts
```

**Commit message:** `feat(evolve): deploy harness mcp.json into isolated workspaces`

---

### Step 6: Rebalance Proposer Prompt [parallel-safe]

**What to build:** Update the proposer system prompt to consider removals, list all mutation actions, and mention MCP optimization.

**Files to modify:**
- `src/evolve/proposer.ts`

**Key implementation details:**
- Replace the `## Rules` section of `PROPOSER_SYSTEM_PROMPT`:
  - Remove: `"Prefer ADDITIVE changes over replacements when possible."`
  - Add: Balanced guidance for both additions AND removals
  - List all 5 mutation actions: `replace`, `add_section`, `create_file`, `delete_section`, `delete_file`
  - Add MCP guidance: "If mcp.json is in the harness, you can optimize MCP server configuration"
  - Add lean harness principle: "Leaner harnesses perform better — fewer tokens consumed means more context for the actual task"
- Update the `## Output Format` JSON example to show a delete_section example mutation

**Verification command:**
```bash
npm run build
npm test -- src/evolve/__tests__/proposer.test.ts
```

**Commit message:** `feat(evolve): rebalance proposer prompt for add/remove and MCP optimization`

---

### Step 7: Tests [depends-on: 2, 3, 5, 6]

**What to build:** Add/update tests for all changes.

**Files to modify:**
- `src/evolve/__tests__/mutator.test.ts`
- `src/evolve/__tests__/proposer.test.ts`
- `src/evolve/__tests__/baseline.test.ts`

**Key test scenarios:**

**Mutator tests:**
- `delete_section` removes matching text from file
- `delete_section` skips if oldText not found
- `delete_file` removes the file
- `delete_file` on non-existent file doesn't throw (force: true)
- Diff output shows deleted file lines as `-`

**Proposer tests:**
- `parseProposerResponse` accepts `delete_section` action with oldText
- `parseProposerResponse` accepts `delete_file` action without oldText
- `parseProposerResponse` rejects `delete_section` without oldText (same as replace)
- System prompt contains all 5 action types
- System prompt does NOT contain "Prefer ADDITIVE"
- System prompt contains MCP guidance

**Baseline tests:**
- Baseline snapshot includes `mcp.json` when `.mcp.json` exists in project root
- Baseline snapshot works without `.mcp.json` (no error)

**Verification command:**
```bash
npm test
npm run build
```

**Commit message:** `test(evolve): add tests for delete mutations, MCP scope, and balanced proposer`

---

## Parallel Groups

**Group A [parallel, no dependencies]:** Steps 1, 4, 6
- Types expansion, MCP baseline, proposer prompt — all independent files

**Group B [after Group A]:** Steps 2, 3, 5, 7
- Mutator delete handlers, parser update, runner MCP, and tests — depend on types and baseline

---

## Success Criteria (v2.2.3 Complete)

- [ ] All 7 steps committed to feature branch
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (all new + existing tests green)
- [ ] `delete_section` mutation removes text from harness files
- [ ] `delete_file` mutation removes files from harness
- [ ] `.mcp.json` is captured in baseline and deployed to workspaces
- [ ] Proposer prompt lists all 5 mutation actions
- [ ] Proposer prompt no longer says "Prefer ADDITIVE"
- [ ] `parseProposerResponse` accepts delete_section and delete_file
- [ ] Code follows v2.0-v2.2 patterns (no new dependencies)
- [ ] Real test run: `kairn evolve run --iterations 3` applies mutations and improves score
