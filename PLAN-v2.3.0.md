# PLAN v2.3.0 — Eval Quality & Measurement Rigor

> **Thesis:** The evolution loop works (v2.2.x proved it), but the signal quality is poor — noisy scores, no cost visibility, expensive API calls, and no way to classify why tasks fail. This version makes measurement trustworthy and usage affordable.

---

## Context

**Current state:** The evolve loop runs end-to-end with parallel evaluation, variance controls, adaptive pruning, optimization controls, and rollback-with-reproposal. Proven +7 point improvement on harness-sensitive evals. But:
- Scores are noisy (±10-16 points stddev) — hard to tell real improvement from luck
- No cost tracking — users don't know how many tokens/dollars each iteration costs
- All LLM calls use API key billing — Claude Max subscribers pay twice
- `evolve report` doesn't show variance data even when `--runs N` was used
- CLI version is hardcoded, not read from package.json
- No way to classify WHY a task failed (bad harness? bad task? bad model? bad repo state?)

**Key files:**
- `src/llm.ts` — `callLLM()` with Anthropic/OpenAI providers
- `src/config.ts` — `loadConfig()`, `KairnConfig` type
- `src/types.ts` — `KairnConfig` interface (needs `auth_type` field)
- `src/commands/init.ts` — `kairn init` flow (needs OAuth option)
- `src/evolve/report.ts` — `generateMarkdownReport()`, `generateJsonReport()`
- `src/evolve/runner.ts` — `evaluateAll()`, `runTask()` — token counting goes here
- `src/evolve/scorers.ts` — scoring functions, failure classification goes here
- `src/evolve/types.ts` — `Score`, `EvolveConfig`, `EvolutionReport` types

---

## Steps

### Step 1: Claude Code subscription auth (experimental)
> The highest-value item for cost reduction. Users on Claude Max pay $200/mo for unlimited usage but currently must also buy API credits for evolve.

**New file:** `src/auth/keychain.ts`

```typescript
export interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  subscriptionType: string;
}

export async function readClaudeCodeCredentials(): Promise<OAuthCredentials | null>
export async function refreshAccessToken(credentials: OAuthCredentials): Promise<OAuthCredentials>
export function isTokenExpired(credentials: OAuthCredentials): boolean
```

**Behavior:**
1. Uses macOS `security` CLI to read `Claude Code-credentials` from Keychain
2. Parses JSON, extracts `claudeAiOauth` object
3. Checks `expiresAt` — if expired, attempts refresh
4. Returns access token that can be used as API key with Anthropic SDK

**Modify:** `src/types.ts` — Add `auth_type?: 'api-key' | 'claude-code-oauth'` to KairnConfig

**Modify:** `src/commands/init.ts` — Add "Use Claude Code subscription (experimental)" option during init, with warning message

**Modify:** `src/llm.ts` — Before each LLM call, if `auth_type === 'claude-code-oauth'`, read and refresh token from keychain, use as API key

**Tests:**
- Token parsing from JSON keychain output
- Expiry detection (expired vs valid)
- Fallback to API key when keychain unavailable
- Init flow offers OAuth option

**Acceptance:** `npm run build` passes, `npm test` passes. `kairn init` shows OAuth option. LLM calls work with OAuth token.

---

### Step 2: Confidence intervals in evolve report
> When `--runs N` was used, the report should show mean ± stddev per task, not just a single score.

**Modify:** `src/evolve/report.ts` — `generateMarkdownReport()`

- Iteration table adds ±stddev column when any task has variance data
- Per-task leaderboard shows mean ± stddev
- Best iteration callout includes confidence information

**Modify:** `src/evolve/types.ts` — `EvolutionReport.iterations[].stddev?: number`

**Tests:**
- Report with variance data shows ±stddev
- Report without variance data shows no stddev column
- JSON report includes variance fields

**Acceptance:** `npm run build` passes, `npm test` passes. `kairn evolve report` shows stddev when available.

---

### Step 3: Cost tracking per iteration
> Users need to know how much each evolve run costs in tokens and dollars.

