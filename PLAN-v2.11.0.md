# PLAN-v2.11.0.md — Multi-Agent Compilation Pipeline

## Overview

Replace the monolithic Pass 2 LLM call in `src/compiler/compile.ts` with a multi-agent pipeline: @orchestrator produces a `CompilationPlan`, 6 specialist agents execute in phased parallel batches producing typed `HarnessIR` nodes, and @linker validates cross-references. This eliminates JSON truncation failures and produces higher quality harnesses.

**Existing test count:** 936 (all must continue passing)  
**Branch:** `feature/v2.11.0-multi-agent-compilation`

---

## Step 1: Multi-Agent Types [parallel-safe]

**What to build:** Define the `CompilationPlan`, `CompilationPhase`, `AgentTask`, `AgentResult`, and `TruncationError` types used by the entire multi-agent pipeline.

**Files to create:**
- `src/compiler/agents/types.ts`
- `src/compiler/agents/__tests__/types.test.ts`

**Dependencies:** None

**TDD approach:**
- RED: Write tests for `TruncationError` (extends Error, carries `agentName` and `tokensUsed` properties), for `AgentName` literal union type, and for type-level validation that `AgentResult` is a proper discriminated union on an `agent` field.
- GREEN: Define the types:
  - `AgentName = 'sections-writer' | 'command-writer' | 'agent-writer' | 'rule-writer' | 'doc-writer' | 'skill-writer'`
  - `CompilationPlan { project_context: string; phases: CompilationPhase[] }`
  - `CompilationPhase { id: string; agents: AgentTask[]; dependsOn: string[] }`
  - `AgentTask { agent: AgentName; items: string[]; context_hint?: string; max_tokens: number }`
  - `AgentResult` — discriminated union with `agent` field (import `Section`, `RuleNode`, `CommandNode`, `AgentNode`, `SkillNode`, `DocNode` from `src/ir/types.ts`)
  - `TruncationError` class extending `Error` with `agentName: string` and `tokensUsed: number`
  - Export a `validatePlan(plan: unknown): CompilationPlan` runtime validator

**Verification:** `npx vitest run src/compiler/agents/__tests__/types.test.ts`

**Commit:** `feat(compiler): add multi-agent types and TruncationError`

---

## Step 2: Truncation Detection in callLLM [depends on Step 1]

**What to build:** Modify `callLLM()` to detect when the LLM response was truncated and throw `TruncationError`.

**Files to modify:**
- `src/llm.ts`
- `src/__tests__/llm.test.ts`

**Dependencies:** Step 1 (imports `TruncationError`)

**TDD approach:**
- RED: Add tests: (1) Anthropic `stop_reason: 'max_tokens'` throws `TruncationError`; (2) OpenAI `finish_reason: 'length'` throws `TruncationError`; (3) Normal stop reasons still return text; (4) `TruncationError` carries agent name when `options.agentName` provided.
- GREEN: Add optional `agentName?: string` to `callLLM` options. Check `response.stop_reason === 'max_tokens'` (Anthropic) and `response.choices[0].finish_reason === 'length'` (OpenAI), throw `TruncationError` if truncated. New parameter is optional — backward compatible.

**Verification:** `npx vitest run src/__tests__/llm.test.ts && npm test`

**Commit:** `feat(llm): detect truncation via stop_reason and throw TruncationError`

---

## Step 3: Batch Execution Engine [depends on Step 1]

**What to build:** Generic batch execution engine that runs a `CompilationPlan` phase-by-phase with concurrency control, merging `AgentResult` values into `HarnessIR`.

**Files to create:**
- `src/compiler/batch.ts`
- `src/compiler/__tests__/batch.test.ts`

**Dependencies:** Step 1 (types)

**TDD approach:**
- RED: Tests for: (1) `executePlan()` executes phases in order; (2) agents within a phase run concurrently; (3) `mergeIntoIR()` correctly merges each `AgentResult` variant; (4) error propagation; (5) `TruncationError` triggers retry with 2x max_tokens; (6) `onProgress` callback invoked; (7) dependency cycle detection; (8) empty plan produces `createEmptyIR()`.
- GREEN: Implement `mergeIntoIR()`, `executePlan()`, and `runWithConcurrency()` (reimplemented locally, not imported from evolve).

