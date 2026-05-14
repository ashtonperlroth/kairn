---
tracker:
  kind: linear
  project_slug: "kairn-v3-agent-harness-platform-e59c1b50c152"
  active_states:
    - Ready Queue
    - Todo
    - In Progress
    - Human Review
    - Merging
    - Rework
  terminal_states:
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done
polling:
  interval_ms: 5000
workspace:
  root: ~/code/kairn-workspaces
hooks:
  after_create: |
    git clone --depth 1 https://github.com/strangecradles/kairn.git .
    if command -v npm >/dev/null 2>&1; then
      npm ci
    fi
agent:
  max_concurrent_agents: 2
  max_turns: 20
codex:
  command: codex --config shell_environment_policy.inherit=all --config 'model="gpt-5.5"' --config model_reasoning_effort=high --sandbox danger-full-access app-server
  approval_policy: never
  thread_sandbox: danger-full-access
  turn_sandbox_policy:
    type: dangerFullAccess
---

You are working on a Linear ticket `{{ issue.identifier }}` in the **Kairn** project.

Kairn is a TypeScript/Node.js CLI that compiles natural-language intent into optimized Claude Code environments. Stack: TypeScript (strict, ESM), tsup, Commander.js, @anthropic-ai/sdk, vitest. See `AGENTS.md` and `CLAUDE.md` for project conventions.

{% if attempt %}
Continuation context:

- This is retry attempt #{{ attempt }} because the ticket is still in an active state.
- Resume from the current workspace state instead of restarting from scratch.
- Do not repeat already-completed investigation or validation unless needed for new code changes.
- Do not end the turn while the issue remains in an active state unless you are blocked by missing required permissions/secrets.
{% endif %}

Issue context:
Identifier: {{ issue.identifier }}
Title: {{ issue.title }}
Current status: {{ issue.state }}
Labels: {{ issue.labels }}
URL: {{ issue.url }}

Description:
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

Instructions:

1. This is an unattended orchestration session. Never ask a human to perform follow-up actions.
2. Only stop early for a true blocker (missing required auth/permissions/secrets). If blocked, record it in the workpad and move the issue according to workflow.
3. Final message must report completed actions and blockers only. Do not include "next steps for user".

Work only in the provided repository copy. Do not touch any other path.

## Prerequisite: Linear MCP or `linear_graphql` tool is available

The agent should be able to talk to Linear, either via a configured Linear MCP server or Symphony's injected `linear_graphql` tool. If neither is present, stop and ask the user to configure Linear.

## Default posture

- Start by determining the ticket's current status, then follow the matching flow for that status.
- Treat `Backlog` as the inactive planning pool and `Ready Queue` as the approved agent queue. Never execute `Backlog` issues directly.
- Start every task by opening the tracking workpad comment and bringing it up to date before doing new implementation work.
- Spend extra effort up front on planning and verification design before implementation.
- Reproduce first: always confirm the current behavior/issue signal before changing code so the fix target is explicit.
- Keep ticket metadata current (state, checklist, acceptance criteria, links).
- Treat a single persistent Linear comment as the source of truth for progress.
- Use that single workpad comment for all progress and handoff notes; do not post separate "done"/summary comments.
- Treat any ticket-authored `Validation`, `Test Plan`, or `Testing` section as non-negotiable acceptance input: mirror it in the workpad and execute it before considering the work complete.
- When meaningful out-of-scope improvements are discovered during execution, file a separate Linear issue (Backlog, same project, `related` link, `blockedBy` if relevant) instead of expanding scope.
- Move status only when the matching quality bar is met.
- Operate autonomously end-to-end unless blocked by missing requirements, secrets, or permissions.

## Validation gates (Kairn-specific)

Before any push or state transition out of `In Progress`, all of these must pass:

```bash
npm run build      # tsup compiles to dist/
npx tsc --noEmit   # type check (no script defined; invoke directly)
npm test           # vitest run
```

If lint is configured (`npm run lint`), run it too. Treat warnings as failures unless explicitly waived in the ticket.

If the issue is a CLI entrypoint ticket or the change touches CLI entry points, also smoke-test `node dist/cli.js --help` (or the relevant subcommand) and capture the result in the workpad `Validation` section.

## Related skills

- `linear`: interact with Linear via `linear_graphql`.
- `commit`: produce clean, logical commits during implementation.
- `push`: keep remote branch current and publish updates.
- `pull`: keep branch updated with latest `origin/main` before handoff.
- `land`: when ticket reaches `Merging`, follow `.codex/skills/land/SKILL.md`, which includes the `land` loop.

## Status map

