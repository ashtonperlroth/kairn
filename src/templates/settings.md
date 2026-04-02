# settings.json Templates

The settings.json controls permissions, hooks, and model preferences.
Place in `.claude/settings.json` (project-scoped, committed to git).

## Minimal (Research/Writing Projects)
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Read",
      "Write",
      "Edit"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(curl * | sh)",
      "Read(./.env)",
      "Read(./secrets/**)"
    ]
  }
}
```

## Standard (Code Projects)
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(npx *)",
      "Bash(git *)",
      "Read",
      "Write",
      "Edit"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(curl * | sh)",
      "Bash(sudo *)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "CMD=$(cat | jq -r '.tool_input.command // empty') && echo \"$CMD\" | grep -qiE 'rm\\s+-rf\\s+/|DROP\\s+TABLE|curl.*\\|\\s*sh' && echo 'Blocked' >&2 && exit 2 || true"
        }]
      }
    ]
  }
}
```

## Full (Code Projects with Formatter)
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(npx *)",
      "Bash(git *)",
      "Bash(node *)",
      "Read",
      "Write",
      "Edit"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(curl * | sh)",
      "Bash(sudo *)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "CMD=$(cat | jq -r '.tool_input.command // empty') && echo \"$CMD\" | grep -qiE 'rm\\s+-rf\\s+/|DROP\\s+TABLE|curl.*\\|\\s*sh' && echo 'Blocked' >&2 && exit 2 || true"
        }]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "FILE=$(cat | jq -r '.tool_input.file_path // empty') && echo \"$FILE\" | grep -qE '(\\.env$|\\.env\\.|secrets/)' && echo 'Protected file' >&2 && exit 2 || true"
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "FILE=$(cat | jq -r '.tool_input.file_path // empty') && [ -n \"$FILE\" ] && npx prettier --write \"$FILE\" 2>/dev/null || true"
        }]
      }
    ],
    "PostCompact": [
      {
        "matcher": "",
        "hooks": [{
          "type": "prompt",
          "prompt": "Context compacted. Re-read CLAUDE.md and docs/TODO.md."
        }]
      }
    ]
  }
}
```

## Full with Memory Persistence (Multi-Session Projects)
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "if [ -f .claude/memory.json ]; then MEMORY=$(cat .claude/memory.json) && printf '{\"continue\":true,\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"RESTORED SESSION MEMORY:\\n%s\"}}' \"$MEMORY\"; else echo '{\"continue\":true}'; fi"
        }]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "MEMORY=$(jq -n --arg decisions \"$(tail -20 .claude/docs/DECISIONS.md 2>/dev/null)\" --arg sprint \"$(head -30 .claude/docs/SPRINT.md 2>/dev/null)\" --arg gotchas \"$(grep -A1 '^-' .claude/CLAUDE.md 2>/dev/null | grep -v 'none yet' | head -10)\" '{decisions: $decisions, sprint: $sprint, gotchas: $gotchas, timestamp: now | todate}') && echo \"$MEMORY\" > .claude/memory.json"
        }]
      }
    ]
  }
}
```

## Full with Persistence Routing (Multi-Step Task Detection)
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "persistence_routing": "auto",
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(npx *)",
      "Bash(git *)",
      "Bash(node *)",
      "Read",
      "Write",
      "Edit"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(curl * | sh)",
      "Bash(sudo *)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "CMD=$(cat | jq -r '.tool_input.command // empty') && echo \"$CMD\" | grep -qiE 'rm\\s+-rf\\s+/|DROP\\s+TABLE|curl.*\\|\\s*sh' && echo 'Blocked' >&2 && exit 2 || true"
        }]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "FILE=$(cat | jq -r '.tool_input.file_path // empty') && echo \"$FILE\" | grep -qE '(\\.env$|\\.env\\.|secrets/)' && echo 'Protected file' >&2 && exit 2 || true"
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "FILE=$(cat | jq -r '.tool_input.file_path // empty') && [ -n \"$FILE\" ] && npx prettier --write \"$FILE\" 2>/dev/null || true"
        }]
      }
    ],
    "PostCompact": [
      {
        "matcher": "",
        "hooks": [{
          "type": "prompt",
          "prompt": "Context compacted. Re-read CLAUDE.md and docs/TODO.md."
        }]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/persist-router.mjs\"",
          "timeout": 5
        }]
      }
    ]
  }
}
```

Set `"persistence_routing": "auto"` for autonomy level 3-4 (routes complex multi-step tasks through `/project:persist` automatically) or `"persistence_routing": "manual"` for level 1-2 (only routes when user explicitly requests persistence). Set to `"off"` to disable entirely.

## Notes
- Always include the `$schema` for IDE autocomplete
- `deny` arrays merge across scopes — project deny + user deny both apply
- Hook commands receive JSON on stdin — use `jq` to parse
- Prefer `allow` lists over permissive defaults
