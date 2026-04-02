# Hook Templates

Hooks go in `settings.json` under the `hooks` key. They are deterministic —
not LLM-controlled. Zero token cost unless type is `prompt` or `agent`.

## Always Include

### Block Destructive Commands (PreToolUse)
```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "CMD=$(cat | jq -r '.tool_input.command // empty') && echo \"$CMD\" | grep -qiE 'rm\\s+-rf\\s+/|DROP\\s+TABLE|DROP\\s+DATABASE|curl.*\\|\\s*sh|:(){ :|:& };:' && echo 'Blocked destructive command' >&2 && exit 2 || true"
  }]
}
```

### Block Force Push and Dangerous Git (PreToolUse)
```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "CMD=$(cat | jq -r '.tool_input.command // empty') && echo \"$CMD\" | grep -qiE 'git\\s+push.*--force(?!-with-lease)|ch(mod|own).*-R\\s+/|npm\\s+publish(?!.*--dry-run)' && echo 'Blocked dangerous operation' >&2 && exit 2 || true"
  }]
}
```

### Block Credential Leaks in Output (PreToolUse)
```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "CMD=$(cat | jq -r '.tool_input.command // empty') && echo \"$CMD\" | grep -qiE '(api[_-]?key|secret|token|password)\\s*[:=]|AWS_SECRET_ACCESS_KEY|AKIA[0-9A-Z]{16}|BEGIN.*PRIVATE\\s+KEY' && echo 'Blocked potential credential leak' >&2 && exit 2 || true"
  }]
}
```

### Block Injection Patterns (PreToolUse)
```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "CMD=$(cat | jq -r '.tool_input.command // empty') && echo \"$CMD\" | grep -qiE ';\\s*(DROP|DELETE|ALTER|TRUNCATE)\\s+|\\.\\.\/\\.\\.\/\\.\\.\/' && echo 'Blocked injection pattern' >&2 && exit 2 || true"
  }]
}
```

### Block Network Exfiltration (PreToolUse)
```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "CMD=$(cat | jq -r '.tool_input.command // empty') && echo \"$CMD\" | grep -qiE 'nc\\s+.*-e|/dev/tcp/|bash\\s+-i|curl.*-d.*@|wget.*--post-file' && echo 'Blocked network exfiltration' >&2 && exit 2 || true"
  }]
}
```

### Protect Secret Files (PreToolUse)
```json
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "command",
    "command": "FILE=$(cat | jq -r '.tool_input.file_path // empty') && echo \"$FILE\" | grep -qE '(\\.env$|\\.env\\.|secrets/|credentials\\.json|service-account\\.json|id_rsa|\\.pem$)' && echo 'Cannot modify secret files' >&2 && exit 2 || true"
  }]
}
```

## Code Projects with Formatters

### Auto-Format with Prettier (PostToolUse)
```json
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "command",
    "command": "FILE=$(cat | jq -r '.tool_input.file_path // empty') && [ -n \"$FILE\" ] && npx prettier --write \"$FILE\" 2>/dev/null || true"
  }]
}
```

### Auto-Format with Black (PostToolUse) — Python
```json
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "command",
    "command": "FILE=$(cat | jq -r '.tool_input.file_path // empty') && [ -n \"$FILE\" ] && echo \"$FILE\" | grep -q '\\.py$' && black \"$FILE\" 2>/dev/null || true"
  }]
}
```

## Recommended Additions

### Context Re-injection After Compaction (PostCompact)
```json
{
  "matcher": "",
  "hooks": [{
    "type": "prompt",
    "prompt": "Context was compacted. Re-read CLAUDE.md and docs/TODO.md to restore project context."
  }]
}
```

### Desktop Notification (macOS) (Notification)
```json
{
  "matcher": "",
  "hooks": [{
    "type": "command",
    "command": "osascript -e 'display notification \"Claude needs your attention\" with title \"Claude Code\"'"
  }]
}
```

### Sound on Task Complete (Stop) — macOS
```json
{
  "matcher": "",
  "hooks": [{
    "type": "command",
    "command": "/usr/bin/afplay /System/Library/Sounds/Glass.aiff 2>/dev/null || true"
  }]
}
```

## Context Reset Protocol (PostCompact Alternative)

For sessions >2 hours or >3 compactions, prefer full context reset over
simple re-injection. Pipes CLAUDE.md + SPRINT.md + DECISIONS.md content
directly into additionalContext via command hook.

```json
{
  "matcher": "",
  "hooks": [{
    "type": "command",
    "command": "CONTEXT=$(cat .claude/CLAUDE.md .claude/docs/SPRINT.md .claude/docs/DECISIONS.md 2>/dev/null | head -200) && printf '{\"continue\":true,\"hookSpecificOutput\":{\"hookEventName\":\"PostCompact\",\"additionalContext\":\"CONTEXT RESET — Full project context re-injected:\\n\\n%s\"}}' \"$CONTEXT\""
  }]
}
```

**When to use which PostCompact strategy:**
- **Re-inject (default):** Short sessions (<2 hours), simple projects
- **Full Reset:** Long sessions (>2 hours), >3 compactions, complex multi-file work

## Memory Persistence (SessionStart/End)

Persists key context across sessions via `.claude/memory.json`. On SessionEnd,
saves recent decisions, sprint status, and known gotchas. On SessionStart,
loads and injects as additionalContext.

### SessionEnd Hook (save context)
```json
{
  "matcher": "",
  "hooks": [{
    "type": "command",
    "command": "MEMORY=$(jq -n --arg decisions \"$(tail -20 .claude/docs/DECISIONS.md 2>/dev/null)\" --arg sprint \"$(head -30 .claude/docs/SPRINT.md 2>/dev/null)\" --arg gotchas \"$(grep -A1 '^-' .claude/CLAUDE.md 2>/dev/null | grep -v 'none yet' | head -10)\" '{decisions: $decisions, sprint: $sprint, gotchas: $gotchas, timestamp: now | todate}') && echo \"$MEMORY\" > .claude/memory.json"
  }]
}
```

### SessionStart Hook (load context)
```json
{
  "matcher": "",
  "hooks": [{
    "type": "command",
    "command": "if [ -f .claude/memory.json ]; then MEMORY=$(cat .claude/memory.json) && printf '{\"continue\":true,\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"RESTORED SESSION MEMORY:\\n%s\"}}' \"$MEMORY\"; else echo '{\"continue\":true}'; fi"
  }]
}
```

## Selection Guide
| Hook | Include When |
|------|-------------|
| Block destructive | Always |
| Protect secrets | Always |
| Auto-format Prettier | JS/TS project with prettier |
| Auto-format Black | Python project with black |
| PostCompact re-inject | Short sessions, simple projects |
| PostCompact full reset | Long sessions (>2h), complex projects |
| Memory persistence | All projects with multi-session workflows |
| Desktop notification | macOS users |
| Sound on complete | Power users |

## Anti-Patterns
- Don't use agent-type hooks unless necessary (expensive — spawns full LLM)
- PostToolUse formatters can loop if formatter modifies the file — add guards
- Stop hooks MUST check for re-entry to prevent infinite loops
- Keep hook commands fast (<5 seconds) — they block Claude