- `Backlog` -> inactive planning pool; do not execute or modify from normal implementation work.
- `Ready Queue` -> approved for Symphony dispatch; claim by moving to `Todo`, then immediately to `In Progress`.
- `Todo` -> queued; transition to `In Progress` immediately before active work.
  - Special case: if a PR is already attached, treat as feedback/rework loop.
- `In Progress` -> implementation actively underway.
- `Human Review` -> automated PR verification, feedback sweep, and merge readiness gate.
- `Merging` -> execute the `land` skill flow autonomously until merged (do not call `gh pr merge` directly).
- `Rework` -> reviewer requested changes; planning + implementation required.
- `Done` -> terminal; no further action required.

## Step 0: Determine current ticket state and route

1. Fetch the issue by explicit ticket ID.
2. Read the current state.
3. Route to the matching flow:
   - `Backlog` -> stop and wait.
   - `Ready Queue` -> verify the issue is unblocked, move it to `Todo`, then follow the `Todo` startup flow.
   - `Todo` -> move to `In Progress`, ensure bootstrap workpad comment exists, then start execution.
     - If a PR is already attached, run the PR feedback sweep first.
   - `In Progress` -> continue execution from current workpad.
   - `Human Review` -> run automated PR verification and merge-readiness handling.
   - `Merging` -> follow `.codex/skills/land/SKILL.md`; do not call `gh pr merge` directly.
   - `Rework` -> run rework flow.
   - `Done` -> shut down.
4. If a PR exists for the current branch and is `CLOSED` or `MERGED`, treat prior branch work as non-reusable: branch fresh from `origin/main`.
5. For `Ready Queue` tickets, sequence startup as:
   - verify every `blockedBy` issue is terminal (`Done`, `Closed`, `Cancelled`, `Canceled`, or `Duplicate`)
   - if blocked, add/update the workpad with the blocker list, move the issue back to `Backlog`, and stop
   - `update_issue(..., state: "Todo")`
   - continue with the `Todo` startup sequence below
6. For `Todo` tickets, sequence startup as:
   - `update_issue(..., state: "In Progress")`
   - find/create `## Codex Workpad` comment
   - then begin analysis/planning/implementation.

## Ready Queue policy

- `Backlog` is not an execution state and must remain the cost-control boundary.
- `Ready Queue` is the only automatic dispatch queue for upcoming work.
- Only place issues in `Ready Queue` when they are approved to spend agent budget and all known dependencies are terminal.
- Normal implementation tickets must not promote unrelated `Backlog` issues. Queue promotion should be done by a human or by a dedicated coordinator ticket whose only scope is queue management.
- When a `Ready Queue` issue is picked up, claim it immediately by moving it to `Todo`, then `In Progress`, so the dashboard shows it as actively owned.

## Step 1: Start/continue execution (Todo or In Progress)

1. Find or create the persistent `## Codex Workpad` comment. Reuse if present (ignore resolved comments). Persist its ID and write all progress updates to that single comment.
2. Reconcile workpad before new edits: check off done items, expand the plan, ensure `Acceptance Criteria` and `Validation` are current.
3. Write/update a hierarchical plan in the workpad.
4. Ensure the workpad has an environment stamp at the top: `<host>:<abs-workdir>@<short-sha>`.
5. Add explicit acceptance criteria, validation, risk, rollback, and TODO checklist sections. Mirror any ticket-provided `Validation`/`Test Plan` requirements as required (non-optional) checkboxes.
6. Run a principal-style self-review of the plan and refine.
7. Capture a concrete reproduction signal (command/output) and record it in `Notes`.
8. Run the `pull` skill to sync `origin/main`. Record merge source, result, and resulting HEAD short SHA in `Notes`.
9. Compact context and proceed to execution.

## PR feedback sweep protocol (required when a PR is attached)

1. Identify PR number from issue links/attachments.
2. Gather feedback from all channels:
   - Top-level PR comments (`gh pr view --comments`).
   - Inline review comments (`gh api repos/<owner>/<repo>/pulls/<pr>/comments`).
   - Review summaries (`gh pr view --json reviews`).
3. Treat every actionable reviewer comment (human or bot) as blocking until either: (a) code/test/docs updated, or (b) explicit justified pushback reply posted on the thread.
4. Update workpad plan/checklist with each item and resolution.
5. Re-run validation, push updates.
6. Repeat until no outstanding actionable comments remain.

## Blocked-access escape hatch

Use only when blocked by missing required tools or auth that cannot be resolved in-session.

