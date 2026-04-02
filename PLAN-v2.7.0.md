# PLAN v2.7.0 — Structured Harness IR

> **Thesis:** Raw Markdown mutation is fragile, lossy, and locks Kairn to a single output format. A typed intermediate representation makes mutations composable, diffing semantic, and multi-runtime output tractable. The IR is the foundation for cross-runtime harness compilation and fleet-scale harness optimization.

---

## Context

**Current state:** The entire Kairn pipeline operates on raw strings. `HarnessContent` stores `claude_md: string`. The evolve mutator does string find-and-replace (`replace`, `add_section`, `delete_section`). The diff engine compares characters. After 5 iterations of text mutations, harnesses accumulate formatting artifacts, duplicate sections, and contradictory instructions.

**Problems this solves:**

1. **Fragile mutations:** `replace` fails silently if the exact substring isn't found (common after earlier mutations shifted whitespace). IR mutations target nodes by ID — no string matching needed.

2. **Incoherent diffs:** A section reorder looks like a complete rewrite in character-level diff. IR diffs know "section X moved from position 3 to position 5" — meaningful signal for the proposer.

3. **Bloat without diagnosis:** KL regularization counts lines, but can't tell whether a 10-line addition is a valuable new rule or a duplicate of an existing one. IR-level complexity measurement counts semantic nodes (sections, commands, rules).

4. **Single-runtime lock-in:** `.claude/` output format is hardcoded into the adapter. With an IR, adding a Cursor renderer is a new function — not a rewrite of the compilation pipeline.

**Key files affected:**
- `src/types.ts` — `EnvironmentSpec`, `HarnessContent`
- `src/adapter/claude-code.ts` — `buildFileMap()`, `writeEnvironment()`
- `src/evolve/mutator.ts` — `applyMutations()`, `generateDiff()`
- `src/evolve/proposer.ts` — `readHarnessFiles()`, `buildProposerUserMessage()`
- `src/evolve/loop.ts` — the evolve loop orchestration
- `src/evolve/regularization.ts` — `measureComplexity()`
- `src/evolve/baseline.ts` — `snapshotBaseline()`, `copyDir()`

**Design doc:** [`docs/design/v2.7-harness-ir.md`](docs/design/v2.7-harness-ir.md)

---

## Steps

### Step 1: IR Type Definitions
> Define the complete HarnessIR type model — the data structure that everything else builds on.

**Create: `src/ir/types.ts`**

All types from the design doc:
- `HarnessIR` — top-level IR with meta, sections, commands, rules, agents, skills, docs, hooks, settings, mcpServers, intents
- `HarnessMeta` — project metadata (name, purpose, tech stack, autonomy level)
- `Section` — CLAUDE.md section with id, heading, content, order
- `CommandNode`, `RuleNode`, `AgentNode`, `SkillNode`, `DocNode`, `HookNode`
- `SettingsIR` — structured settings.json
- `McpServerNode` — individual MCP server config
- `IntentNode` — intent routing pattern
- `IRMutation` — discriminated union of all mutation types
- `IRDiff` — structured diff between two IRs
- Factory functions: `createEmptyIR()`, `createSection()`, `createCommandNode()`, etc.

**Tests: `src/ir/__tests__/types.test.ts`**
- `createEmptyIR()` returns valid empty IR
- Factory functions produce correctly shaped nodes
- All node types have required fields

**Acceptance:**
- `npm run build` passes
- `npm test` passes
- `npx tsc --noEmit` clean — all types compile

**Commit:** `feat(ir): define HarnessIR type model`

---

### Step 2: Parser — .claude/ → HarnessIR [parallel-safe with Step 1]
> Read an existing .claude/ directory and produce a HarnessIR. This is the ingestion side of the pipeline.

**Create: `src/ir/parser.ts`**

```typescript
export async function parseHarness(harnessPath: string): Promise<HarnessIR>;
export function parseClaudeMd(content: string): { meta: Partial<HarnessMeta>; sections: Section[] };
export function parseYamlFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string };
export function parseMcpConfig(content: string): McpServerNode[];
export function parseSettings(content: string): SettingsIR;
```

**CLAUDE.md parsing algorithm:**
1. Split content on `^## ` boundaries (regex: `/^## /gm`)
2. First chunk before any `## ` is preamble (include as `preamble` section)
3. Each subsequent chunk: extract heading text, assign section ID by pattern matching:
   - "Purpose" / "About" / "What" → `purpose`
   - "Tech Stack" / "Technology" / "Stack" → `tech-stack`
   - "Commands" / "Key Commands" → `commands`
   - "Architecture" → `architecture`
   - "Conventions" → `conventions`
   - "Verification" → `verification`
   - "Known Gotchas" / "Gotchas" → `gotchas`
   - "Output" → `output`
   - Unrecognized → `custom-{slugified-heading}`
