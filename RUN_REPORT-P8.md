# RUN_REPORT-P8 — Human-in-Loop (needs_you → Resume)

**Date**: 2026-06-19
**Container**: `harness-p8-test`
**Session ID**: `3cb036dc-4efb-4e8a-a06e-8348bf6d7448`

## Summary

P8 PASSED. Agent progressed through stages, stopped at `er gate` with `needs_you` status. After human "approval" (simulated via `--resume`), agent resumed from the same session and continued working.

## Flow

```
Agent Run 1                    Human Action               Agent Run 2 (--resume)
    │                              │                           │
    ├─ intake → running            │                           │
    ├─ implement → done            │                           │
    ├─ gates → done                │                           │
    ├─ er gate → needs_you ───────►│                           │
    │  "waiting for human          │                           │
    │   approval"                  │                           │
    │                              │ (reviews, approves)       │
    │  ◄─── --resume session_id ──►│                           │
    │                              │                    ├─ er gate → done
    │                              │                    │  "human approved"
    │                              │                    ├─ RESUMED_AND_DONE
```

## E2E Evidence

### Step 1: Agent runs → reaches `needs_you`

```bash
docker exec -u lane harness-p8-test claude \
  -p "Run 4 harness-report commands: intake→running, implement→done, gates→done, er gate→needs_you" \
  --output-format stream-json --verbose --dangerously-skip-permissions --max-turns 8
```

**harness-report calls (from NDJSON):**
```
[harness-report] intake -> running         @ 2026-06-19T04:04:59.040Z
[harness-report] implement -> done         @ 2026-06-19T04:05:01.677Z
[harness-report] gates -> done             @ 2026-06-19T04:05:04.875Z
[harness-report] er gate -> needs_you      @ 2026-06-19T04:05:07.148Z
```

**Agent output:** `WAITING_FOR_HUMAN`

**state.json after Step 1:**
```json
{
  "stage": "er gate",
  "stageIndex": 7,
  "status": "needs_you",
  "note": "waiting for human approval",
  "updatedAt": "2026-06-19T04:05:07.148Z"
}
```

### Step 2: Human approves → agent resumes

```bash
docker exec -u lane harness-p8-test claude \
  -p "Human approved. Continue: harness-report --stage 'er gate' --status done --note 'human approved'" \
  --resume "3cb036dc-4efb-4e8a-a06e-8348bf6d7448" \
  --output-format stream-json --verbose --dangerously-skip-permissions --max-turns 3
```

**Key NDJSON proof — same session_id on resume:**
```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "3cb036dc-4efb-4e8a-a06e-8348bf6d7448"
}
```

**harness-report call on resume:**
```
[harness-report] er gate -> done           @ 2026-06-19T04:05:29.122Z
```

**Agent output:** `RESUMED_AND_DONE`

**state.json after Step 2:**
```json
{
  "stage": "er gate",
  "stageIndex": 7,
  "status": "done",
  "note": "human approved",
  "updatedAt": "2026-06-19T04:05:29.122Z"
}
```

### Full state-history.jsonl

```jsonl
{"stage":"intake","status":"running","note":"starting","ts":"2026-06-19T04:04:59.040Z"}
{"stage":"implement","status":"done","note":"implemented","ts":"2026-06-19T04:05:01.677Z"}
{"stage":"gates","status":"done","note":"tests pass","ts":"2026-06-19T04:05:04.875Z"}
{"stage":"er gate","status":"needs_you","note":"waiting for human approval","ts":"2026-06-19T04:05:07.148Z"}
{"stage":"er gate","status":"done","note":"human approved","ts":"2026-06-19T04:05:29.122Z"}
```

## How Monitor + Dashboard Would Handle This

```
Agent reports needs_you        Monitor polls state.json        Dashboard
    │                              │                              │
    ├─ state.json: needs_you ─────►│                              │
    │                              ├─ updateLane(status=needs_you)│
    │                              ├─ SSE: lane:updated ─────────►│
    │                              │                    shows needs_you badge
    │                              │                              │
    │                              │        Human clicks "Pass" ──┤
    │                              │                              │
    │                              │◄── POST /api/lanes/:id/pass ─┤
    │                              │◄── POST /api/lanes/:id/resume│
    │                              │                              │
    │◄── claude --resume session ──┤                              │
    │    "Human approved"          │                              │
    ├─ state.json: done ──────────►│                              │
    │                              ├─ updateLane(status=running)  │
    │                              ├─ SSE: lane:updated ─────────►│
    │                              │                    shows running
```

## Costs

- **Run 1** (intake → needs_you): $0.129, 5 turns
- **Run 2** (resume → done): $0.120, 2 turns
- **Total**: $0.249

## Verdict

**P8: PASS** — Human-in-loop cycle proven end-to-end:
1. Agent reaches `er gate` → `needs_you` → stops
2. Human triggers resume with `--resume session_id`
3. Agent resumes same session, reports `er gate` → `done`
4. State transitions visible in `state-history.jsonl`
