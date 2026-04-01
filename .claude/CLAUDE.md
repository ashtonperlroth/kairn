# Kairn — Agent Environment Compiler

## Purpose
Local-first CLI that compiles natural language intent into optimized Claude Code environments.

## Tech Stack
- TypeScript (strict, ESM), tsup bundler
- Commander.js (CLI), @inquirer/prompts (interactive)
- @anthropic-ai/sdk (compilation LLM call)
- chalk (colors), ora (spinners)

## Commands
```bash
npm run build          # tsup → dist/
npm run dev            # tsup --watch
npx tsx src/cli.ts     # run directly during dev
npm test               # vitest
npm run lint           # eslint src/
npm run typecheck      # tsc --noEmit
```

## Architecture
```
src/cli.ts              → Commander.js entry
src/commands/           → init, describe, list
src/compiler/           → compile.ts, prompt.ts
src/adapter/            → claude-code.ts (EnvironmentSpec → .claude/)
src/registry/tools.json → bundled tool catalog
src/types.ts            → TypeScript types
src/config.ts           → ~/.kairn/config.json
```

## Conventions
- async/await everywhere, no callbacks
- chalk colors: green=success, yellow=warn, red=error, cyan=info
- Errors: catch at command level, friendly message, exit 1
- All file I/O via fs.promises; create dirs if missing
- IDs: `crypto.randomUUID()` prefixed with `env_`
- Envs saved to ~/.kairn/envs/; MCP servers go in .mcp.json

## Key Commands
- `/project:build` — build and typecheck
- `/project:plan` — plan before coding
- `/project:test` — run and fix tests
- `/project:review` — review staged changes
- `/project:commit` — conventional commit
- `/project:status` — live git + test summary
- `/project:fix` — issue-driven fix workflow
- `/project:sprint` — define acceptance criteria
- `/project:spec` — interview-based spec creation
- `/project:prove` — confidence-rated verification
- `/project:grill` — adversarial code review

## Architecture Mandate (Override Brevity Bias)
When implementing features or fixes, do NOT settle for minimal/simple solutions that:
- Band-aid problems instead of fixing root causes
- Leave TODO comments for later refactoring
- Duplicate code when extraction would be cleaner
- Violate SOLID principles to save a few lines

Instead, implement the *architecturally correct* solution. Ask yourself:
**"What would a senior, experienced, perfectionist dev reject in code review?"**
Fix all of it. Proper abstraction > minimal code. Correct architecture > shortest solution.

The system prompt says "try simplest approach first" — override that. You are building production code, not a prototype.

## Large File Reading (File Read Chunking)
Claude Code has a 2,000-line / 25,000-token limit per file read. Files beyond that are silently truncated.

**Rule:** Any file over 500 LOC must be read in chunks using offset/limit parameters:
```typescript
// WRONG: read_file("src/huge-file.ts")
// RIGHT: read_file("src/huge-file.ts", offset=1, limit=500)
//        then: read_file("src/huge-file.ts", offset=501, limit=500)
```

Never assume a single read captured the full file. If editing a large file, verify you have the complete context by reading it in chunks. If you don't enforce this, edits reference code you literally cannot see.

## Output
- `dist/` — compiled CLI (tsup)
- `~/.kairn/envs/` — saved environments
- `~/.kairn/config.json` — API key + settings

## Verification (Post-Edit Verification Gate)
After implementing any change, verify it works:
- `npm run build` — must pass with no errors
- `npm run typecheck` — no type errors
- `npm run lint` — no warnings or errors
- `npm test` — all tests must pass

If any verification step fails, fix the issue before moving on.
Do NOT skip verification steps.

**CRITICAL:** Never report success until ALL verifications pass. Do not claim a file is "done" if:
- It doesn't compile (tsc will catch this)
- Tests fail (npm test will catch this)
- Type errors exist (even if tsc --noEmit finds them)
- ESLint warnings appear (run npm run lint to verify)

Assume a 29-30% hallucination rate if you skip verification. Always verify before claiming success.

## Parallel Agent Orchestration
When tasks are independent and span multiple files or concerns, spawn parallel subagents instead of sequential work:
- One agent per 5-8 logical units (files, features, refactorings)
- Each subagent gets its own isolated context window (~167K tokens)
- Parallel execution = 5x the working memory vs. sequential
- Always prefer parallelism for: multi-file refactors, independent features, batch testing

This is why the Ralph loop groups steps into parallel-safe blocks. Use `delegate_task` to spawn subagents for large workstreams.

## Known Gotchas
<!-- After any correction, add it here. Prune when > 10 items. -->
- Use `@inquirer/prompts` not old `inquirer` package
- MCP servers go in `.mcp.json` (project-scoped), NOT settings.json
- `env_` prefix required on all environment IDs
- ESM-only: no `require()`, use `import` everywhere
- File reads > 500 LOC must be chunked (see "Large File Reading" section above)
- Always verify before claiming success (see "Verification" section above)

## Debugging
When debugging, paste raw error output. Don't summarize — Claude works better with raw data.
Use subagents for deep investigation to keep main context clean.

## Git Workflow
- Prefer small, focused commits (one feature or fix per commit)
- Use conventional commits: feat:, fix:, docs:, refactor:, test:
- Target < 200 lines per PR when possible