4. Extract `HarnessMeta.techStack` from the tech-stack section (look for code block with language/framework)

**Rules/agents parsing:**
- Check for YAML frontmatter (`---\n...\n---`)
- Extract `paths:` for rules, `model:` and `disallowedTools:` for agents
- Remainder is content

**Settings parsing:**
- Parse JSON
- Extract known structures: `statusLine`, `hooks` (by event type), deny patterns
- Everything else goes into `raw` pass-through

**MCP parsing:**
- Parse `.mcp.json` → extract `mcpServers` object
- Each key becomes a `McpServerNode` with `id = key`

**Tests: `src/ir/__tests__/parser.test.ts`**
- Parse minimal CLAUDE.md (single section) → correct IR
- Parse full CLAUDE.md (7+ sections) → all sections identified with correct IDs
- Parse CLAUDE.md with unknown sections → `custom-*` IDs assigned
- Parse rule with YAML frontmatter → paths extracted
- Parse agent with model frontmatter → model field set
- Parse settings.json → hooks extracted, raw preserved
- Parse .mcp.json → McpServerNode[] with correct IDs
- Parse empty directory → empty IR (no crash)
- Parse directory with only CLAUDE.md → IR with sections only

**Acceptance:**
- `npm run build` passes
- `npm test` passes
- Parser handles real `.claude/` directories from this repo

**Commit:** `feat(ir): add parser — .claude/ directory to HarnessIR`

---

### Step 3: Renderer — HarnessIR → Files
> Deterministic rendering of HarnessIR to output files. This is the output side — the only place that knows about .claude/ format.

**Create: `src/ir/renderer.ts`**

```typescript
export function renderHarness(ir: HarnessIR): Map<string, string>;
export async function renderHarnessToDir(ir: HarnessIR, targetDir: string): Promise<string[]>;
export function renderClaudeMd(meta: HarnessMeta, sections: Section[]): string;
export function renderSettings(settings: SettingsIR): string;
export function renderMcpConfig(servers: McpServerNode[]): string;
export function renderRuleWithFrontmatter(rule: RuleNode): string;
export function renderAgentWithFrontmatter(agent: AgentNode): string;
```

**CLAUDE.md rendering:**
1. Render `# {meta.name}` as title (if present)
2. Sort sections by `order`
3. For each: `{heading}\n\n{content}`
4. Join with `\n\n`

**Settings rendering:**
- Build hooks object from `SettingsIR.hooks`
- Merge with `statusLine`, `denyPatterns`
- Deep-merge with `raw` pass-through (structured fields take precedence)
- Output as `JSON.stringify(result, null, 2)`

**File map construction:**
- `.claude/CLAUDE.md` ← rendered CLAUDE.md
- `.claude/settings.json` ← rendered settings
- `.claude/commands/{name}.md` ← each CommandNode
- `.claude/rules/{name}.md` ← each RuleNode (with YAML frontmatter if paths present)
- `.claude/agents/{name}.md` ← each AgentNode (with YAML frontmatter if model present)
- `.claude/skills/{name}.md` ← each SkillNode
- `.claude/docs/{name}.md` ← each DocNode
- `.claude/hooks/{name}.mjs` ← each HookNode
- `.mcp.json` ← rendered MCP config

**Tests: `src/ir/__tests__/renderer.test.ts`**
- Render empty IR → no files
- Render IR with only sections → CLAUDE.md with correct section order
- Render IR with commands → correct file paths
- Render IR with rule + frontmatter → YAML header in output
- Render IR with agent + model → YAML header with model field
- Render settings IR → valid JSON with hooks structure
- Render MCP servers → valid .mcp.json
- Render is deterministic (same IR → same output, twice)

**Commit:** `feat(ir): add renderer — HarnessIR to .claude/ files`

---

### Step 4: Round-Trip Test (Parser + Renderer)
> Prove that parse(dir) → render → files ≈ original dir. This is the quality gate for Steps 2 and 3.

**Create: `src/ir/__tests__/roundtrip.test.ts`**

- Parse this repo's `.claude/` directory → IR → render → compare with original
- Create a synthetic harness with all node types → write → parse → render → compare
- Verify: all sections present, all commands present, all rules present
- Verify: YAML frontmatter round-trips correctly
- Verify: settings.json round-trips correctly (modulo whitespace)
- Verify: .mcp.json round-trips correctly

**Acceptance:**
- Round-trip test passes on this repo's actual `.claude/` directory
- No content loss (all sections, commands, rules, agents preserved)

**Commit:** `test(ir): add round-trip integration test for parser + renderer`

---

### Step 5: IR Mutations
> Type-safe tree operations that replace the current text-based mutator.

**Create: `src/ir/mutations.ts`**

