# RUN_REPORT-P7 — Real Lock Contention Under Docker

**Date**: 2026-06-19
**Containers**: `harness-lane-a`, `harness-lane-b`
**API Server**: `localhost:8090` (Fastify)

## Summary

P7 PASSED. Two Docker containers ran `harness-lock` CLI simultaneously. Lane A acquired the `heavy_stage` lock; Lane B polled every 2s and saw "waiting... (held by lane chat-md-tables)". After Lane A released, Lane B acquired successfully.

## Setup

1. API server running on host at port 8090
2. Two Docker containers with `--add-host host.docker.internal:host-gateway`
3. `harness-lock` CLI copied to `/app/.harness/bin/` in each container

## Lock Contention Timeline

### Step 1: Lane A acquires lock

```
$ docker exec harness-lane-a node /app/.harness/bin/harness-lock acquire chat-md-tables
[harness-lock] acquiring heavy_stage lock for chat-md-tables...
[harness-lock] acquired for chat-md-tables
```

### Step 2: Lane B tries to acquire — BLOCKED

```
$ docker exec harness-lane-b node /app/.harness/bin/harness-lock acquire codebase-quick-wins
[harness-lock] acquiring heavy_stage lock for codebase-quick-wins...
[harness-lock] waiting... (held by lane chat-md-tables)    ← poll 1 (2s)
[harness-lock] waiting... (held by lane chat-md-tables)    ← poll 2 (4s)
[harness-lock] waiting... (held by lane chat-md-tables)    ← poll 3 (6s)
[harness-lock] waiting... (held by lane chat-md-tables)    ← poll 4 (8s)
```

### Step 3: Lane A releases lock

```
$ docker exec harness-lane-a node /app/.harness/bin/harness-lock release chat-md-tables
[harness-lock] released for chat-md-tables
```

### Step 4: Lane B acquires lock

```
$ docker exec harness-lane-b node /app/.harness/bin/harness-lock acquire codebase-quick-wins
[harness-lock] acquiring heavy_stage lock for codebase-quick-wins...
[harness-lock] acquired for codebase-quick-wins
```

### Step 5: Lane B releases lock

```
$ docker exec harness-lane-b node /app/.harness/bin/harness-lock release codebase-quick-wins
[harness-lock] released for codebase-quick-wins
```

## API Evidence

Direct API calls also confirm the lock mechanism:

```bash
# Lane A acquires
POST /api/locks/acquire {"slug":"chat-md-tables","lockType":"heavy_stage"}
→ {"acquired":true,"slug":"chat-md-tables"}

# Lane B blocked
POST /api/locks/acquire {"slug":"codebase-quick-wins","lockType":"heavy_stage"}
→ {"acquired":false,"heldBy":"chat-md-tables","acquiredAt":"2026-06-19 04:02:41"}

# Lane A releases
POST /api/locks/release {"slug":"chat-md-tables","lockType":"heavy_stage"}
→ {"released":true,"slug":"chat-md-tables"}

# Lane B acquires
POST /api/locks/acquire {"slug":"codebase-quick-wins","lockType":"heavy_stage"}
→ {"acquired":true,"slug":"codebase-quick-wins"}
```

## How It Works

```
Lane A (Docker)              Harness API (host:8090)           Lane B (Docker)
    │                              │                                │
    ├─ harness-lock acquire ──────►│                                │
    │                         lock granted                          │
    │  (running e2e+QC)            │◄──── harness-lock acquire ─────┤
    │                              │  "acquired=false, heldBy=A"    │
    │                              │                                │
    │                              │      waiting... (held by A) ←──┤ poll 2s
    │                              │      waiting... (held by A) ←──┤ poll 2s
    │                              │      waiting... (held by A) ←──┤ poll 2s
    │                              │      waiting... (held by A) ←──┤ poll 2s
    │                              │                                │
    ├─ harness-lock release ──────►│                                │
    │                         lock released                         │
    │                              │◄──── harness-lock acquire ─────┤
    │                              │  lock granted ─────────────────►│
    │                              │                     (runs e2e+QC)
    │                              │◄──── harness-lock release ─────┤
    │                              │  lock released                 │
```

## Verdict

**P7: PASS** — Real lock contention proven: two Docker containers compete for `heavy_stage` lock via `harness-lock` CLI → API. Lane B waits (polls every 2s) while Lane A holds the lock. After Lane A releases, Lane B acquires successfully.