**Verification:** `npx vitest run src/compiler/__tests__/batch.test.ts`

**Commit:** `feat(compiler): batch execution engine with concurrency control`

---

## Step 4: @orchestrator Agent [depends on Steps 1, 2]

**What to build:** `generatePlan()` function that takes intent + skeleton → `CompilationPlan` via LLM, with deterministic fallback.

**Files to create:**
- `src/compiler/plan.ts`
- `src/compiler/__tests__/plan.test.ts`

**Dependencies:** Steps 1, 2

**TDD approach:**
- RED: Tests for: (1) produces valid `CompilationPlan` from simple skeleton; (2) complex skeleton produces phased plan; (3) research projects get doc-writer tasks; (4) `generateDefaultPlan()` works when LLM fails; (5) plan always has Phase A with sections/rules/docs writers; (6) validates LLM output, falls back on malformed JSON.
- GREEN: Implement `ORCHESTRATOR_PROMPT`, `generatePlan()`, `generateDefaultPlan()`, `validatePlan()`. Max tokens: 2048, cacheControl: true.

**Verification:** `npx vitest run src/compiler/__tests__/plan.test.ts`

**Commit:** `feat(compiler): @orchestrator compilation planner`

---

## Step 5a: @sections-writer [parallel-safe, depends on Steps 1, 2]

**Files:** `src/compiler/agents/sections-writer.ts`, `src/compiler/agents/__tests__/sections-writer.test.ts`

**TDD:** Mock `callLLM`, verify `Section[]` output with mandatory headings, correct ordering, JSON parsing.

**Commit:** `feat(compiler): @sections-writer specialist agent`

---

## Step 5b: @rule-writer [parallel-safe, depends on Steps 1, 2]

**Files:** `src/compiler/agents/rule-writer.ts`, `src/compiler/agents/__tests__/rule-writer.test.ts`

**TDD:** Mock `callLLM`, verify `RuleNode[]` with mandatory security/continuity rules, path-scoped rules have `paths` array.

**Commit:** `feat(compiler): @rule-writer specialist agent`

---

## Step 5c: @doc-writer [parallel-safe, depends on Steps 1, 2]

**Files:** `src/compiler/agents/doc-writer.ts`, `src/compiler/agents/__tests__/doc-writer.test.ts`

**TDD:** Mock `callLLM`, verify `DocNode[]` with mandatory DECISIONS/LEARNINGS/SPRINT docs.

**Commit:** `feat(compiler): @doc-writer specialist agent`

---

## Step 6a: @command-writer [parallel-safe, depends on Steps 1, 2]

**Files:** `src/compiler/agents/command-writer.ts`, `src/compiler/agents/__tests__/command-writer.test.ts`

**TDD:** Mock `callLLM`, verify `CommandNode[]` with mandatory help command, code project commands, batching for >10 items.

**Commit:** `feat(compiler): @command-writer specialist agent`

---

## Step 6b: @agent-writer [parallel-safe, depends on Steps 1, 2]

**Files:** `src/compiler/agents/agent-writer.ts`, `src/compiler/agents/__tests__/agent-writer.test.ts`

**TDD:** Mock `callLLM`, verify `AgentNode[]` with modelRouting, pipeline agents, batching for >8 items.

**Commit:** `feat(compiler): @agent-writer specialist agent`

---

## Step 6c: @skill-writer [parallel-safe, depends on Steps 1, 2]

**Files:** `src/compiler/agents/skill-writer.ts`, `src/compiler/agents/__tests__/skill-writer.test.ts`

**TDD:** Mock `callLLM`, verify `SkillNode[]`, TDD skill pattern, empty items returns empty array without LLM call.

**Commit:** `feat(compiler): @skill-writer specialist agent`

---

## Step 7: @linker [depends on Step 1]

**What to build:** Cross-reference validation and auto-patching of generated nodes.

