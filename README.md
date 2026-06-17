# Feature Harness

A local orchestrator that runs multiple AI agents (Claude Code headless) in parallel, each in isolated Docker containers, to develop features across independent "lanes" — from intake to PR merge.

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

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/scheduler/tick` | Trigger one scheduler tick |
| `GET` | `/api/events/stream` | SSE stream — real-time events |
| `GET` | `/api/health` | Health check |

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
# Run all tests (32 orchestrator + 5 SDK = 37 total)
pnpm test

# Run specific package tests
pnpm --filter @harness/orchestrator test
pnpm --filter @harness/sdk test
```

### Test Coverage

- **State machine**: transition map completeness, advance/block/reenter/pass/fail flows, full 12-stage pipeline traversal, crash recovery (persist-before-return)
- **Global lock**: acquire/release, idempotent same-lane, contention across lanes, stale lock cleanup
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
│   │       ├── db.ts            # SQLite schema + queries
│   │       ├── state-machine.ts # 12-stage transitions
│   │       ├── lock.ts          # Global SQLite lock
│   │       ├── handlers.ts      # Stage handler registry
│   │       ├── runner.ts        # Lane runner + scheduler
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
│   │           ├── sse.ts       # GET /api/events/stream
│   │           └── health.ts    # Health check
│   ├── sdk/             # API client + React hooks
│   │   └── src/
│   │       ├── client.ts        # HarnessClient class
│   │       ├── sse.ts           # SSE connection helper
│   │       └── react/
│   │           ├── provider.tsx  # HarnessProvider context
│   │           └── hooks.ts     # useLanes, useLane, useSSE, useMutation
│   └── web/             # Next.js frontend
│       └── src/
│           ├── app/
│           │   ├── layout.tsx   # Root layout + providers
│           │   ├── page.tsx     # Dashboard
│           │   └── lanes/[id]/page.tsx  # Lane detail
│           └── components/
│               ├── PipelineSVG.tsx    # 12-stage visual pipeline
│               ├── LaneCard.tsx      # Lane summary card
│               ├── StatusCounter.tsx  # Status count pills
│               ├── ActionBar.tsx     # Stage action buttons
│               ├── EventTimeline.tsx # Real-time event log
│               └── StageRunTable.tsx # Stage run history
├── lanes.yaml           # Lane definitions
├── package.json         # Root workspace scripts
└── pnpm-workspace.yaml  # Workspace config
```

## Development Phases

- [x] **Phase 0** — Scaffold: DB (sql.js), API (Fastify), live dashboard
- [x] **Phase 1** — Lane lifecycle: Docker isolation, clone, up/down, port allocation
- [x] **Phase 2** — State machine: 12-stage pipeline, global lock, handlers, runner
- [x] **Phase 2.5** — FE/BE separation: types, SDK, SSE, Next.js frontend
- [ ] **Phase 3** — Agent integration: Claude Code headless in containers
- [ ] **Phase 4** — Polling loop: auto-advance, retry logic, timeout handling
- [ ] **Phase 5** — Multi-lane concurrency: parallel execution with lock coordination
- [ ] **Phase 6** — Production hardening: error recovery, monitoring, logging

## License

Private — internal tooling.
