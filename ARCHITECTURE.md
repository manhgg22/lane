# Architecture Decisions

## Core Principle: "Harness Thin / Skill Thick"

The harness does NOT orchestrate the agent step-by-step. Each lane is **one long-lived Claude Code session** that self-drives the entire 12-stage pipeline using Superpowers skills. The harness only does 4 things:

1. **Isolate** — clone repo, Docker container, port allocation
2. **Launch** — start one `claude -p` session per lane with `--output-format stream-json`
3. **Monitor** — read `.harness/state.json` (written by agent via `harness-report` CLI)
4. **Human-in-loop** — `--resume` the session when a human approves (er gate, watch PR)

## Agent-to-Harness Communication

```
Agent (in Docker lane)          Harness (orchestrator)
    |                                |
    |-- harness-report              --> writes .harness/state.json
    |-- harness-lock acquire/release --> calls API on host.docker.internal
    |-- harness-signal-lane          --> calls API to wake another lane
    |-- <<HARNESS_RESULT>> block    --> parsed from agent stdout (fallback)
    |                                |
    |                                |<-- monitor polls state.json
    |                                |<-- DB update + SSE broadcast
```

## Docker Auth: Mount Only Credentials

**Critical lesson from PHASE A spike**: mounting the entire `~/.claude/` directory into Docker causes `ConnectionRefused` errors because IDE lock files (`ide/*.lock`) make the CLI try to connect to a VS Code WebSocket proxy that doesn't exist in the container. 

**Fix**: mount ONLY two files:
- `~/.claude/.credentials.json` → `/home/lane/.claude/.credentials.json:ro`
- `~/.claude.json` → `/home/lane/.claude.json:ro`

## Skills Architecture

Skills live in `skills/` and are copied into each lane's `.claude/skills/` during `createFullLane()`. The two core skills:

| Skill | Purpose | Superpowers Composed |
|-------|---------|---------------------|
| `feature-workflow.md` | Drives a task through 12 stages | brainstorming → writing-plans → subagent-driven-development → systematic-debugging → verification-before-completion |
| `pr-review-loop.md` | Dedicated review lane, polls open PRs | requesting-code-review |

## CLI Tools (in `tools/`)

Installed into each lane at `.harness/bin/`. Agent calls these from shell:

| Tool | Purpose |
|------|---------|
| `harness-report` | Write stage transitions to `.harness/state.json` |
| `harness-lock` | Acquire/release global heavy-stage lock via harness API |
| `harness-signal-lane` | PR review loop signals feature lanes to re-enter and fix |

## Why Next.js instead of Vite?

The harness dashboard needs **server-side rendering** for the audit log and metrics pages — these pages can contain thousands of rows and benefit from streaming HTML. Next.js 15 App Router provides this out of the box with React Server Components.

## Why a separate SDK package?

`@harness/sdk` exists so the frontend doesn't import from `@harness/api` directly:
1. **Decoupling** — typed HTTP client, no server-side dependencies
2. **Reuse** — scripts, CLI tools, Slack bot can use it
3. **React hooks** — `useLanes()`, `useLane()`, `useSSE()`, `useMutation()`

## Why SSE (Server-Sent Events)?

Event flow is **server-to-client only**. SSE is simpler than WebSocket, works through proxies, and `EventSource` handles reconnection automatically. Actions go through REST POST endpoints.

## Package dependency graph

```
@harness/types     (leaf — zero dependencies)
    ^
    |
@harness/orchestrator  (depends on types, sql.js)
    ^                   launcher.ts — spawns claude per lane
    |                   monitor.ts — watches state.json → DB → SSE
    |
@harness/api       (depends on orchestrator, types, fastify)
                    agent-control.ts — launch/resume/session endpoints
                    lock-api.ts — acquire/release locks for agents
                    lane-signal.ts — PR review → feature lane signals
    
@harness/sdk       (depends on types only — talks to API via HTTP)
    ^
    |
@harness/web       (depends on sdk, types — Next.js frontend)
```

## Why sql.js (WASM SQLite)?

No native binary compilation, single-file database, no external database server. Persistence via `writeFileSync` after every mutation for crash recovery.

## 12-Stage Pipeline

```
intake → implement → gates → PR → integrate → e2e+QC → review → er gate → push-dev → dev/QC → watch PR → done
                                                 ↑                                        ↑
                                            HEAVY (lock)                              HEAVY (lock)
```

Heavy stages (`e2e+QC`, `dev/QC`) require global lock — agent calls `harness-lock acquire` before entering.
Human gates (`er gate`, `watch PR`) report `needs_you` and STOP — harness `--resume`s on approval.