**Files to create:**
- `src/compiler/linker.ts`
- `src/compiler/__tests__/linker.test.ts`

**TDD:** Detect broken `@agent` refs in commands, `/project:command` refs in agents. Auto-remove broken refs. Inject missing help command, security/continuity rules. Returns patched `HarnessIR` + `LinkReport`.

**Commit:** `feat(compiler): @linker cross-reference validation`

---

## Step 8: Agent Dispatcher [depends on Steps 5-6]

**What to build:** Central dispatcher routing `AgentTask` to the correct specialist function.

**Files to create:**
- `src/compiler/agents/dispatch.ts`
- `src/compiler/agents/__tests__/dispatch.test.ts`

**TDD:** Verify each agent name dispatches correctly, Phase B agents receive current IR context.

**Commit:** `feat(compiler): agent dispatcher for routing tasks to specialists`

---

## Step 9: Compile Pipeline Refactor [depends on Steps 1-8]

**What to build:** Replace monolithic Pass 2 with orchestrator → batch → linker pipeline.

**Files to modify:**
- `src/compiler/compile.ts` — new pipeline flow
- `src/compiler/prompt.ts` — remove `HARNESS_PROMPT`
- `src/types.ts` — add `ir?: HarnessIR` to `EnvironmentSpec`, update `CompileProgress`

**TDD:** Test `compile()` returns `EnvironmentSpec` with `ir` field, backward-compatible `harness` fields populated from IR, new phase names in progress.

**Commit:** `feat(compiler): multi-agent compilation pipeline replacing monolithic Pass 2`

---

## Step 10: Adapter Updates [depends on Step 9]

**What to build:** Adapters consume `HarnessIR` via renderer when `ir` field present, fallback to legacy.

**Files to modify:**
- `src/adapter/claude-code.ts`
- `src/adapter/hermes-agent.ts`
- `src/commands/activate.ts`

**Commit:** `feat(adapter): consume HarnessIR via renderer with legacy fallback`

---

## Step 11: UX Updates [parallel-safe with Step 10, depends on Step 9]

**What to build:** Multi-phase progress display for compilation.

**Files to modify:**
- `src/ui.ts`
- `src/commands/describe.ts`

**Commit:** `feat(ui): multi-phase compilation progress display`

---

## Step 12: Integration & Regression Tests [depends on Steps 10, 11]

**Files to create:**
- `src/compiler/__tests__/integration.test.ts`
- `src/compiler/__tests__/fixtures/legacy-spec.json`

**Tests:** E2E with mocked LLM, round-trip fidelity, evolve compatibility, backward compat, both adapters, error recovery.

**Commit:** `test(compiler): integration tests for multi-agent pipeline`

---

## Step 13: Finalize [depends on Step 12]

**Tasks:** Version bump, CHANGELOG, ROADMAP, full verification suite.

**Commit:** `chore: bump to v2.11.0, update CHANGELOG and ROADMAP`

---

## Parallelism Map

```
Step 1 ──────────────┐
                     │
Step 2 ──────────────┤ (depends on Step 1)
Step 3 ──────────────┤ (depends on Step 1)
Step 4 ──────────────┤ (depends on Steps 1, 2)
                     │
Step 5a ┐            │
Step 5b ├── parallel ┤ (all depend on Steps 1, 2)
Step 5c ┘            │
                     │
Step 6a ┐            │
Step 6b ├── parallel ┤ (all depend on Steps 1, 2)
Step 6c ┘            │
                     │
Step 7 ──────────────┤ (depends on Step 1)
                     │
Step 8 ──────────────┤ (depends on Steps 5a-c, 6a-c)
                     │
Step 9 ──────────────┤ (depends on Steps 1-8)
                     │
Step 10 ┐            │
Step 11 ┘── parallel ┤ (both depend on Step 9)
                     │
Step 12 ─────────────┤ (depends on Steps 10, 11)
Step 13 ─────────────┘ (depends on Step 12)
```

**Max parallel window:** Steps 5a/5b/5c + 6a/6b/6c + 7 = 7 parallel tracks
