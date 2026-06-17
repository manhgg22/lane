# Feature Harness — FE/BE Separation Design

**Date:** 2026-06-17
**Status:** Approved
**Goal:** Transform Feature Harness from a tightly-coupled monorepo prototype into a product-grade system with clearly separated frontend and backend, real-time updates, and a reusable SDK — so it can orchestrate AI agent workflows for any target project.

---

## Context

The current system has 3 workspace packages (`orchestrator`, `api`, `web`). The API serves the frontend as static files via `@fastify/static`, creating deployment coupling. The frontend is vanilla HTML with 4-second polling. There is no shared type contract between FE and BE — the frontend hardcodes API response shapes.

This redesign adds 2 new packages (`types`, `sdk`), rewrites the frontend as a Next.js app, adds SSE for real-time updates, and establishes type-safe contracts throughout.

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                     pnpm workspace (monorepo)                      │
│                                                                    │
│  ┌─────────────┐   ┌─────────────┐   ┌──────────────────────────┐ │
│  │ @harness/   │   │ @harness/   │   │ @harness/orchestrator    │ │
│  │ types       │◄──┤ sdk         │   │ (core logic, unchanged)  │ │
│  │             │   │             │   └────────────▲─────────────┘ │
│  └──────▲──────┘   └──────▲──────┘                │               │
│         │                 │                       │ import         │
│         │                 │              ┌────────┴──────────┐    │
│         │                 │              │ @harness/api      │    │
│         │                 │              │ (Fastify REST+SSE)│    │
│         │                 │              │ port 8090         │    │
│         │                 │              └────────▲──────────┘    │
│         │                 │                       │ HTTP + SSE    │
│         │           ┌─────┴──────┐                │               │
│         │           │ @harness/  │────────────────┘               │
│         └───────────┤ web        │                                │
│                     │ (Next.js)  │                                │
│                     │ port 3000  │                                │
│                     └────────────┘                                │
└───────────────────────────────────────────────────────────────────┘
```

### Dependency Rules

| Package | Can import from | Cannot import from |
|---|---|---|
| `@harness/types` | nothing (leaf) | — |
| `@harness/orchestrator` | `@harness/types` | api, web, sdk |
| `@harness/api` | `@harness/orchestrator`, `@harness/types` | web, sdk |
| `@harness/sdk` | `@harness/types` | orchestrator, api, web |
| `@harness/web` | `@harness/sdk`, `@harness/types` | orchestrator, api |

---

## Package Details

### 1. `@harness/types` — Shared Contracts

**Purpose:** Single source of truth for all interfaces, types, and constants shared between FE and BE.

**Contents:**

```typescript
// Lane & pipeline types
export type LaneStatus = "running" | "stalled" | "needs_you";
export type StageState = "pending" | "current" | "done" | "passed_no_evidence";
export type LaneMode = "watching-pr" | "review-loop" | "implement";
export type StageResult = "pass" | "fail" | "blocked" | null;
export const STAGES = [...] as const;
export type StageName = (typeof STAGES)[number];

export interface Lane { ... }
export interface StageRun { ... }
export interface LaneEvent { ... }
export interface LaneConfig { ... }
export interface HarnessConfig { ... }

// API shapes
export interface CreateLaneRequest { title: string; slug: string; tags?: string[] }
export interface LaneResponse { ok: true; lane: Lane }
export interface ErrorResponse { error: string }
export interface SchedulerTickResponse { ok: true; processed: number; results: RunResult[] }
export interface LockInfo { locked: boolean; laneId?: number; acquiredAt?: string }

// SSE event types
export type SSEEvent =
  | { type: "lane:created"; lane: Lane }
  | { type: "lane:updated"; lane: Lane }
  | { type: "stage:entered"; laneId: number; stage: StageName }
  | { type: "stage:passed"; laneId: number; stage: StageName }
  | { type: "stage:failed"; laneId: number; stage: StageName; reason: string }
  | { type: "stage:blocked"; laneId: number; reason: string }
  | { type: "lock:acquired"; lockType: string; laneId: number }
  | { type: "lock:released"; lockType: string }
  | { type: "scheduler:tick"; result: SchedulerTickResponse }