```typescript
export function applyIRMutation(ir: HarnessIR, mutation: IRMutation): HarnessIR;
export function applyIRMutations(ir: HarnessIR, mutations: IRMutation[]): HarnessIR;
export function validateIRMutation(ir: HarnessIR, mutation: IRMutation): { valid: boolean; reason?: string };
```

**Mutation application rules:**
- `update_section`: Find section by `sectionId`, replace content. Error if section not found.
- `add_section`: Append new section. Error if `sectionId` already exists.
- `remove_section`: Filter out by `sectionId`. Error if not found.
- `add_command`: Append to commands. Error if name collision.
- `update_command`: Find by name, replace content. Error if not found.
- `remove_command`: Filter out by name.
- Same pattern for rules, agents, skills.
- `add_mcp_server` / `remove_mcp_server`: Operate on `mcpServers` array.
- `update_settings`: Deep-set a path in the settings IR.
- `raw_text`: Legacy fallback — apply text mutation to rendered file, re-parse affected section.
- All mutations return a new IR (immutable — never mutate input).

**Validation:**
- `validateIRMutation` checks pre-conditions before applying (target exists, no name collision)
- Returns `{ valid: false, reason: "Section 'conventions' not found" }` on failure

**Tests: `src/ir/__tests__/mutations.test.ts`**
- `update_section` replaces correct section content
- `add_section` adds new section with correct order
- `remove_section` removes the target section only
- `add_command` / `remove_command` modify commands array
- `add_rule` with paths → rule has paths field
- `remove_agent` removes agent by name
- `add_mcp_server` / `remove_mcp_server` modify MCP config
- Applying mutation to non-existent target returns error
- Duplicate `add_section` with same ID returns error
- Mutations are immutable (original IR unchanged)
- `applyIRMutations` applies sequence in order

**Commit:** `feat(ir): add type-safe IR mutations`

---

### Step 6: IR Diff Engine
> Structured comparison of two HarnessIR trees, producing human-readable semantic diffs.

**Create: `src/ir/diff.ts`**

```typescript
export function diffIR(before: HarnessIR, after: HarnessIR): IRDiff;
export function formatIRDiff(diff: IRDiff): string;  // human-readable
```

**Diff algorithm:**
- Sections: compare by ID. Added = in after but not before. Removed = in before but not after. Modified = same ID, different content.
- Commands/rules/agents: compare by name. Same logic.
- MCP servers: compare by ID.
- Settings: deep-compare structured fields.

**`formatIRDiff`:** Renders the diff as human-readable text:
```
Sections:
  + Added: ## New Section
  - Removed: ## Obsolete Section
  ~ Modified: ## Conventions (content changed)

Commands:
  + Added: deploy
  - Removed: old-deploy

MCP Servers:
  + Added: sentry
```

**Tests: `src/ir/__tests__/diff.test.ts`**
- Identical IRs → empty diff
- Added section detected
- Removed command detected
- Modified rule detected (same name, different content)
- Added MCP server detected
- `formatIRDiff` produces readable output

**Commit:** `feat(ir): add semantic diff engine for HarnessIR`

---

### Step 7: Translation Layer (Legacy Mutation → IR Mutation)
> Bridge existing text-based proposer output to IR mutations. This preserves backward compatibility while enabling incremental migration.

**Create: `src/ir/translate.ts`**

```typescript
export function translateMutation(mutation: Mutation, ir: HarnessIR): IRMutation;
export function translateMutations(mutations: Mutation[], ir: HarnessIR): IRMutation[];
```

**Translation rules:**
- `replace` on `CLAUDE.md` → find the section containing `oldText`, emit `update_section` with new content
- `add_section` on `CLAUDE.md` → parse the new text to detect heading, emit `add_section`
- `delete_section` on `CLAUDE.md` → find section containing `oldText`, emit `remove_section`
- `create_file` on `commands/X.md` → emit `add_command` with name=X
- `create_file` on `rules/X.md` → emit `add_rule` with name=X
- `delete_file` on `commands/X.md` → emit `remove_command` with name=X
- `replace` on `rules/X.md` → emit `update_rule` with name=X
- Anything that doesn't map cleanly → emit `raw_text` fallback

**Tests: `src/ir/__tests__/translate.test.ts`**
- Text `replace` on CLAUDE.md → `update_section`
- Text `add_section` on CLAUDE.md → `add_section`
- Text `create_file` on commands/ → `add_command`
- Text `delete_file` on rules/ → `remove_rule`
- Unmappable mutation → `raw_text` fallback

**Commit:** `feat(ir): add legacy mutation translation layer`

---

### Step 8: Wire IR into Evolution Loop
> Replace the text-based mutation pipeline with IR-based pipeline in the evolve loop. This is the integration step.

