# Feature Harness

A local orchestrator that runs multiple AI agents (Claude Code headless) in parallel, each in isolated Docker containers, to develop features across independent "lanes" — from intake to PR merge.

**Architecture: "Harness Thin / Skill Thick"** — each lane is ONE long-lived Claude Code session that self-drives the entire 12-stage pipeline using Superpowers skills. The harness only isolates, launches, monitors, and handles human-in-loop.

## What This Does

Feature Harness automates the multi-stage software development lifecycle. You define lanes (feature tasks), and the system drives each lane through a 12-stage pipeline using AI agents, with human checkpoints at critical gates.

**Each lane = a full copy of your target repo**, running in its own Docker container with its own port, database, and branch. A global lock ensures only one lane runs expensive operations (e2e tests, QA) at a time.

```
intake → implement → gates → PR → integrate → e2e+QC → review → er gate → push-dev → dev/QC → watch PR → done
```

### Key Principles

- **Target-agnostic** — works with any repo; configure via `lanes.yaml`
- **Never auto-merges** — always stops at "watch PR" for human approval
- **Crash-recoverable** — all state transitions persist to SQLite before continuing
- **Human-in-the-loop** — stages can block and wait for manual intervention

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Feature Harness                     │
│                                                        │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  │
│  │ @harness/web │  │ @harness/api│  │ @harness/     │  │
│  │  Next.js 15  │◄─┤  Fastify    │◄─┤ orchestrator  │  │
│  │  port 3100   │  │  port 8090  │  │  state machine│  │
│  └──────┬───────┘  └──────┬──────┘  └──────┬────────┘  │
│         │                 │                 │           │
│  ┌──────┴───────┐  ┌──────┴──────┐  ┌──────┴────────┐  │
│  │ @harness/sdk │  │  SSE stream │  │  sql.js WASM  │  │
│  │  API client  │  │  real-time  │  │  SQLite DB    │  │
│  │  React hooks │  │  events     │  │  persistence  │  │
│  └──────────────┘  └─────────────┘  └───────────────┘  │
│                                                        │
│  ┌────────────────┐                                    │
│  │ @harness/types │  shared TypeScript contracts       │
│  └────────────────┘                                    │
└──────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│  Docker containers (one per lane)            │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐     │
│  │ Lane 1  │  │ Lane 2  │  │ Lane N  │     │
│  │ :4001   │  │ :4002   │  │ :400N   │     │
│  │ clone   │  │ clone   │  │ clone   │     │
│  └─────────┘  └─────────┘  └─────────┘     │
└─────────────────────────────────────────────┘
```

## Packages

| Package | Path | Description |
|---------|------|-------------|
| `@harness/types` | `packages/types` | Shared TypeScript contracts — Lane, StageRun, SSEEvent, API request/response shapes. Leaf package with zero dependencies. |
| `@harness/orchestrator` | `packages/orchestrator` | Core engine — SQLite database (sql.js WASM), 12-stage state machine, transition map, global lock, stage handlers, lane manager, scheduler/runner. |
| `@harness/api` | `packages/api` | Fastify REST API (port 8090) — CRUD lanes, stage actions (advance/block/pass/reenter), scheduler tick, SSE event stream via EventBus. |
| `@harness/sdk` | `packages/sdk` | Type-safe API client (`HarnessClient` class) + React hooks (`useLanes`, `useLane`, `useSSE`, `useMutation`) for frontend consumption. |
| `@harness/web` | `packages/web` | Next.js 15 frontend (port 3100) — real-time dashboard, lane detail view, pipeline visualization, action controls. Tailwind CSS 4. |

## The 12-Stage Pipeline

| # | Stage | What happens | Auto/Manual |
|---|-------|-------------|-------------|
| 0 | **intake** | Lane created, config loaded | Auto |
| 1 | **implement** | AI agent writes code in isolated container | Auto |
| 2 | **gates** | Lint, type-check, unit tests | Auto |
| 3 | **PR** | Create pull request | Auto |
| 4 | **integrate** | Merge integration branch, resolve conflicts | Auto |
| 5 | **e2e+QC** | End-to-end tests + quality checks (heavy, locked) | Auto + Lock |
| 6 | **review** | Code review checkpoint | Manual |
| 7 | **er gate** | Engineering review gate | Manual |
| 8 | **push-dev** | Push to development branch | Auto |
| 9 | **dev/QC** | QA on development (heavy, locked) | Auto + Lock |
| 10 | **watch PR** | Wait for PR merge — **never auto-merges** | Manual |
| 11 | **done** | Terminal state | — |

**Heavy stages** (`e2e+QC`, `dev/QC`) acquire a global SQLite-backed lock so only one lane runs them at a time. Stale locks are cleaned after 30 minutes.

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker (for lane containers)

### Install & Run

```bash
# Install dependencies
pnpm install