**New file:** `src/evolve/cost.ts`

```typescript
export interface IterationCost {
  inputTokens: number;
  outputTokens: number;
  estimatedUSD: number;
  wallTimeMs: number;
}

export function estimateCost(inputTokens: number, outputTokens: number, model: string): number
```

**Modify:** `src/llm.ts` — Return token usage from Anthropic/OpenAI responses alongside the text

**Modify:** `src/evolve/runner.ts` — Track cumulative token usage per iteration

**Modify:** `src/evolve/loop.ts` — Aggregate cost per iteration, include in IterationLog

**Modify:** `src/commands/evolve.ts` — Display cost in evolution summary

**Tests:**
- Cost estimation for known models (sonnet, opus, gpt-4.1)
- Token usage extracted from mock API responses
- Cost displayed in summary

**Acceptance:** `npm run build` passes, `npm test` passes. Evolution summary shows token count and estimated cost.

---

### Step 4: Failure taxonomy in scoring
> Classify WHY a task failed — was it the harness, the task definition, the model, or the repo state?

**Modify:** `src/evolve/types.ts` — Add to Score:
```typescript
failureCategory?: 'harness' | 'task' | 'model' | 'repo' | 'unknown';
failureReason?: string;
```

**Modify:** `src/evolve/scorers.ts` — After scoring, classify failures:
- `harness`: agent tried but got conventions wrong (score 30-70%)
- `task`: task setup failed or task is ambiguous (setup errors in trace)
- `model`: agent hit token limits, context overflow, or refused (API errors in trace)
- `repo`: git dirty, build broken before agent started (pre-existing issues)
- `unknown`: can't classify

**Modify:** `src/evolve/report.ts` — Show failure taxonomy breakdown in report

**Tests:**
- Classification logic for each category
- Report includes taxonomy when failures present
- Proposer context includes failure categories

**Acceptance:** `npm run build` passes, `npm test` passes. Failures are classified in traces and report.

---

### Step 5: DX quick wins
> Small improvements that reduce friction.

**Fix:** `src/cli.ts` — Read version from package.json instead of hardcoded string

**Modify:** `src/evolve/runner.ts` — Parse tool_calls from runner stdout into `tool_calls.json` trace file (already partially implemented in `parseToolCalls`)

**Tests:**
- CLI `--version` matches package.json
- Tool calls captured in trace when present

**Acceptance:** `npm run build` passes, `npm test` passes. `kairn --version` shows correct version.

---

## Execution Order

```
Step 1 (OAuth)  → Step 2 (report) → Step 3 (cost) → Step 4 (taxonomy) → Step 5 (DX)
   [auth]          [reporting]        [metering]       [diagnostics]       [polish]
```

Steps 1, 2, 4, 5 are independent and can be built in parallel.
Step 3 depends on Step 2 (report displays cost) and modifies `llm.ts` (same as Step 1).

---

## Completion Criteria

- [ ] `kairn init` offers Claude Code OAuth option (experimental, with warning)
- [ ] LLM calls work with OAuth token from macOS Keychain
- [ ] `kairn evolve report` shows mean ± stddev when `--runs N` was used
- [ ] Evolution summary shows token count and estimated cost per iteration
- [ ] Failed tasks are classified by failure category (harness/task/model/repo)
- [ ] `kairn --version` reads from package.json dynamically
- [ ] `npm run build` clean, `npm test` all green
- [ ] Version bumped to 2.3.0
- [ ] ROADMAP.md updated
- [ ] CHANGELOG.md updated

---

## Ralph Loop Prompt

```
/ralph Read PLAN-v2.3.0.md. Execute steps 1-5 in order. For each step: write failing tests first (RED), implement until tests pass (GREEN), then clean up (REFACTOR). Run npm run build and npm test after each step. Commit after each step passes. Create a feature branch and PR per step for user approval. --max-iterations 20 --completion-promise 'Steps 1-5 complete: OAuth auth works, report shows variance, cost tracking works, failure taxonomy works, DX wins shipped'
```