**Modify: `src/evolve/loop.ts`**
- At loop start: `parseHarness(baselineHarnessPath)` → baseline IR
- After proposer returns mutations: `translateMutations()` → IR mutations
- Apply: `applyIRMutations(currentIR, irMutations)` → new IR
- Render: `renderHarnessToDir(newIR, nextIterDir)` → write files
- Diff: `diffIR(currentIR, newIR)` → store in IterationLog

**Modify: `src/evolve/regularization.ts`**
- `measureComplexity` gains an IR-aware path: count sections, commands, rules, agents directly from IR nodes
- More precise than line counting: adding a 1-line section costs the same as a 50-line section (it's one node)

**Modify: `src/evolve/proposer.ts`**
- `readHarnessFiles` still works (renderer produces files that proposer reads)
- Proposer context now includes IR summary alongside raw files
- Future: proposer reads IR JSON directly (deferred to v2.8.0)

**Modify: `src/evolve/mutator.ts`**
- `applyMutations` becomes a thin wrapper: parse → translate → apply IR mutations → render
- `generateDiff` delegates to `diffIR` + `formatIRDiff`

**Tests: update `src/evolve/__tests__/loop.test.ts`**
- Evolution loop with IR mutations produces valid harness output
- Rollback works with IR (restore from best IR, not file copy)
- KL regularization uses IR node counts

**Tests: update `src/evolve/__tests__/integration.test.ts`**
- Full evolution cycle: baseline → parse → mutate → render → evaluate

**Acceptance:**
- All existing tests still pass (backward compatible)
- Evolution loop produces identical results (or better) with IR pipeline
- `npm run build && npx tsc --noEmit && npm test` all clean

**Commit:** `feat(ir): wire HarnessIR into evolution loop`

---

### Step 9: Wire IR into Compiler (Optional — stretch goal)
> Make the compilation pipeline output IR instead of raw strings. This completes the "IR as single source of truth" goal.

**Modify: `src/types.ts`**
- Add `ir?: HarnessIR` field to `EnvironmentSpec.harness` (alongside existing string fields)

**Modify: `src/compiler/compile.ts`**
- After Pass 2 produces `HarnessContent`, parse it into `HarnessIR`
- Store IR on `EnvironmentSpec.harness.ir`

**Modify: `src/adapter/claude-code.ts`**
- If `spec.harness.ir` exists, use `renderHarness(ir)` instead of building file map from raw strings
- Fall back to current behavior if no IR (backward compatible)

**Tests:**
- Compilation produces valid IR
- Adapter renders from IR when available
- Adapter falls back to strings when IR absent

**Commit:** `feat(ir): wire HarnessIR into compilation pipeline`

---

## Execution Order

```
Step 1 (IR Types)
    │
    ├── Step 2 (Parser)          ← can start in parallel with Step 1
    │
    ▼
Step 3 (Renderer)               ← after Step 1 (needs types)
    │
    ▼
Step 4 (Round-Trip Test)        ← after Steps 2+3
    │
    ├── Step 5 (IR Mutations)    ← after Step 1 (needs types)
    │
    ├── Step 6 (IR Diff)         ← after Step 1 (needs types)
    │
    ▼
Step 7 (Translation Layer)      ← after Steps 5+6
    │
    ▼
Step 8 (Wire into Evolve)       ← after Steps 4+7 (needs all IR pieces + round-trip proof)
    │
    ▼
Step 9 (Wire into Compiler)     ← after Step 8 (stretch goal)
```

Steps 1+2 can be parallel. Steps 5+6 can be parallel (both need only types from Step 1).
Steps 3, 4, 7, 8, 9 are sequential.

---

## Complexity Estimate

| Step | New Files | New Tests | Lines (est.) |
|------|-----------|-----------|-------------|
| 1. IR Types | 1 | ~5 | ~200 |
| 2. Parser | 1 | ~10 | ~250 |
| 3. Renderer | 1 | ~10 | ~200 |
| 4. Round-Trip | 1 | ~5 | ~100 |
| 5. IR Mutations | 1 | ~12 | ~250 |
| 6. IR Diff | 1 | ~8 | ~150 |
| 7. Translation | 1 | ~6 | ~150 |
| 8. Wire Evolve | 0 (modify) | ~8 | ~200 |
| 9. Wire Compiler | 0 (modify) | ~5 | ~100 |
| **Total** | **7 new** | **~69** | **~1600** |

---

## Ralph Loop Prompt

```
Read PLAN-v2.7.0.md. Execute steps 1-8 in order (Steps 1 and 2 can be parallel; Steps 5 and 6 can be parallel after Step 4). For each step: implement the change, run npm run build && npx tsc --noEmit && npm test to verify. Commit after each step passes with conventional commit format. Step 8 integrates everything — verify the full IR-based evolution flow works with mocked proposer before committing. Skip Step 9 unless Steps 1-8 complete cleanly.
```