# Run both API and frontend
pnpm dev

# Or run individually
pnpm dev:api   # Fastify API on http://localhost:8090
pnpm dev:web   # Next.js on http://localhost:3100
```

### Configure Lanes

Edit `lanes.yaml` at the project root:

```yaml
targetRepo: ./fixtures/sample-target-app
maxParallel: 5
basePort: 4001
integrationBranch: development
agent: claude-code

lanes:
  - title: "Chat bubble tables: scroll + sticky header"
    slug: chat-md-tables
    tags: [api, fe, GO]
    criteria:
      - "sticky header khi scroll danh sách"
      - "không vỡ layout mobile"

  - title: "Codebase quick-wins refactor"
    slug: codebase-quick-wins
    tags: [api, fe, GO]
    criteria:
      - "không đổi behavior"
      - "test xanh"
```

## API Endpoints

### Lanes
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/lanes` | List all lanes |
| `GET` | `/api/lanes/:id` | Get lane detail + stage runs |
| `POST` | `/api/lanes` | Create a new lane |
| `POST` | `/api/lanes/:id/up` | Start lane (Docker up) |
| `POST` | `/api/lanes/:id/down` | Stop lane (Docker down) |

### Stage Actions
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/lanes/:id/advance` | Advance to next stage |
| `POST` | `/api/lanes/:id/block` | Block current stage with reason |
| `POST` | `/api/lanes/:id/pass` | Pass current stage |
| `POST` | `/api/lanes/:id/reenter` | Re-enter current stage (bump attempt) |
| `GET` | `/api/lanes/:id/lock` | Check lock status |

### Scheduler
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/scheduler/start` | Start auto-polling scheduler |
| `POST` | `/api/scheduler/stop` | Stop scheduler |
| `GET` | `/api/scheduler/status` | Get scheduler state (running, ticks, last tick) |
| `POST` | `/api/scheduler/tick` | Trigger one manual scheduler tick |

### Agent Control (new — "harness thin" architecture)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/lanes/:id/launch` | Launch long-lived agent session for lane |
| `POST` | `/api/lanes/:id/resume` | Resume agent session (human-in-loop) |
| `GET` | `/api/lanes/:id/session` | Get active agent session info |
| `GET` | `/api/sessions` | List all active agent sessions |

### Lock API (agent-initiated)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/locks/acquire` | Agent acquires heavy-stage lock |
| `POST` | `/api/locks/release` | Agent releases lock |

### Lane Signals (PR review loop)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/lanes/:slug/signal` | Signal a lane to re-enter and fix |

### Monitoring
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Basic health check |
| `GET` | `/api/health/deep` | Deep health (DB, scheduler, lanes) |
| `GET` | `/api/audit?limit=100&level=error` | Query audit log |
| `GET` | `/api/metrics` | System metrics (lanes, stages, locks, scheduler) |
| `GET` | `/api/events/stream` | SSE stream — real-time events |

## SSE Events

The frontend receives real-time updates via Server-Sent Events at `/api/events/stream`:

```typescript
type SSEEvent =
  | { type: "lane:created"; lane: Lane }
  | { type: "lane:updated"; lane: Lane }
  | { type: "stage:entered"; laneId: number; stage: StageName }
  | { type: "stage:passed"; laneId: number; stage: StageName }
  | { type: "stage:failed"; laneId: number; stage: StageName; reason: string }
  | { type: "stage:blocked"; laneId: number; reason: string }
  | { type: "lock:acquired"; lockType: string; laneId: number }
  | { type: "lock:released"; lockType: string }
  | { type: "scheduler:tick"; result: SchedulerTickResponse }
  | { type: "scheduler:started" }
  | { type: "scheduler:stopped" }
  | { type: "scheduler:tick"; result: SchedulerTickResponse }
```

