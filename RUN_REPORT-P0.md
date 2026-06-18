# RUN_REPORT-P0 — Superpowers Gate in Docker Lane

**Date**: 2026-06-18
**Image**: `harness-spike-claude` (node:20-slim + claude-code@2.1.181)
**Host**: Windows 11 Pro, Docker Desktop

## Summary

P0 PASSED. Claude Code runs inside Docker with Superpowers plugin loaded via `--plugin-dir`. The agent can receive prompts, execute them, and return structured NDJSON output with session_id.

## Docker Command

```powershell
$credFile = "$env:USERPROFILE\.claude\.credentials.json"
$claudeJson = "$env:USERPROFILE\.claude.json"
$pluginDir = "$env:USERPROFILE\.claude\plugins\cache\claude-plugins-official\superpowers\6.0.2"

docker run --rm \
  -v "${credFile}:/home/lane/.claude/.credentials.json:ro" \
  -v "${claudeJson}:/home/lane/.claude.json:ro" \
  -v "${pluginDir}:/home/lane/.superpowers:ro" \
  harness-spike-claude \
  claude -p "Reply with exactly: P0_SUPERPOWERS_OK" \
    --plugin-dir /home/lane/.superpowers \
    --output-format stream-json --verbose \
    --dangerously-skip-permissions
```

## Key Flags

| Flag | Why |
|------|-----|
| `--plugin-dir /home/lane/.superpowers` | Load Superpowers skills into lane |
| `--output-format stream-json` | NDJSON output for harness parsing |
| `--verbose` | Required with `stream-json` |
| `--dangerously-skip-permissions` | Safe inside Docker; cannot run as root |

## Auth Mount Strategy

Mount ONLY two credential files — NOT the entire `~/.claude/` directory:
- `~/.claude/.credentials.json` (OAuth token)
- `~/.claude.json` (account config)

**Why**: Mounting all of `~/.claude/` includes IDE lock files (`ide/*.lock`) which make the CLI attempt WebSocket proxy connections, causing `ConnectionRefused`.

## Dockerfile Fix Applied

Added writable plugins directory for the `lane` user (required by Superpowers hook):

```dockerfile
RUN mkdir -p /home/lane/.claude/plugins && chown -R lane:lane /home/lane/.claude
```

Without this, `EACCES: permission denied, mkdir '/home/lane/.claude/plugins'` on startup.

## Test Run: Clean P0 Gate (post-fix)

**Prompt**: `Reply with exactly: P0_SUPERPOWERS_OK`
**Result**: `P0_SUPERPOWERS_OK`
**Session ID**: `a4eb1ba1-1e1a-44c1-98a8-76d5138c58a4`
**Cost**: $0.056
**Duration**: 2,357ms
**Model**: `claude-sonnet-4-6`

### Superpowers Confirmation

From the NDJSON `init` event:

```json
{
  "plugins": [
    {
      "name": "superpowers",
      "path": "/home/lane/.superpowers",
      "source": "superpowers@inline"
    }
  ]
}
```

15 skills available:
- brainstorming, dispatching-parallel-agents, executing-plans
- finishing-a-development-branch, receiving-code-review, requesting-code-review
- subagent-driven-development, systematic-debugging, test-driven-development
- using-git-worktrees, using-superpowers, verification-before-completion
- writing-plans, writing-skills, design, design-sync, update-config, verify
- debug, code-review, simplify, batch, fewer-permission-prompts, loop
- schedule, claude-api, run, run-skill-generator

### Prior Test Runs (from earlier session)

1. **HELLO test**: `result: "HELLO_P0"`, session_id `b6367983-007d-46fc-9635-e4d1c9c5ab84`
2. **Superpowers skill list**: All 15 skills confirmed, plugins `superpowers@inline`, session_id `506918e9-6648-47b4-afaa-4488f81d623f`

## Raw NDJSON Output (Clean Run)

```jsonl
{"type":"system","subtype":"hook_started","hook_id":"d2372190-410d-46ef-bd82-adf76026f98d","hook_name":"SessionStart:startup","hook_event":"SessionStart","session_id":"a4eb1ba1-1e1a-44c1-98a8-76d5138c58a4"}

{"type":"system","subtype":"hook_response","hook_id":"d2372190-410d-46ef-bd82-adf76026f98d","hook_name":"SessionStart:startup","hook_event":"SessionStart","exit_code":0,"outcome":"success","session_id":"a4eb1ba1-1e1a-44c1-98a8-76d5138c58a4"}

{"type":"system","subtype":"init","cwd":"/app","session_id":"a4eb1ba1-1e1a-44c1-98a8-76d5138c58a4","model":"claude-sonnet-4-6","permissionMode":"bypassPermissions","claude_code_version":"2.1.181","plugins":[{"name":"superpowers","path":"/home/lane/.superpowers","source":"superpowers@inline"}]}

{"type":"assistant","message":{"model":"claude-sonnet-4-6","content":[{"type":"text","text":"P0_SUPERPOWERS_OK"}],"usage":{"input_tokens":3,"cache_creation_input_tokens":8448,"cache_read_input_tokens":16945,"output_tokens":1}},"session_id":"a4eb1ba1-1e1a-44c1-98a8-76d5138c58a4"}

{"type":"result","subtype":"success","is_error":false,"duration_ms":2357,"result":"P0_SUPERPOWERS_OK","session_id":"a4eb1ba1-1e1a-44c1-98a8-76d5138c58a4","total_cost_usd":0.0559605}
```

(NDJSON trimmed for readability — full output preserved in `.harness/spike/p0-ndjson-output.txt`)

## Verdict

**P0: PASS** — Claude Code headless runs in Docker with Superpowers loaded, returns structured NDJSON with session_id, ready for harness integration.