// Runner types
export interface RunResult { laneId: number; stage: StageName; action: string; reason?: string }
export interface SchedulerResult { processed: number; results: RunResult[] }
```

**Migration:** Move all types from `orchestrator/src/types.ts` → `types/src/`. Delete `orchestrator/src/types.ts`. Orchestrator's `index.ts` re-exports everything from `@harness/types` so existing consumers (api routes) don't break.

---

### 2. `@harness/orchestrator` — Core Logic (Minimal Changes)

**Changes:**
- Import types from `@harness/types` instead of local `types.ts`
- Delete `src/types.ts`, re-export from `@harness/types`
- Everything else unchanged (db, state-machine, lock, handlers, runner, lane-manager, config, seed)

---

### 3. `@harness/api` — REST + SSE Server

**Changes from current:**

1. **Remove `@fastify/static`** — no longer serves FE
2. **CORS config** — allow `http://localhost:3000` (Next.js dev server)
3. **Add EventBus** — in-process event emitter
4. **Add SSE endpoint** — `GET /api/events/stream`
5. **Emit SSE events** after every state change in routes

**EventBus (`api/src/event-bus.ts`):**
```typescript
import { EventEmitter } from "node:events";
import type { SSEEvent } from "@harness/types";

class EventBus extends EventEmitter {
  broadcast(event: SSEEvent): void {
    this.emit("sse", event);
  }
}

export const eventBus = new EventBus();
```

**SSE Endpoint (`GET /api/events/stream`):**
- Sets `Content-Type: text/event-stream`
- Keeps connection open
- Listens on EventBus, writes `data: JSON\n\n` per event
- Client disconnect → cleanup listener

**Route integration example:**
```typescript
// POST /api/lanes/:id/advance
const updated = advanceStage(db, id);
eventBus.broadcast({ type: "stage:entered", laneId: id, stage: STAGES[updated.stageIndex] });
return { ok: true, lane: updated };
```

**API Routes (unchanged + new):**

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/lanes` | List all lanes |
| GET | `/api/lanes/:id` | Lane detail + stage runs |
| GET | `/api/lanes/:id/events` | Lane events |
| POST | `/api/lanes` | Create lane |
| POST | `/api/lanes/:id/up` | Docker up |
| POST | `/api/lanes/:id/down` | Docker down |
| POST | `/api/lanes/:id/pass` | Pass current stage |
| POST | `/api/lanes/:id/advance` | Advance to next stage |
| POST | `/api/lanes/:id/block` | Block current stage |
| POST | `/api/lanes/:id/reenter` | Re-enter stage |
| GET | `/api/lanes/:id/lock` | Check lock |
| POST | `/api/scheduler/tick` | Trigger scheduler |
| **GET** | **`/api/events/stream`** | **SSE stream (NEW)** |

---

### 4. `@harness/sdk` — Type-Safe API Client

**Purpose:** Single API client used by FE (and potentially CLI in the future). Handles HTTP calls, SSE subscription, and provides React hooks.

**Structure:**
```
packages/sdk/
├── src/
│   ├── client.ts        (HarnessClient class — fetch wrapper)
│   ├── sse.ts           (SSE subscription logic)
│   ├── react/
│   │   ├── provider.tsx (HarnessProvider context)
│   │   ├── hooks.ts     (useLanes, useLane, useSSE, useMutation)
│   │   └── index.ts
│   └── index.ts         (exports client + react)
└── package.json         (depends on @harness/types)
```

**HarnessClient:**
```typescript
class HarnessClient {
  constructor(baseUrl: string)

  // Read
  getLanes(): Promise<Lane[]>
  getLane(id: number): Promise<Lane & { stageRuns: StageRun[] }>
  getEvents(id: number, after?: number): Promise<LaneEvent[]>
  getLock(id: number): Promise<LockInfo>