## SDK Usage

### Vanilla TypeScript

```typescript
import { HarnessClient } from "@harness/sdk";

const client = new HarnessClient("http://localhost:8090");

// List lanes
const lanes = await client.getLanes();

// Create a lane
const lane = await client.createLane({
  title: "My feature",
  slug: "my-feature",
  tags: ["api"],
});

// Advance stage
await client.advanceStage(lane.id);

// Subscribe to real-time events
const unsub = client.subscribe((event) => {
  console.log(event.type, event);
});
```

### React Hooks

```tsx
import { HarnessProvider } from "@harness/sdk/react";
import { useLanes, useLane, useSSE, useMutation } from "@harness/sdk/react";

// Wrap your app
<HarnessProvider baseUrl="http://localhost:8090">
  <App />
</HarnessProvider>

// In components
function Dashboard() {
  const { lanes, loading, refetch } = useLanes();
  const { mutate: advance } = useMutation((id: number) =>
    client.advanceStage(id)
  );

  useSSE((event) => {
    if (event.type.startsWith("lane:")) refetch();
  });

  return lanes.map((lane) => <LaneCard key={lane.id} lane={lane} />);
}
```

## Testing

```bash
# Run all tests (51 orchestrator + 5 SDK = 56 total)
pnpm test

# Run specific package tests
pnpm --filter @harness/orchestrator test
pnpm --filter @harness/sdk test
```

### Test Coverage

- **State machine**: transition map completeness, advance/block/reenter/pass/fail flows, full 12-stage pipeline traversal, crash recovery (persist-before-return)
- **Global lock**: acquire/release, idempotent same-lane, contention across lanes, stale lock cleanup
- **Agent**: spawn args, exit code handling, stderr capture, spawn error rejection
- **Exec**: docker exec command construction, lane dir execution, failure handling
- **Semaphore**: max concurrency, queuing, release order, parallel task limit
- **Scheduler**: start/stop lifecycle, double-start prevention, state persistence
- **Recovery**: reset stuck stage_runs, release orphan locks, clean state detection
- **SDK client**: getLanes, createLane, error handling, advanceStage, scheduler tick

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router), React 19, Tailwind CSS 4 |
| API | Fastify, CORS, SSE |
| Database | sql.js (WASM SQLite) — no native binary needed |
| SDK | TypeScript, EventSource API |
| Orchestration | Custom state machine, SQLite-backed locks |
| Containers | Docker (one per lane) |
| Monorepo | pnpm workspaces |
| Agent | Claude Code headless |

## Project Structure

