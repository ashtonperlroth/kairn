Implement the next unreleased version from ROADMAP.md using subagents.

## Phase 1: PLAN
Read ROADMAP.md. Find the first version with unchecked items (- [ ]). That is the target.
Read the design doc at docs/design/v1.X-*.md for that version.
List every item to implement. This is the sprint backlog.

## Phase 2: IMPLEMENT
For each item in the backlog, use the @implementer agent:
- Pass it the specific section from the design doc
- Let it implement, build, and commit
- Move to the next item after it finishes

If there is no design doc, implement directly from the ROADMAP checklist items.

## Phase 3: VERIFY
Use the @verifier agent:
- Pass it the "Testing This Release" section from the design doc
- It will run each test and report PASS/FAIL
- If any FAIL: use @implementer to fix, then re-verify

## Phase 4: FINALIZE
After all tests pass:

1. Update CHANGELOG.md — add new version section with all changes
2. Update ROADMAP.md — check off completed items, mark version ✅
3. Run: `npm version minor --no-git-tag-version`
4. Run: `npm run build`
5. Commit: "vX.Y.0 — short description of this release"
6. Tag: `git tag vX.Y.0`

Then tell the user:
```
Ready to publish! Run:
  npm publish --access public
  git push --tags
```