  // Write
  createLane(opts: CreateLaneRequest): Promise<Lane>
  upLane(id: number): Promise<Lane>
  downLane(id: number): Promise<Lane>
  passStage(id: number, evidence?: string[]): Promise<Lane>
  advanceStage(id: number): Promise<Lane>
  blockStage(id: number, reason: string): Promise<Lane>
  reenterStage(id: number): Promise<Lane>
  tick(): Promise<SchedulerResult>

  // SSE
  subscribe(handler: (event: SSEEvent) => void): () => void
}
```

**React Hooks:**
```typescript
// Provider wraps app with HarnessClient instance
function HarnessProvider({ baseUrl, children }): JSX.Element

// Hooks
function useLanes(): { lanes: Lane[]; loading: boolean; error: Error | null }
function useLane(id: number): { lane: Lane | null; stageRuns: StageRun[]; events: LaneEvent[]; loading: boolean }
function useSSE(handler: (event: SSEEvent) => void): void
function useMutation<T>(action: (client: HarnessClient) => Promise<T>): { mutate: () => void; loading: boolean; error: Error | null }
```

---

### 5. `@harness/web` — Next.js Frontend

**Stack:** Next.js 15 (App Router) + TypeScript + Tailwind CSS

**Pages:**

| Route | Description |
|---|---|
| `/` | Dashboard — lane grid, pipeline SVG, header counters, real-time updates |
| `/lanes/[id]` | Lane detail — stage timeline, event log, action buttons, stage run history |
| `/settings` | Config viewer (read-only), system health status |

**Components:**
- `LaneCard` — lane title, status badges, progress bar, quick actions
- `PipelineSVG` — 12-stage pipeline with current stage highlighted
- `EventTimeline` — scrolling event log with auto-update via SSE
- `StageRunTable` — attempt history per stage (attempt #, result, evidence, duration)
- `ActionBar` — contextual action buttons (pass/advance/block/reenter/up/down)
- `StatusCounter` — header counters (running/stalled/needs_you/done)

**Data flow:**
1. Page loads → `useLanes()` fetches initial data from API
2. `useSSE()` connects to `GET /api/events/stream`
3. SSE events arrive → update React state in-place (no re-fetch needed)
4. User clicks action → `useMutation()` calls SDK → API → orchestrator → SSE broadcasts update → all clients update

**Dev server config (next.config.ts):**
```typescript
// Proxy /api/* to Fastify in development
rewrites: async () => [
  { source: "/api/:path*", destination: "http://localhost:8090/api/:path*" }
]
```
This eliminates CORS issues in dev mode.

---

## Deployment (Local Dev)

```bash
# Terminal 1: Backend
pnpm --filter @harness/api dev     # Fastify on :8090

# Terminal 2: Frontend
pnpm --filter @harness/web dev     # Next.js on :3000

# Open browser
http://localhost:3000
```

No auth required. CORS configured for localhost only.

---

## Implementation Phases

### Phase A: Extract `@harness/types`
- Move types from orchestrator to new package
- Update orchestrator imports
- Verify all 32 tests still pass

### Phase B: Create `@harness/sdk`
- Build HarnessClient with all API methods
- Build SSE subscription
- Build React hooks + provider

### Phase C: Add SSE to `@harness/api`
- Add EventBus
- Add SSE endpoint
- Emit events from all state-changing routes
- Remove @fastify/static
- Configure CORS for localhost:3000

### Phase D: Build `@harness/web` (Next.js)
- Scaffold Next.js app with App Router + Tailwind
- Port dashboard layout from vanilla HTML
- Build components: LaneCard, PipelineSVG, EventTimeline, StageRunTable, ActionBar
- Wire up SDK hooks for data fetching + SSE
- Wire up action buttons with useMutation

### Phase E: Integration Testing
- Verify FE↔BE communication works via proxy
- Test SSE real-time updates (create lane in one tab, see it appear in another)
- Test all action buttons work
- Verify no regressions in existing 32 unit tests

---

## Out of Scope

- Authentication / authorization
- Cloud deployment (Vercel, Fly.io, etc.)
- Database migration (stays SQLite/sql.js)
- Mobile responsive design (desktop-first)
- i18n / localization
- `@harness/cli` (future, can use SDK when built)