```
feature-harness/
├── packages/
│   ├── types/           # Shared TypeScript contracts
│   │   └── src/index.ts # Lane, StageRun, SSEEvent, API types
│   ├── orchestrator/    # Core engine
│   │   └── src/
│   │       ├── db.ts            # SQLite schema + queries + audit log
│   │       ├── state-machine.ts # 12-stage transitions
│   │       ├── lock.ts          # Global SQLite lock + lock types
│   │       ├── handlers.ts      # Real stage handlers (agent, gates, PR, etc.)
│   │       ├── runner.ts        # Parallel lane runner with semaphore
│   │       ├── scheduler.ts     # Server-side polling loop with retry
│   │       ├── agent.ts         # Claude Code headless wrapper
│   │       ├── exec.ts          # Docker exec + lane dir commands
│   │       ├── prompt-builder.ts # Build prompts from lane config
│   │       ├── semaphore.ts     # Promise-based concurrency limiter
│   │       ├── logger.ts        # Structured JSON logger
│   │       ├── recovery.ts      # Crash recovery on boot
│   │       ├── lane-manager.ts  # Docker lifecycle
│   │       └── config.ts        # YAML config loader
│   ├── api/             # Fastify REST + SSE
│   │   └── src/
│   │       ├── index.ts         # Server entry
│   │       ├── event-bus.ts     # In-process EventEmitter
│   │       └── routes/
│   │           ├── lanes.ts     # CRUD lanes
│   │           ├── actions.ts   # up/down + SSE broadcast
│   │           ├── stage-routes.ts # advance/block/pass/reenter
│   │           ├── scheduler.ts # start/stop/status scheduler
│   │           ├── monitoring.ts # audit, metrics, deep health
│   │           ├── sse.ts       # GET /api/events/stream
│   │           └── health.ts    # Health check
│   ├── sdk/             # API client + React hooks
│   │   └── src/
│   │       ├── client.ts        # HarnessClient class (+ scheduler methods)
│   │       ├── sse.ts           # SSE connection helper
│   │       └── react/
│   │           ├── provider.tsx  # HarnessProvider context
│   │           └── hooks.ts     # useLanes, useLane, useSSE, useMutation
│   └── web/             # Next.js frontend
│       └── src/
│           ├── app/
│           │   ├── layout.tsx   # Root layout + NavBar + providers
│           │   ├── page.tsx     # Dashboard + scheduler control
│           │   ├── audit/page.tsx    # Audit log viewer
│           │   └── lanes/[id]/page.tsx  # Lane detail
│           └── components/
│               ├── PipelineSVG.tsx       # 12-stage visual pipeline
│               ├── LaneCard.tsx         # Lane summary card
│               ├── StatusCounter.tsx    # Status count pills
│               ├── ActionBar.tsx        # Stage action buttons
│               ├── EventTimeline.tsx    # Real-time event log
│               ├── StageRunTable.tsx    # Stage run history
│               ├── SchedulerControl.tsx # Start/stop/tick scheduler
│               └── NavBar.tsx           # Navigation + health indicator
├── skills/              # Agent skill files (copied into each lane)
│   ├── feature-workflow.md   # 12-stage workflow composing Superpowers
│   └── pr-review-loop.md    # Dedicated PR review lane
├── tools/               # CLI tools installed in each lane
│   ├── harness-report        # Write state.json for monitor
│   ├── harness-lock          # Acquire/release global heavy lock
│   └── harness-signal-lane   # PR review → feature lane signal
├── lanes.yaml           # Lane definitions
├── package.json         # Root workspace scripts
└── pnpm-workspace.yaml  # Workspace config
```

## Development Phases

- [x] **Phase 0** — Scaffold: DB (sql.js), API (Fastify), live dashboard
- [x] **Phase 1** — Lane lifecycle: Docker isolation, clone, up/down, port allocation
- [x] **Phase 2** — State machine: 12-stage pipeline, global lock, handlers, runner
- [x] **Phase 2.5** — FE/BE separation: types, SDK, SSE, Next.js frontend
- [x] **Phase 3** — Agent integration: Claude Code headless, real stage handlers, prompt builder
- [x] **Phase 4** — Polling loop: server-side scheduler, auto-retry, scheduler API
- [x] **Phase 5** — Multi-lane concurrency: semaphore, parallel execution, lock types, priority
- [x] **Phase 6** — Production hardening: structured logger, crash recovery, audit log, metrics, graceful shutdown

### Redesign Phases ("Harness Thin / Skill Thick")

- [x] **Phase A** — Spike: `claude -p` + `--output-format stream-json` works in Docker (auth fix: mount only `.credentials.json` + `.claude.json`)
- [x] **Phase B** — Skills: `feature-workflow.md` + `pr-review-loop.md` compose Superpowers; `harness-report`, `harness-lock`, `harness-signal-lane` CLI tools
- [x] **Phase C** — Launcher: one long-lived session per lane (`launcher.ts`); monitor reads `state.json` → DB → SSE (`monitor.ts`)
- [x] **Phase D** — Global lock via `harness-lock` (agent-initiated); human-in-loop via `--resume` endpoint
- [ ] **Phase E** — 2 lane end-to-end test (pending: requires ANTHROPIC_API_KEY or OAuth in Docker)
- [x] **Phase F** — Documentation update (ARCHITECTURE.md, README.md)

## License

Private — internal tooling.
