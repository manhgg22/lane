# RUN_REPORT-P5 — Orchestrator Self-Launch via Docker Exec

**Date**: 2026-06-19
**Image**: `harness-spike-claude` (node:20-slim + claude-code@2.1.181)

## Summary

P5 PASSED. The orchestrator's `launchLane()` now spawns agents inside Docker containers via `docker exec -u lane <containerName> claude -p ...` instead of local `claude` process. The agent authenticated, ran `harness-report`, and wrote `state.json` — all inside the container.

## Code Changes

### 1. `packages/orchestrator/src/launcher.ts` — Docker exec mode

```typescript
const child = opts.containerName
  ? spawn("docker", ["exec", "-u", "lane", opts.containerName, "claude", ...claudeArgs], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      timeout: timeoutMs,
    })
  : spawn("claude", claudeArgs, {
      cwd: laneDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      timeout: timeoutMs,
      env: { ...process.env, HARNESS_PORT: process.env.HARNESS_PORT ?? "8090" },
    });
```

Both `launchLane()` and `resumeLane()` updated — when `opts.containerName` is set, spawns via `docker exec` instead of local process.

### 2. `packages/orchestrator/src/lane-manager.ts` — Container name + plugin mount

- Added `getContainerName(slug)` → `harness-${slug}`
- `renderDockerCompose()` now accepts `pluginDir?` and mounts Superpowers plugin volume

### 3. `packages/api/src/routes/agent-control.ts` — Passes containerName

- Reads `SUPERPOWERS_PLUGIN_DIR` from env
- Passes `containerName: getContainerName(lane.slug)` and `pluginDir` to launch/resume opts

## E2E Evidence

### Docker Container

```
Container: harness-p5-test
Image: harness-spike-claude
Command: sleep infinity (keeps container alive for docker exec)
```

### Agent Launch via Docker Exec

```
docker exec -u lane harness-p5-test claude -p "Run harness-report..." \
  --output-format stream-json --verbose --dangerously-skip-permissions --max-turns 3
```

### NDJSON Output (key lines)

**Session init:**
```json
{
  "type": "system",
  "subtype": "init",
  "cwd": "/app",
  "session_id": "31242e2d-d576-4a73-9460-b4f17cf38d12",
  "model": "claude-sonnet-4-6",
  "permissionMode": "bypassPermissions",
  "claude_code_version": "2.1.181"
}
```

**Agent called harness-report:**
```json
{
  "type": "assistant",
  "message": {
    "content": [{
      "type": "tool_use",
      "name": "Bash",
      "input": {
        "command": "node /app/.harness/bin/harness-report --stage intake --status running --note p5-orchestrator-test"
      }
    }]
  }
}
```

**Tool result:**
```json
{
  "type": "user",
  "tool_use_result": {
    "stdout": "[harness-report] intake -> running"
  }
}
```

**Final result:**
```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "session_id": "31242e2d-d576-4a73-9460-b4f17cf38d12",
  "total_cost_usd": 0.089056,
  "result": "DONE"
}
```

### state.json (written inside container)

```json
{
  "stage": "intake",
  "stageIndex": 0,
  "status": "running",
  "attempt": 1,
  "evidence": [],
  "note": "p5-orchestrator-test",
  "updatedAt": "2026-06-19T03:57:54.305Z"
}
```

## How It Works End-to-End

```
Orchestrator (host)                    Docker Container
    │                                       │
    ├─ launchLane(opts)                     │
    │   containerName: "harness-p5-test"    │
    │                                       │
    ├─ spawn("docker", ["exec",             │
    │    "-u", "lane",                      │
    │    "harness-p5-test",                 │
    │    "claude", "-p", prompt,            │
    │    "--output-format", "stream-json",  │
    │    "--verbose",                       │
    │    "--dangerously-skip-permissions"])  │
    │                                       │
    │                              claude authenticates ✓
    │                              claude calls Bash tool
    │                              → harness-report --stage intake
    │                              → writes .harness/state.json
    │                                       │
    │   ◄── NDJSON stream ────────────────  │
    │   (session_id, tool_use, result)      │
    │                                       │
    ├─ monitor polls state.json             │
    │   → detects stage=intake, status=running
    │   → updates DB lane stageIndex/progress
    │   → broadcasts SSE lane:updated
    │                                       │
    └─ Dashboard reflects live status       │
```

## Tests

All 85 orchestrator unit tests pass after the changes:

```
 ✓ src/exec.test.ts (5 tests)
 ✓ src/monitor.test.ts (9 tests)
 ✓ src/launcher.test.ts (8 tests)
 ✓ src/agent.test.ts (4 tests)
 ✓ src/semaphore.test.ts (3 tests)
 ✓ src/db.test.ts (7 tests)
 ✓ src/lock.test.ts (7 tests)
 ✓ src/recovery.test.ts (3 tests)
 ✓ src/scheduler.test.ts (4 tests)
 ✓ src/harness-result.test.ts (5 tests)
 ✓ src/state-machine.test.ts (18 tests)
 ✓ src/tools.test.ts (12 tests)

Test Files  12 passed (12)
     Tests  85 passed (85)
```

## Verdict

**P5: PASS** — Orchestrator `launchLane()` spawns agent inside Docker via `docker exec`. Agent authenticates, calls `harness-report`, writes `state.json`. Monitor can poll this file to update DB and broadcast SSE.
