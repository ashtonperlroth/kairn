# /project:ralph — Ralph Loop for Kairn v2.0.0

You are executing a Ralph loop to build Kairn v2.0.0 (Task Definition & Trace Infrastructure).

## First: READ THESE FILES

1. `PLAN-v2.0.md` — your step-by-step implementation plan (9 steps)
2. `docs/design/v2.0-kairn-evolve.md` — the full design specification
3. `src/commands/describe.ts` — existing command pattern to follow
4. `src/ui.ts` — branded output helpers (ui.section, ui.success, ui.error)
5. `src/types.ts` — existing type definitions to understand pattern
6. `src/config.ts` — config loading pattern

## EXECUTE THE RALPH LOOP

For each of the 9 steps in `PLAN-v2.0.md`:

1. **PLAN:** Read the step carefully. State what you will build.
2. **BUILD:** Implement all files listed in that step. Follow existing patterns.
3. **TEST:** Run `npm run build`. Fix any TypeScript errors. Run verification commands.
4. **COMMIT:** `git add -A && git commit -m "v2.0: step N - description"`
5. **NEXT:** Move to the next step.

## CRITICAL IMPLEMENTATION RULES

### TypeScript & Code Quality
- Strict TypeScript: `npx tsc --noEmit` must pass with no errors
- No `any` types. All types properly defined or imported from src/evolve/types.ts
- Use async/await for all I/O operations
- Wrap all async actions in try/catch blocks with user-friendly error messages

### Imports & Modules
- Use `.js` extensions in all imports (ESM compliance)
- Use relative paths (e.g., `from './types.js'` not `from '@kairn/types'`)
- Import types from `src/evolve/types.js` everywhere needed

### UI & Output
- Import `ui` from `../ui.js`
- Use `ui.section()` for headers
- Use `ui.success()` for success messages
- Use `ui.error()` for errors
- Use `ui.info()` for informational text
- Reference: `src/commands/describe.ts` for the pattern

### Error Handling
- Always wrap async actions in try/catch
- Call `console.log(ui.error('message'))` on errors
- Messages should be user-facing and actionable
- Example pattern from describe.ts:
  ```typescript
  try {
    const result = await someAsyncOperation();
  } catch (err) {
    console.log(ui.error('Failed to do X: ' + (err instanceof Error ? err.message : 'Unknown error')));
    process.exit(1);
  }
  ```

### File Structure
- Each step creates specific files listed in PLAN-v2.0.md
- Don't merge concerns (types go in types.ts, init logic in init.ts, etc.)
- Follow the exact file paths given in the plan

### Special Note for Step 8: CLI Commands Must Call Real Functions
Step 8 (CLI Entry Point) is critical: the commands must **call actual functions**, not stubs.

- `kairn evolve init` → calls `createEvolveWorkspace()` and `writeTasksFile()` from init.ts
- `kairn evolve baseline` → calls `snapshotBaseline()` from baseline.ts
- `kairn evolve run` → calls `runTask()` from runner.ts

All wrapped in try/catch with proper error handling.

### Step 9: CLI Integration
Wire the `evolveCommand` into `src/cli.ts`:
- Add import: `import { evolveCommand } from "./commands/evolve.js";`
- Add to program: `program.addCommand(evolveCommand);`

## VERIFICATION

After all 9 steps complete:

```bash
npm run build
# Should succeed in ~20ms

node dist/cli.js evolve --help
# Should show: init, baseline, run subcommands

node dist/cli.js evolve init --help
# Should show init command help

kairn evolve baseline --help
kairn evolve run --help
# Both should show help
```

## AFTER ALL STEPS

When you finish all 9 steps and all tests pass, run:

```bash
git log --oneline -10
# Should show 9 v2.0 step commits
```

Then exit and report back to Hermes that the build is complete and ready for quality gates.

## KEY PATTERNS FROM EXISTING CODE

### Async Command Action (from describe.ts)
```typescript
.action(async (intentArg: string | undefined, options: { yes?: boolean }) => {
  try {
    // Your logic here
    console.log(ui.success('Done!'));
  } catch (err) {
    console.log(ui.error('Failed: ' + (err instanceof Error ? err.message : 'Unknown')));
    process.exit(1);
  }
})
```

### Reading Files
```typescript
import fs from 'fs/promises';
const content = await fs.readFile(path, 'utf-8');
```

### Writing Files
```typescript
await fs.writeFile(path, content, 'utf-8');
```

### Directory Operations
```typescript
await fs.mkdir(dir, { recursive: true });
const entries = await fs.readdir(dir);
```

## START NOW

Read PLAN-v2.0.md completely, then begin Step 1.