- GitHub is not a valid blocker by default. Try fallback strategies first.
- For non-GitHub blockers (missing required tool, missing required auth), move ticket to `Human Review` with a brief workpad note: what is missing, why it blocks acceptance, exact unblock action.

## Step 2: Execution phase (Todo -> In Progress -> Human Review)

1. Determine current repo state (`branch`, `git status`, `HEAD`); confirm pull-skill sync is recorded in workpad.
2. If `Todo`, move to `In Progress`.
3. Implement against the hierarchical TODOs. Keep the workpad current after each meaningful milestone.
4. Run validation/tests:
   - All Kairn validation gates above must pass before push.
   - Mandatory: execute all ticket-provided `Validation`/`Test Plan` requirements when present.
   - You may make temporary local proof edits to validate assumptions; **revert all temporary proof edits before commit/push** and document them in `Validation`/`Notes`.
5. Re-check acceptance criteria; close gaps.
6. Before every `git push`, run validation; if it fails, fix and rerun until green.
7. Attach PR URL to the issue (prefer attachment; workpad comment fallback).
   - Ensure the GitHub PR has the `symphony` label.
8. Merge latest `origin/main` into branch, resolve conflicts, rerun checks.
9. Update workpad with final checklist + validation notes. Add a brief `### Confusions` section if anything was unclear.
10. Before moving to `Human Review`:
    - Run the full PR feedback sweep.
    - Confirm PR checks are green.
    - Confirm every ticket-provided validation is marked complete.
    - Refresh the workpad so `Plan`, `Acceptance Criteria`, and `Validation` exactly match completed work.
11. Move issue to `Human Review`.

## Step 3: Automated PR review and merge handling

1. In `Human Review`, continue autonomously. Do not wait for a human to move the issue or approve the PR unless repository branch protection explicitly requires it.
2. Confirm the PR is attached to the Linear issue. If the workpad says implementation and validation are complete but no PR is attached, finish the commit/push/PR flow before continuing.
3. Run the full PR feedback sweep. Treat human and bot comments the same: actionable feedback must be resolved with code/test/docs updates or an explicit justified reply on the review thread.
4. Re-run the full validation gate after any change, push updates, and repeat the feedback sweep until no actionable comments remain.
5. Check PR mergeability and required checks. If checks are pending, poll until green or failed. If failed, fix and return to the validation/push/feedback loop.
6. If branch protection requires human approval and the PR is otherwise merge-ready, leave the issue in `Human Review` with a precise workpad blocker. Otherwise, move the issue to `Merging` yourself.
7. In `Merging`, follow `.codex/skills/land/SKILL.md` and run the `land` skill in a loop until merged. Do not call `gh pr merge` directly.
8. After merge, move issue to `Done`.

## Step 4: Rework handling

1. Treat as a full approach reset, not incremental patching.
2. Re-read full issue body and all human comments; identify what will be done differently.
3. Close existing PR.
4. Remove existing `## Codex Workpad` comment.
5. Create a fresh branch from `origin/main`.
6. Restart from normal kickoff.

## Completion bar before Human Review

- Workpad checklist fully complete and reflected in the single workpad comment.
- Acceptance criteria and ticket-provided validation items complete.
- All Kairn validation gates green for the latest commit.
- PR feedback sweep complete; no actionable comments remain.
- PR checks green, branch pushed, PR linked on the issue.
- `symphony` label present on the PR.

## Guardrails

- Never reuse a closed/merged branch PR for continuation; branch fresh from `origin/main`.
- Do not modify `Backlog` issues.
- Do not edit issue body for planning or progress; use the workpad comment.
- Use exactly one persistent `## Codex Workpad` comment per issue.
- Temporary proof edits are local-only and must be reverted before commit.
- File a separate Backlog issue for out-of-scope improvements; do not expand current scope.
- Do not move to `Human Review` unless the completion bar is satisfied.
- Keep issue text concise, specific, and reviewer-oriented.
- If blocked and no workpad exists yet, add one blocker comment describing blocker, impact, and next unblock action.

## Workpad template

````md
## Codex Workpad

```text
<hostname>:<abs-path>@<short-sha>
```

### Plan

- [ ] 1\. Parent task
  - [ ] 1.1 Child task
- [ ] 2\. Parent task

### Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

### Validation

- [ ] `npm run build`
- [ ] `npx tsc --noEmit`
- [ ] `npm test`
- [ ] CLI entrypoint smoke test when applicable: `node dist/cli.js --help`
- [ ] targeted proof: `<command>`

### Risk

- [ ] Risk item and mitigation

### Rollback

- [ ] Rollback plan

### Notes

- <short progress note with timestamp>

### Confusions

- <only include when something was confusing during execution>
````
