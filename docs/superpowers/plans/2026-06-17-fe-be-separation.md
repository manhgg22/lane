# FE/BE Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Feature Harness into 5 independent packages with type-safe contracts, real-time SSE updates, a reusable SDK, and a Next.js frontend — so the system can orchestrate AI agent workflows for any target project.

**Architecture:** Extract shared types into `@harness/types` (leaf package). Orchestrator imports from types instead of local file. API drops `@fastify/static`, adds EventBus+SSE, emits events on every state change. SDK wraps HTTP+SSE into `HarnessClient` class + React hooks. Next.js app replaces vanilla HTML dashboard, consuming SDK hooks for data fetching and real-time updates. Dev proxy routes `/api/*` from Next.js (port 3000) to Fastify (port 8090).

**Tech Stack:** pnpm workspaces, TypeScript 5.8, sql.js, Fastify 5, Next.js 15 (App Router), Tailwind CSS 4, React 19, vitest

## Global Constraints

- Node.js ≥ 20, pnpm ≥ 9
- All packages use ESM (`"type": "module"`)
- TypeScript strict mode, extends `../../tsconfig.base.json`
- Module resolution: `Node16` (requires `.js` extensions in relative imports)
- No authentication required
- Existing 32 unit tests must continue passing after every task
- Dependency rules: types→nothing; orchestrator→types; api→orchestrator,types; sdk→types; web→sdk,types

---

### Task 1: Create `@harness/types` package

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/index.ts`
- Modify: `packages/orchestrator/src/types.ts` (delete entirely)
- Modify: `packages/orchestrator/package.json` (add `@harness/types` dep)
- Modify: `packages/orchestrator/src/state-machine.ts:1-13` (update imports)
- Modify: `packages/orchestrator/src/handlers.ts:1-4` (update imports)
- Modify: `packages/orchestrator/src/runner.ts:1-5` (update imports)
- Modify: `packages/orchestrator/src/db.ts` (update Lane/StageRun/LaneEvent imports)
- Modify: `packages/orchestrator/src/index.ts` (re-export from `@harness/types`)
- Modify: `packages/orchestrator/src/state-machine.test.ts:4` (update STAGES import)
- Modify: `packages/orchestrator/src/lock.test.ts` (no type imports to change)

**Interfaces:**
- Consumes: nothing (leaf package)
- Produces: All types and constants — `Lane`, `StageRun`, `LaneEvent`, `LaneConfig`, `HarnessConfig`, `LaneStatus`, `StageState`, `LaneMode`, `StageResult`, `StageName`, `STAGES`, plus new API contract types: `CreateLaneRequest`, `LaneResponse`, `ErrorResponse`, `SchedulerTickResponse`, `LockInfo`, `SSEEvent`, `RunResult`, `SchedulerResult`

- [ ] **Step 1: Create `packages/types/package.json`**

```json
{
  "name": "@harness/types",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "tsc"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: Create `packages/types/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/types/src/index.ts`**

Move all content from `packages/orchestrator/src/types.ts` and add new API/SSE contracts:

```typescript
// ── Core pipeline types ──

export type LaneStatus = "running" | "stalled" | "needs_you";
export type StageState = "pending" | "current" | "done" | "passed_no_evidence";
export type LaneMode = "watching-pr" | "review-loop" | "implement";
export type StageResult = "pass" | "fail" | "blocked" | null;

export const STAGES = [
  "intake",
  "implement",
  "gates",
  "PR",
  "integrate",
  "e2e+QC",
  "review",
  "er gate",
  "push-dev",
  "dev/QC",
  "watch PR",
  "done",
] as const;

export type StageName = (typeof STAGES)[number];

export interface Lane {
  id: number;
  title: string;
  slug: string;
  branch: string;
  mode: LaneMode;
  port: number;
  dbUrl: string;
  tags: string[];
  status: LaneStatus[];
  stageIndex: number;
  progress: number;
  ticket: string | null;
  prNumber: number | null;
  git: { commit: string; subject: string; ci: string };
  note: string;
  qc: { dev: number; local: number };
  updatedAt: string;
  createdAt: string;
}

export interface StageRun {
  id: number;
  laneId: number;
  stage: string;
  state: StageState;
  attempt: number;
  evidence: string[];
  startedAt: string;
  endedAt: string | null;
  result: StageResult;
  message: string;
}

export interface LaneEvent {
  id: number;
  laneId: number;
  ts: string;
  type:
    | "stage_enter"
    | "stage_pass"
    | "stage_fail"
    | "re_enter"
    | "blocked"
    | "action";
  payload: Record<string, unknown>;
}

export interface LaneConfig {
  title: string;
  slug: string;
  tags: string[];
  criteria: string[];
}

export interface HarnessConfig {
  targetRepo: string;
  maxParallel: number;
  basePort: number;
  integrationBranch: string;
  agent: string;
  lanes: LaneConfig[];
}

// ── API request/response contracts ──

export interface CreateLaneRequest {
  title: string;
  slug: string;
  tags?: string[];
  criteria?: string[];
}

export interface LaneResponse {
  ok: true;
  lane: Lane;
}

export interface ErrorResponse {
  error: string;
}

export interface SchedulerTickResponse {
  ok: true;
  processed: number;
  results: RunResult[];
}

export interface LockInfo {
  locked: boolean;
  laneId?: number;
  acquiredAt?: string;
}

// ── Runner types ──

export interface RunResult {
  laneId: number;
  stage: StageName;
  action: "advanced" | "failed" | "blocked" | "skipped";
  reason?: string;
}

export interface SchedulerResult {
  processed: number;
  results: RunResult[];
}

// ── SSE event types ──

export type SSEEvent =
  | { type: "lane:created"; lane: Lane }
  | { type: "lane:updated"; lane: Lane }
  | { type: "stage:entered"; laneId: number; stage: StageName }
  | { type: "stage:passed"; laneId: number; stage: StageName }
  | { type: "stage:failed"; laneId: number; stage: StageName; reason: string }
  | { type: "stage:blocked"; laneId: number; reason: string }
  | { type: "lock:acquired"; lockType: string; laneId: number }
  | { type: "lock:released"; lockType: string }
  | { type: "scheduler:tick"; result: SchedulerTickResponse };
```

- [ ] **Step 4: Delete `packages/orchestrator/src/types.ts`**

Remove the file entirely.

- [ ] **Step 5: Add `@harness/types` dependency to orchestrator**

In `packages/orchestrator/package.json`, add to `dependencies`:

```json
{
  "dependencies": {
    "@harness/types": "workspace:*",
    "sql.js": "^1.12.0"
  }
}
```

- [ ] **Step 6: Update orchestrator imports to use `@harness/types`**

**`packages/orchestrator/src/state-machine.ts`** — replace lines 12-13:

```typescript
// OLD:
import { STAGES } from "./types.js";
import type { Lane, StageName, StageRun } from "./types.js";

// NEW:
import { STAGES } from "@harness/types";
import type { Lane, StageName, StageRun } from "@harness/types";
```

**`packages/orchestrator/src/handlers.ts`** — replace lines 2-4:

```typescript
// OLD:
import type { Lane, StageName, StageResult } from "./types.js";
import { STAGES } from "./types.js";

// NEW:
import type { Lane, StageName, StageResult } from "@harness/types";
import { STAGES } from "@harness/types";
```

**`packages/orchestrator/src/runner.ts`** — replace lines 2-4:

```typescript
// OLD:
import { STAGES } from "./types.js";
import type { StageName } from "./types.js";

// NEW:
import { STAGES } from "@harness/types";
import type { StageName } from "@harness/types";
```

Also remove the `RunResult` and `SchedulerResult` interface definitions from `runner.ts` (lines 15-25) and import them instead:

```typescript
import type { StageName, RunResult, SchedulerResult } from "@harness/types";
```

**`packages/orchestrator/src/db.ts`** — find and replace type imports from `./types.js` with `@harness/types`. The db module imports `Lane`, `StageRun`, `LaneEvent`, `LaneStatus`, `StageState`, `StageResult`, `LaneMode` — change all to:

```typescript
import type { Lane, StageRun, LaneEvent, LaneStatus, StageState, StageResult, LaneMode } from "@harness/types";
```

**`packages/orchestrator/src/config.ts`** — if it imports from `./types.js`, update similarly.

**`packages/orchestrator/src/seed.ts`** — if it imports from `./types.js`, update similarly.

**`packages/orchestrator/src/lane-manager.ts`** — if it imports from `./types.js`, update similarly.

- [ ] **Step 7: Update `packages/orchestrator/src/index.ts` re-exports**

Replace the types re-export lines:

```typescript
// OLD:
export { STAGES } from "./types.js";
export type { Lane, StageRun, LaneEvent, LaneConfig, HarnessConfig, LaneStatus, StageState, LaneMode, StageName, StageResult } from "./types.js";

// NEW (re-export everything from @harness/types so existing api imports don't break):
export { STAGES } from "@harness/types";
export type { Lane, StageRun, LaneEvent, LaneConfig, HarnessConfig, LaneStatus, StageState, LaneMode, StageName, StageResult, CreateLaneRequest, LaneResponse, ErrorResponse, SchedulerTickResponse, LockInfo, SSEEvent, RunResult, SchedulerResult } from "@harness/types";
```

Also remove the local `RunResult`/`SchedulerResult` re-exports from runner.ts since they now come from types:

```typescript
// OLD:
export { runLane, runScheduler } from "./runner.js";
export type { RunResult, SchedulerResult } from "./runner.js";

// NEW:
export { runLane, runScheduler } from "./runner.js";
```

- [ ] **Step 8: Update test imports**

**`packages/orchestrator/src/state-machine.test.ts`** line 4 — change:

```typescript
// OLD:
import { STAGES } from "./types.js";

// NEW:
import { STAGES } from "@harness/types";
```

`lock.test.ts` does not import from `./types.js` so no changes needed.

- [ ] **Step 9: Install dependencies and run tests**

Run: `pnpm install`

Run: `pnpm --filter @harness/orchestrator test`

Expected: All 32 tests pass (25 state-machine + 7 lock tests).

- [ ] **Step 10: Commit**

```bash
git add packages/types/ packages/orchestrator/
git commit -m "feat: extract @harness/types package with shared contracts"
```

---

### Task 2: Add SSE to `@harness/api`

**Files:**
- Create: `packages/api/src/event-bus.ts`
- Create: `packages/api/src/routes/sse.ts`
- Modify: `packages/api/src/index.ts` (remove @fastify/static, add CORS origin, register SSE route, create+pass eventBus)
- Modify: `packages/api/src/routes/actions.ts` (accept eventBus, emit events)
- Modify: `packages/api/src/routes/stage-routes.ts` (accept eventBus, emit events)
- Modify: `packages/api/package.json` (remove @fastify/static dep, add @harness/types dep)

**Interfaces:**
- Consumes: `SSEEvent` from `@harness/types` (Task 1)
- Produces: `EventBus` class with `broadcast(event: SSEEvent): void`; `GET /api/events/stream` SSE endpoint

- [ ] **Step 1: Create `packages/api/src/event-bus.ts`**

```typescript
import { EventEmitter } from "node:events";
import type { SSEEvent } from "@harness/types";

class EventBus extends EventEmitter {
  broadcast(event: SSEEvent): void {
    this.emit("sse", event);
  }
}

export const eventBus = new EventBus();
export type { EventBus };
```

- [ ] **Step 2: Create `packages/api/src/routes/sse.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import type { EventBus } from "../event-bus.js";
import type { SSEEvent } from "@harness/types";

export async function sseRoutes(app: FastifyInstance, bus: EventBus): Promise<void> {
  app.get("/api/events/stream", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const handler = (event: SSEEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    bus.on("sse", handler);

    request.raw.on("close", () => {
      bus.off("sse", handler);
    });
  });
}
```

- [ ] **Step 3: Update `packages/api/package.json`**

Remove `@fastify/static` from dependencies. Add `@harness/types`:

```json
{
  "dependencies": {
    "@harness/orchestrator": "workspace:*",
    "@harness/types": "workspace:*",
    "fastify": "^5.3.3",
    "@fastify/cors": "^11.0.1"
  }
}
```

- [ ] **Step 4: Update route signatures to accept EventBus**

**`packages/api/src/routes/actions.ts`** — add EventBus parameter and emit events:

```typescript
import type { FastifyInstance } from "fastify";
import type { Database, HarnessConfig, Lane } from "@harness/orchestrator";
import type { EventBus } from "../event-bus.js";
import type { SSEEvent } from "@harness/types";
import { STAGES } from "@harness/types";
import {
  getLaneById,
  getAllLanes,
  createFullLane,
  upLane,
  downLane,
  loadConfig,
  insertEvent,
  insertStageRun,
} from "@harness/orchestrator";

export async function actionRoutes(
  app: FastifyInstance,
  db: Database,
  config: HarnessConfig,
  rootDir: string,
  bus: EventBus,
): Promise<void> {
  const MAX_PARALLEL = config.maxParallel;

  app.post<{ Body: { title: string; slug: string; tags?: string[]; criteria?: string[] } }>(
    "/api/lanes",
    async (request, reply) => {
      const { title, slug, tags, criteria } = request.body;
      if (!title || !slug) {
        return reply.status(400).send({ error: "title and slug required" });
      }

      const existing = getAllLanes(db);
      const running = existing.filter((l) =>
        l.status.some((s) => s === "running"),
      );
      if (running.length >= MAX_PARALLEL) {
        return reply.status(429).send({
          error: `Max parallel lanes (${MAX_PARALLEL}) reached. Stop a lane first.`,
        });
      }

      try {
        const lane = await createFullLane(rootDir, config, {
          title,
          slug,
          tags: tags ?? [],
          criteria: criteria ?? [],
        }, db);
        insertStageRun(db, lane.id, "intake");
        insertEvent(db, lane.id, "action", { action: "create", slug });
        bus.broadcast({ type: "lane:created", lane });
        return { ok: true, lane };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/lanes/:id/up",
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const lane = getLaneById(db, id);
      if (!lane) return reply.status(404).send({ error: "Lane not found" });

      try {
        await upLane(rootDir, lane);
        insertEvent(db, lane.id, "action", { action: "up" });
        const updated = getLaneById(db, id)!;
        bus.broadcast({ type: "lane:updated", lane: updated });
        return { ok: true, lane: updated };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/lanes/:id/down",
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const lane = getLaneById(db, id);
      if (!lane) return reply.status(404).send({ error: "Lane not found" });

      try {
        await downLane(rootDir, lane);
        insertEvent(db, lane.id, "action", { action: "down" });
        const updated = getLaneById(db, id)!;
        bus.broadcast({ type: "lane:updated", lane: updated });
        return { ok: true, lane: updated };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    },
  );
}
```

**`packages/api/src/routes/stage-routes.ts`** — add EventBus parameter and emit events:

```typescript
import type { FastifyInstance } from "fastify";
import type { Database } from "@harness/orchestrator";
import type { EventBus } from "../event-bus.js";
import { STAGES } from "@harness/types";
import type { StageName } from "@harness/types";
import {
  getLaneById,
  advanceStage,
  blockStage,
  reEnterStage,
  passStage,
  getActiveLock,
  runScheduler,
} from "@harness/orchestrator";

export async function stageRoutes(
  app: FastifyInstance,
  db: Database,
  bus: EventBus,
): Promise<void> {
  app.post<{ Params: { id: string } }>("/api/lanes/:id/advance", async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const lane = getLaneById(db, id);
    if (!lane) return reply.status(404).send({ error: "Lane not found" });

    try {
      const updated = advanceStage(db, id);
      const stage = STAGES[updated.stageIndex] as StageName;
      bus.broadcast({ type: "stage:entered", laneId: id, stage });
      bus.broadcast({ type: "lane:updated", lane: updated });
      return { ok: true, lane: updated };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/api/lanes/:id/block",
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      const lane = getLaneById(db, id);
      if (!lane) return reply.status(404).send({ error: "Lane not found" });

      const reason = (req.body as { reason?: string })?.reason ?? "manually blocked";
      try {
        const updated = blockStage(db, id, reason);
        bus.broadcast({ type: "stage:blocked", laneId: id, reason });
        bus.broadcast({ type: "lane:updated", lane: updated });
        return { ok: true, lane: updated };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { stage?: StageName } }>(
    "/api/lanes/:id/reenter",
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      const lane = getLaneById(db, id);
      if (!lane) return reply.status(404).send({ error: "Lane not found" });

      const stage = (req.body as { stage?: StageName })?.stage ?? (STAGES[lane.stageIndex] as StageName);
      try {
        const updated = reEnterStage(db, id, stage);
        bus.broadcast({ type: "lane:updated", lane: updated });
        return { ok: true, lane: updated };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { evidence?: string[] } }>(
    "/api/lanes/:id/pass",
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      const lane = getLaneById(db, id);
      if (!lane) return reply.status(404).send({ error: "Lane not found" });

      const evidence = (req.body as { evidence?: string[] })?.evidence ?? [];
      try {
        const updated = passStage(db, id, evidence);
        const stage = STAGES[lane.stageIndex] as StageName;
        bus.broadcast({ type: "stage:passed", laneId: id, stage });
        bus.broadcast({ type: "lane:updated", lane: updated });
        return { ok: true, lane: updated };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.get<{ Params: { id: string } }>("/api/lanes/:id/lock", async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const lane = getLaneById(db, id);
    if (!lane) return reply.status(404).send({ error: "Lane not found" });

    const lock = getActiveLock(db, "heavy_stage");
    if (lock && lock.laneId === id) {
      return { locked: true, ...lock };
    }
    return { locked: false };
  });

  app.post("/api/scheduler/tick", async () => {
    const result = await runScheduler(db);
    bus.broadcast({ type: "scheduler:tick", result: { ok: true, ...result } });
    return { ok: true, ...result };
  });
}
```

- [ ] **Step 5: Update `packages/api/src/index.ts`**

Replace the full file:

```typescript
import Fastify from "fastify";
import cors from "@fastify/cors";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, seedDemoData, loadConfig, reconcileOnBoot } from "@harness/orchestrator";
import { eventBus } from "./event-bus.js";
import { healthRoutes } from "./routes/health.js";
import { laneRoutes } from "./routes/lanes.js";
import { actionRoutes } from "./routes/actions.js";
import { stageRoutes } from "./routes/stage-routes.js";
import { sseRoutes } from "./routes/sse.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "../../..");
const HARNESS_PORT = parseInt(process.env.HARNESS_PORT ?? "8090", 10);
const DB_PATH = process.env.DATABASE_PATH ?? resolve(ROOT_DIR, ".harness/db/harness.db");
const CONFIG_PATH = process.env.CONFIG_PATH ?? resolve(ROOT_DIR, "lanes.yaml");

const db = await openDb(DB_PATH);
seedDemoData(db);

const config = loadConfig(CONFIG_PATH);
console.log(`Loaded config: ${config.lanes.length} lane definitions, targetRepo=${config.targetRepo}`);

reconcileOnBoot(ROOT_DIR, db);

const app = Fastify({ logger: true });

await app.register(cors, { origin: ["http://localhost:3000"] });

await healthRoutes(app);
await laneRoutes(app, db);
await actionRoutes(app, db, config, ROOT_DIR, eventBus);
await stageRoutes(app, db, eventBus);
await sseRoutes(app, eventBus);

try {
  await app.listen({ port: HARNESS_PORT, host: "0.0.0.0" });
  console.log(`Harness API running on http://localhost:${HARNESS_PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

- [ ] **Step 6: Run `pnpm install` to update lockfile**

Run: `pnpm install`

- [ ] **Step 7: Verify API starts**

Run: `pnpm --filter @harness/api dev`

Expected: Server starts on port 8090 without errors. Check `GET /api/health` returns `{ ok: true }`.

- [ ] **Step 8: Verify existing tests still pass**

Run: `pnpm --filter @harness/orchestrator test`

Expected: All 32 tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/api/ packages/orchestrator/
git commit -m "feat: add EventBus + SSE endpoint, remove @fastify/static"
```

---

### Task 3: Create `@harness/sdk` package

**Files:**
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/tsconfig.json`
- Create: `packages/sdk/src/client.ts`
- Create: `packages/sdk/src/sse.ts`
- Create: `packages/sdk/src/react/provider.tsx`
- Create: `packages/sdk/src/react/hooks.ts`
- Create: `packages/sdk/src/react/index.ts`
- Create: `packages/sdk/src/index.ts`
- Create: `packages/sdk/src/client.test.ts`

**Interfaces:**
- Consumes: All types from `@harness/types` (Task 1)
- Produces: `HarnessClient` class, `HarnessProvider` React component, `useLanes()`, `useLane(id)`, `useSSE(handler)`, `useMutation(action)` hooks

- [ ] **Step 1: Create `packages/sdk/package.json`**

```json
{
  "name": "@harness/sdk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./react": {
      "import": "./src/react/index.ts",
      "default": "./src/react/index.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@harness/types": "workspace:*"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true }
  },
  "devDependencies": {
    "react": "^19.1.0",
    "@types/react": "^19.1.0",
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create `packages/sdk/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/sdk/src/client.ts`**

```typescript
import type {
  Lane,
  StageRun,
  LaneEvent,
  CreateLaneRequest,
  LockInfo,
  SchedulerResult,
  SSEEvent,
} from "@harness/types";

export class HarnessClient {
  constructor(private baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async getLanes(): Promise<Lane[]> {
    return this.request<Lane[]>("/api/lanes");
  }

  async getLane(id: number): Promise<Lane & { stageRuns: StageRun[] }> {
    return this.request<Lane & { stageRuns: StageRun[] }>(`/api/lanes/${id}`);
  }

  async getEvents(id: number, after?: number): Promise<LaneEvent[]> {
    const qs = after != null ? `?after=${after}` : "";
    return this.request<LaneEvent[]>(`/api/lanes/${id}/events${qs}`);
  }

  async getLock(id: number): Promise<LockInfo> {
    return this.request<LockInfo>(`/api/lanes/${id}/lock`);
  }

  async createLane(opts: CreateLaneRequest): Promise<Lane> {
    const res = await this.request<{ ok: true; lane: Lane }>("/api/lanes", {
      method: "POST",
      body: JSON.stringify(opts),
    });
    return res.lane;
  }

  async upLane(id: number): Promise<Lane> {
    const res = await this.request<{ ok: true; lane: Lane }>(`/api/lanes/${id}/up`, {
      method: "POST",
    });
    return res.lane;
  }

  async downLane(id: number): Promise<Lane> {
    const res = await this.request<{ ok: true; lane: Lane }>(`/api/lanes/${id}/down`, {
      method: "POST",
    });
    return res.lane;
  }

  async passStage(id: number, evidence: string[] = []): Promise<Lane> {
    const res = await this.request<{ ok: true; lane: Lane }>(`/api/lanes/${id}/pass`, {
      method: "POST",
      body: JSON.stringify({ evidence }),
    });
    return res.lane;
  }

  async advanceStage(id: number): Promise<Lane> {
    const res = await this.request<{ ok: true; lane: Lane }>(`/api/lanes/${id}/advance`, {
      method: "POST",
    });
    return res.lane;
  }

  async blockStage(id: number, reason: string): Promise<Lane> {
    const res = await this.request<{ ok: true; lane: Lane }>(`/api/lanes/${id}/block`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    return res.lane;
  }

  async reenterStage(id: number): Promise<Lane> {
    const res = await this.request<{ ok: true; lane: Lane }>(`/api/lanes/${id}/reenter`, {
      method: "POST",
    });
    return res.lane;
  }

  async tick(): Promise<SchedulerResult> {
    const res = await this.request<{ ok: true; processed: number; results: SchedulerResult["results"] }>(
      "/api/scheduler/tick",
      { method: "POST" },
    );
    return { processed: res.processed, results: res.results };
  }

  subscribe(handler: (event: SSEEvent) => void): () => void {
    const es = new EventSource(`${this.baseUrl}/api/events/stream`);
    es.onmessage = (msg) => {
      try {
        handler(JSON.parse(msg.data) as SSEEvent);
      } catch {
        // ignore malformed messages
      }
    };
    return () => es.close();
  }
}
```

- [ ] **Step 4: Create `packages/sdk/src/sse.ts`**

```typescript
import type { SSEEvent } from "@harness/types";

export function createSSEConnection(
  url: string,
  handler: (event: SSEEvent) => void,
): () => void {
  const es = new EventSource(url);
  es.onmessage = (msg) => {
    try {
      handler(JSON.parse(msg.data) as SSEEvent);
    } catch {
      // ignore malformed
    }
  };
  return () => es.close();
}
```

- [ ] **Step 5: Create `packages/sdk/src/react/provider.tsx`**

```tsx
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { HarnessClient } from "../client.js";

const HarnessContext = createContext<HarnessClient | null>(null);

export function useHarnessClient(): HarnessClient {
  const client = useContext(HarnessContext);
  if (!client) throw new Error("useHarnessClient must be used within HarnessProvider");
  return client;
}

export function HarnessProvider({
  baseUrl,
  children,
}: {
  baseUrl: string;
  children: ReactNode;
}) {
  const client = useMemo(() => new HarnessClient(baseUrl), [baseUrl]);
  return (
    <HarnessContext value={client}>
      {children}
    </HarnessContext>
  );
}
```

- [ ] **Step 6: Create `packages/sdk/src/react/hooks.ts`**

```tsx
import { useState, useEffect, useCallback, useRef } from "react";
import type { Lane, StageRun, LaneEvent, SSEEvent } from "@harness/types";
import { useHarnessClient } from "./provider.js";
import type { HarnessClient } from "../client.js";

export function useLanes(): {
  lanes: Lane[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const client = useHarnessClient();
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(() => {
    setLoading(true);
    client
      .getLanes()
      .then((data) => {
        setLanes(data);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [client]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { lanes, loading, error, refetch: fetch };
}

export function useLane(id: number): {
  lane: (Lane & { stageRuns: StageRun[] }) | null;
  events: LaneEvent[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const client = useHarnessClient();
  const [lane, setLane] = useState<(Lane & { stageRuns: StageRun[] }) | null>(null);
  const [events, setEvents] = useState<LaneEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(() => {
    setLoading(true);
    Promise.all([client.getLane(id), client.getEvents(id)])
      .then(([laneData, eventsData]) => {
        setLane(laneData);
        setEvents(eventsData);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [client, id]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { lane, events, loading, error, refetch: fetch };
}

export function useSSE(handler: (event: SSEEvent) => void): void {
  const client = useHarnessClient();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsub = client.subscribe((event) => handlerRef.current(event));
    return unsub;
  }, [client]);
}

export function useMutation<T>(
  action: (client: HarnessClient) => Promise<T>,
): {
  mutate: () => void;
  loading: boolean;
  error: Error | null;
  data: T | null;
} {
  const client = useHarnessClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<T | null>(null);

  const mutate = useCallback(() => {
    setLoading(true);
    setError(null);
    action(client)
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [client, action]);

  return { mutate, loading, error, data };
}
```

- [ ] **Step 7: Create `packages/sdk/src/react/index.ts`**

```typescript
export { HarnessProvider, useHarnessClient } from "./provider.js";
export { useLanes, useLane, useSSE, useMutation } from "./hooks.js";
```

- [ ] **Step 8: Create `packages/sdk/src/index.ts`**

```typescript
export { HarnessClient } from "./client.js";
export { createSSEConnection } from "./sse.js";
export type {
  Lane,
  StageRun,
  LaneEvent,
  LaneConfig,
  HarnessConfig,
  LaneStatus,
  StageState,
  LaneMode,
  StageName,
  StageResult,
  CreateLaneRequest,
  LaneResponse,
  ErrorResponse,
  SchedulerTickResponse,
  LockInfo,
  SSEEvent,
  RunResult,
  SchedulerResult,
} from "@harness/types";
```

- [ ] **Step 9: Create `packages/sdk/src/client.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HarnessClient } from "./client.js";

const BASE = "http://localhost:8090";

describe("HarnessClient", () => {
  let client: HarnessClient;

  beforeEach(() => {
    client = new HarnessClient(BASE);
    vi.restoreAllMocks();
  });

  it("getLanes fetches from /api/lanes", async () => {
    const mockLanes = [{ id: 1, title: "Lane 1" }];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockLanes), { status: 200 }),
    );

    const result = await client.getLanes();
    expect(result).toEqual(mockLanes);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/lanes`,
      expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
    );
  });

  it("createLane POSTs to /api/lanes", async () => {
    const mockLane = { id: 2, title: "New Lane" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, lane: mockLane }), { status: 200 }),
    );

    const result = await client.createLane({ title: "New Lane", slug: "new-lane" });
    expect(result).toEqual(mockLane);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/lanes`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "New Lane", slug: "new-lane" }),
      }),
    );
  });

  it("throws on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );

    await expect(client.getLane(999)).rejects.toThrow("not found");
  });

  it("advanceStage POSTs to /api/lanes/:id/advance", async () => {
    const mockLane = { id: 1, stageIndex: 2 };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, lane: mockLane }), { status: 200 }),
    );

    const result = await client.advanceStage(1);
    expect(result).toEqual(mockLane);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/lanes/1/advance`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("tick POSTs to /api/scheduler/tick", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, processed: 2, results: [] }), { status: 200 }),
    );

    const result = await client.tick();
    expect(result).toEqual({ processed: 2, results: [] });
  });
});
```

- [ ] **Step 10: Install and run tests**

Run: `pnpm install`

Run: `pnpm --filter @harness/sdk test`

Expected: All 5 client tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/sdk/
git commit -m "feat: create @harness/sdk with HarnessClient + React hooks"
```

---

### Task 4: Build `@harness/web` — Next.js frontend

**Files:**
- Create: `packages/web/package.json` (replace existing)
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/next.config.ts`
- Create: `packages/web/tailwind.config.ts`
- Create: `packages/web/postcss.config.mjs`
- Create: `packages/web/src/app/layout.tsx`
- Create: `packages/web/src/app/page.tsx`
- Create: `packages/web/src/app/globals.css`
- Create: `packages/web/src/app/lanes/[id]/page.tsx`
- Create: `packages/web/src/app/providers.tsx`
- Create: `packages/web/src/components/LaneCard.tsx`
- Create: `packages/web/src/components/PipelineSVG.tsx`
- Create: `packages/web/src/components/StatusCounter.tsx`
- Create: `packages/web/src/components/ActionBar.tsx`
- Create: `packages/web/src/components/EventTimeline.tsx`
- Create: `packages/web/src/components/StageRunTable.tsx`
- Delete: `packages/web/public/index.html` (vanilla dashboard, replaced by Next.js)

**Interfaces:**
- Consumes: `useLanes`, `useLane`, `useSSE`, `useMutation`, `HarnessProvider` from `@harness/sdk/react` (Task 3). All types from `@harness/types` (Task 1).
- Produces: Next.js app on port 3000 with dashboard (`/`), lane detail (`/lanes/[id]`), real-time SSE updates

- [ ] **Step 1: Replace `packages/web/package.json`**

```json
{
  "name": "@harness/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000"
  },
  "dependencies": {
    "@harness/sdk": "workspace:*",
    "@harness/types": "workspace:*",
    "next": "^15.3.4",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.8",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "tailwindcss": "^4.1.8",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: Create `packages/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `packages/web/next.config.ts`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8090/api/:path*",
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 4: Create `packages/web/postcss.config.mjs`**

```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

- [ ] **Step 5: Create `packages/web/src/app/globals.css`**

```css
@import "tailwindcss";

:root {
  --bg: #080b11;
  --bg2: #0b1019;
  --panel: #0c121d;
  --card: #0e131e;
  --card-edge: #1a2433;
  --line: #1b2533;
  --text: #e7ebf1;
  --muted: #828d9f;
  --green: #34d27b;
  --blue: #4a9eff;
  --amber: #f2b134;
  --pink: #ec4d7e;
  --red: #f0506e;
}

body {
  background: radial-gradient(1200px 600px at 80% -10%, #11203a55, transparent 60%), var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 6: Create `packages/web/src/app/providers.tsx`**

```tsx
"use client";

import { HarnessProvider } from "@harness/sdk/react";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <HarnessProvider baseUrl="">
      {children}
    </HarnessProvider>
  );
}
```

Note: `baseUrl=""` because Next.js rewrites `/api/*` to `localhost:8090` — all fetches go to same origin.

- [ ] **Step 7: Create `packages/web/src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Feature Harness",
  description: "Parallel lane orchestrator for AI agent workflows",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen p-5">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 8: Create `packages/web/src/components/StatusCounter.tsx`**

```tsx
import type { Lane } from "@harness/types";

const counters = [
  { key: "running", label: "running", cls: "text-green-300 border-green-800" },
  { key: "needs_you", label: "need you", cls: "text-amber-300 border-amber-800" },
  { key: "stalled", label: "stalled", cls: "text-pink-300 border-pink-800" },
] as const;

export function StatusCounter({ lanes }: { lanes: Lane[] }) {
  const counts = {
    total: lanes.length,
    running: lanes.filter((l) => l.status.includes("running")).length,
    needs_you: lanes.filter((l) => l.status.includes("needs_you")).length,
    stalled: lanes.filter((l) => l.status.includes("stalled")).length,
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs px-3 py-1 rounded-full border border-[var(--line)] text-[var(--muted)]">
        <b className="text-white font-bold">{counts.total}</b> lanes
      </span>
      {counters.map((c) => (
        <span key={c.key} className={`text-xs px-3 py-1 rounded-full border ${c.cls}`}>
          <b className="font-bold">{counts[c.key]}</b> {c.label}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 9: Create `packages/web/src/components/PipelineSVG.tsx`**

```tsx
import { STAGES } from "@harness/types";

const ICONS: Record<string, string> = {
  intake: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9z"/>',
  implement: '<path d="M5 19l9-9"/><path d="M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>',
  gates: '<path d="M5 19l3-1L19 7l-2-2L6 16z"/>',
  PR: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M5 8l7 5 7-5"/>',
  integrate: '<path d="M9 5a2 2 0 014 0h3v3a2 2 0 010 4v3h-3a2 2 0 01-4 0H6v-3a2 2 0 010-4V5z"/>',
  "e2e+QC": '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>',
  review: '<circle cx="7" cy="14" r="3.5"/><circle cx="17" cy="14" r="3.5"/><path d="M9 6l1 8M15 6l-1 8M11 14h2"/>',
  "er gate": '<path d="M5 20V6M19 20V6M5 8h14M5 13h14"/>',
  "push-dev": '<path d="M12 3c3 2 4 6 3 10l-3 3-3-3c-1-4 0-8 3-10z"/><path d="M9 18l-2 3M15 18l2 3"/>',
  "dev/QC": '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>',
  "watch PR": '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
  done: '<path d="M5 12l5 5L19 7"/>',
};

export function PipelineSVG({ currentStage }: { currentStage: number }) {
  const n = STAGES.length;
  const W = 1240;
  const L = 70;
  const R = 70;
  const usable = W - L - R;
  const gap = usable / (n - 1);
  const Y = 150;
  const RAD = 17;
  const X = (i: number) => L + i * gap;

  return (
    <div className="overflow-x-auto -mx-1 my-0.5">
      <svg viewBox={`0 0 ${W} 240`} xmlns="http://www.w3.org/2000/svg" className="block min-w-[1180px]">
        {/* Connector lines */}
        {Array.from({ length: n - 1 }).map((_, i) => {
          const done = i < currentStage;
          return (
            <line
              key={`line-${i}`}
              x1={X(i) + RAD}
              y1={Y}
              x2={X(i + 1) - RAD}
              y2={Y}
              stroke={done ? "#2f9b5e" : "#26303f"}
              strokeWidth={done ? 2.4 : 2}
            />
          );
        })}
        {/* Stage nodes */}
        {STAGES.map((stage, i) => {
          const isDone = i < currentStage;
          const isCurrent = i === currentStage;
          const ring = isDone ? "#34d27b" : isCurrent ? "#ec4d7e" : "#3a4659";
          const fill = isDone ? "#0f2418" : isCurrent ? "#2a1019" : "#0d121b";
          const icol = isDone ? "#5fe39a" : isCurrent ? "#ff8fae" : "#5b6678";

          return (
            <g key={stage}>
              {isCurrent && (
                <circle cx={X(i)} cy={Y} r={RAD + 4} fill="none" stroke="#ec4d7e" strokeWidth={1.4} opacity={0.5}>
                  <animate attributeName="r" values={`${RAD + 3};${RAD + 7};${RAD + 3}`} dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values=".5;0;.5" dur="1.8s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={X(i)} cy={Y} r={RAD} fill={fill} stroke={ring} strokeWidth={2.4} />
              <g
                transform={`translate(${X(i) - 7},${Y - 7}) scale(0.58)`}
                fill="none"
                stroke={icol}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dangerouslySetInnerHTML={{ __html: ICONS[stage] ?? "" }}
              />
              <text x={X(i)} y={Y + RAD + 16} textAnchor="middle" fill="#9aa5b6" fontSize={11} fontFamily="var(--sans, sans-serif)">
                {stage}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
```

- [ ] **Step 10: Create `packages/web/src/components/LaneCard.tsx`**

```tsx
import type { Lane } from "@harness/types";
import { STAGES } from "@harness/types";
import Link from "next/link";

function timeAgo(iso: string): { text: string; cls: string } {
  if (!iso) return { text: "—", cls: "text-green-300" };
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 5) return { text: `${mins}m ago`, cls: "text-amber-300" };
  if (mins < 60) return { text: `${mins}m ago`, cls: "text-green-300" };
  const hrs = Math.floor(mins / 60);
  return { text: `${hrs}h ${mins % 60}m ago`, cls: "text-pink-300" };
}

function StatusTag({ status }: { status: string }) {
  const cls =
    status === "stalled"
      ? "text-pink-200 bg-pink-950 border-pink-800"
      : status === "needs_you"
        ? "text-amber-200 bg-amber-950 border-amber-800"
        : "text-blue-200 bg-blue-950 border-blue-800";
  return (
    <span className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded-md border uppercase ${cls}`}>
      {status}
    </span>
  );
}

export function LaneCard({ lane, selected }: { lane: Lane; selected?: boolean }) {
  const ago = timeAgo(lane.updatedAt);
  const currentStage = STAGES[lane.stageIndex] ?? "intake";

  return (
    <Link href={`/lanes/${lane.id}`} className="block">
      <div
        className={`bg-[var(--card)] border rounded-xl p-3.5 cursor-pointer transition-all hover:border-[#2a3a52] hover:-translate-y-px
          ${selected ? "border-blue-500 shadow-lg shadow-blue-500/20" : "border-[var(--card-edge)]"}
          ${lane.status.includes("stalled") ? "border-t-2 border-t-pink-500" : ""}
          ${lane.status.includes("needs_you") ? "border-t-2 border-t-amber-500" : ""}`}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="font-mono text-[11px] tracking-wider text-[var(--muted)]">LANE {lane.id}</span>
          <span className="ml-auto flex gap-1.5">
            {lane.status.map((s) => (
              <StatusTag key={s} status={s} />
            ))}
          </span>
        </div>
        <div className="text-sm font-bold mb-2.5">{lane.title}</div>
        <div className="flex items-center gap-2 mb-2.5">
          <span className="font-mono text-[11.5px] text-blue-300 border border-blue-800 bg-blue-950 rounded px-2 py-0.5">
            {lane.mode}
          </span>
          <span className="flex-1 h-2 rounded-full bg-[#161f2d] overflow-hidden">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-blue-400 via-teal-400 to-purple-400"
              style={{ width: `${lane.progress}%` }}
            />
          </span>
          <span className="font-mono text-[11px] text-[var(--muted)]">{lane.progress}%</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lane.tags.map((t) => (
            <span key={t} className="font-mono text-[10.5px] text-green-200 border border-green-800 rounded px-2 py-0.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              {t}
            </span>
          ))}
          <span className={`ml-auto font-mono text-[11px] ${ago.cls}`}>{ago.text}</span>
        </div>
        <div className="mt-2 font-mono text-[11.5px] text-gray-400 bg-[#0a0e17] border border-[#141c28] rounded-lg p-2">
          <span className="text-gray-500">⎇ {lane.slug}</span>
          <span className="block text-gray-300 truncate">{lane.git.commit} {lane.git.subject}</span>
          <span className="text-green-400">CI {lane.git.ci}</span>
          <span className="text-blue-300 ml-2">:{lane.port}</span>
        </div>
        {lane.note && (
          <div className={`mt-2 font-mono text-[11px] bg-[#0c1422] border border-[#18243a] border-l-2 rounded-lg p-2
            ${lane.status.includes("needs_you") ? "border-l-amber-500" : "border-l-green-500"}`}>
            {lane.note}
          </div>
        )}
      </div>
    </Link>
  );
}
```

- [ ] **Step 11: Create `packages/web/src/components/ActionBar.tsx`**

```tsx
"use client";

import { useMutation } from "@harness/sdk/react";
import type { HarnessClient } from "@harness/sdk";

interface ActionBarProps {
  laneId: number;
  onAction?: () => void;
}

const actions = [
  { label: "Pass", fn: (c: HarnessClient, id: number) => c.passStage(id) },
  { label: "Advance", fn: (c: HarnessClient, id: number) => c.advanceStage(id) },
  { label: "Block", fn: (c: HarnessClient, id: number) => c.blockStage(id, "manually blocked") },
  { label: "Re-enter", fn: (c: HarnessClient, id: number) => c.reenterStage(id) },
  { label: "Up", fn: (c: HarnessClient, id: number) => c.upLane(id) },
  { label: "Down", fn: (c: HarnessClient, id: number) => c.downLane(id) },
] as const;

export function ActionBar({ laneId, onAction }: ActionBarProps) {
  return (
    <div className="grid grid-cols-6 gap-1.5 mt-2">
      {actions.map((a) => (
        <ActionButton key={a.label} label={a.label} laneId={laneId} action={a.fn} onAction={onAction} />
      ))}
    </div>
  );
}

function ActionButton({
  label,
  laneId,
  action,
  onAction,
}: {
  label: string;
  laneId: number;
  action: (c: HarnessClient, id: number) => Promise<unknown>;
  onAction?: () => void;
}) {
  const { mutate, loading } = useMutation((client) =>
    action(client, laneId).then(() => onAction?.()),
  );

  return (
    <button
      onClick={mutate}
      disabled={loading}
      className="flex flex-col items-center gap-1 py-2 px-1 bg-[#0c1119] border border-[var(--line)] rounded-lg text-[var(--muted)] text-[9.5px] cursor-pointer transition-colors hover:text-white hover:border-[#2a3a52] disabled:opacity-50"
    >
      {loading ? "..." : label}
    </button>
  );
}
```

- [ ] **Step 12: Create `packages/web/src/components/EventTimeline.tsx`**

```tsx
import type { LaneEvent } from "@harness/types";

const typeColors: Record<string, string> = {
  stage_enter: "text-blue-400",
  stage_pass: "text-green-400",
  stage_fail: "text-red-400",
  re_enter: "text-purple-400",
  blocked: "text-amber-400",
  action: "text-gray-400",
};

export function EventTimeline({ events }: { events: LaneEvent[] }) {
  const sorted = [...events].sort((a, b) => b.id - a.id);

  return (
    <div className="space-y-1 max-h-80 overflow-y-auto">
      {sorted.map((e) => (
        <div key={e.id} className="font-mono text-[11px] flex gap-2 items-start py-1 border-b border-[#141c28]">
          <span className="text-gray-500 shrink-0">{new Date(e.ts).toLocaleTimeString()}</span>
          <span className={`font-bold ${typeColors[e.type] ?? "text-gray-400"}`}>{e.type}</span>
          <span className="text-gray-400 truncate">{JSON.stringify(e.payload)}</span>
        </div>
      ))}
      {sorted.length === 0 && <div className="text-gray-500 text-sm">No events yet</div>}
    </div>
  );
}
```

- [ ] **Step 13: Create `packages/web/src/components/StageRunTable.tsx`**

```tsx
import type { StageRun } from "@harness/types";

export function StageRunTable({ stageRuns }: { stageRuns: StageRun[] }) {
  const sorted = [...stageRuns].sort((a, b) => b.id - a.id);

  return (
    <table className="w-full text-[11px] font-mono">
      <thead>
        <tr className="text-gray-500 text-left border-b border-[#1a2433]">
          <th className="py-1 px-2">Stage</th>
          <th className="py-1 px-2">#</th>
          <th className="py-1 px-2">State</th>
          <th className="py-1 px-2">Result</th>
          <th className="py-1 px-2">Message</th>
          <th className="py-1 px-2">Started</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((sr) => (
          <tr key={sr.id} className="border-b border-[#141c28] hover:bg-[#0d131e]">
            <td className="py-1 px-2 text-blue-300">{sr.stage}</td>
            <td className="py-1 px-2">{sr.attempt}</td>
            <td className="py-1 px-2">
              <span
                className={
                  sr.state === "done"
                    ? "text-green-400"
                    : sr.state === "current"
                      ? "text-blue-400"
                      : "text-gray-400"
                }
              >
                {sr.state}
              </span>
            </td>
            <td className="py-1 px-2">
              <span
                className={
                  sr.result === "pass"
                    ? "text-green-400"
                    : sr.result === "fail"
                      ? "text-red-400"
                      : sr.result === "blocked"
                        ? "text-amber-400"
                        : "text-gray-500"
                }
              >
                {sr.result ?? "—"}
              </span>
            </td>
            <td className="py-1 px-2 text-gray-400 truncate max-w-[200px]">{sr.message || "—"}</td>
            <td className="py-1 px-2 text-gray-500">{new Date(sr.startedAt).toLocaleTimeString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 14: Create `packages/web/src/app/page.tsx` — Dashboard**

```tsx
"use client";

import { useLanes, useSSE } from "@harness/sdk/react";
import { useCallback } from "react";
import { StatusCounter } from "@/components/StatusCounter";
import { LaneCard } from "@/components/LaneCard";
import { PipelineSVG } from "@/components/PipelineSVG";
import type { SSEEvent } from "@harness/types";

export default function DashboardPage() {
  const { lanes, loading, refetch } = useLanes();

  useSSE(
    useCallback(
      (event: SSEEvent) => {
        if (event.type.startsWith("lane:") || event.type.startsWith("stage:")) {
          refetch();
        }
      },
      [refetch],
    ),
  );

  const firstLane = lanes[0];

  return (
    <div className="max-w-[1320px] mx-auto">
      <div className="flex items-baseline gap-3.5 flex-wrap mb-4">
        <h1 className="text-2xl font-extrabold tracking-tight">Feature Harness</h1>
        <span className="text-sm text-[var(--muted)]">parallel lanes — live watch</span>
        <span className="flex-1" />
        <StatusCounter lanes={lanes} />
      </div>

      {firstLane && (
        <div className="bg-gradient-to-b from-[#0c121d] to-[#0a0f18] border border-[var(--line)] rounded-2xl p-4 mb-5">
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="font-bold text-sm">Lane {firstLane.id}</span>
            <span className="font-mono text-[11.5px] text-blue-300 border border-blue-800 bg-blue-950 rounded px-2 py-0.5">
              {firstLane.mode}
            </span>
            <span className="text-sm text-gray-300">{firstLane.title}</span>
          </div>
          <PipelineSVG currentStage={firstLane.stageIndex} />
        </div>
      )}

      {loading && lanes.length === 0 && (
        <div className="text-center py-16 text-[var(--muted)]">Loading lanes...</div>
      )}

      {!loading && lanes.length === 0 && (
        <div className="text-center py-16 text-[var(--muted)]">
          <h2 className="text-white mb-2">No lanes yet</h2>
          <p>Add your first lane to get started</p>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
        {lanes.map((lane) => (
          <LaneCard key={lane.id} lane={lane} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 15: Create `packages/web/src/app/lanes/[id]/page.tsx` — Lane Detail**

```tsx
"use client";

import { use, useCallback } from "react";
import { useLane, useSSE } from "@harness/sdk/react";
import { PipelineSVG } from "@/components/PipelineSVG";
import { ActionBar } from "@/components/ActionBar";
import { EventTimeline } from "@/components/EventTimeline";
import { StageRunTable } from "@/components/StageRunTable";
import Link from "next/link";
import type { SSEEvent } from "@harness/types";

export default function LaneDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const id = parseInt(idStr, 10);
  const { lane, events, loading, refetch } = useLane(id);

  useSSE(
    useCallback(
      (event: SSEEvent) => {
        if (
          (event.type === "lane:updated" && event.lane.id === id) ||
          ("laneId" in event && event.laneId === id)
        ) {
          refetch();
        }
      },
      [id, refetch],
    ),
  );

  if (loading && !lane) {
    return <div className="text-center py-16 text-[var(--muted)]">Loading...</div>;
  }

  if (!lane) {
    return (
      <div className="text-center py-16">
        <h2 className="text-white mb-2">Lane not found</h2>
        <Link href="/" className="text-blue-400">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="max-w-[1320px] mx-auto">
      <Link href="/" className="text-blue-400 text-sm mb-4 inline-block">← Back to dashboard</Link>

      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-2xl font-extrabold">Lane {lane.id}</h1>
        <span className="font-mono text-sm text-blue-300 border border-blue-800 bg-blue-950 rounded px-2 py-1">
          {lane.mode}
        </span>
        {lane.status.map((s) => (
          <span
            key={s}
            className={`font-mono text-xs font-bold px-2 py-0.5 rounded-md border uppercase
              ${s === "stalled" ? "text-pink-200 bg-pink-950 border-pink-800" :
                s === "needs_you" ? "text-amber-200 bg-amber-950 border-amber-800" :
                "text-blue-200 bg-blue-950 border-blue-800"}`}
          >
            {s}
          </span>
        ))}
      </div>

      <h2 className="text-lg font-bold mb-3">{lane.title}</h2>

      <div className="bg-gradient-to-b from-[#0c121d] to-[#0a0f18] border border-[var(--line)] rounded-2xl p-4 mb-5">
        <PipelineSVG currentStage={lane.stageIndex} />
        <div className="flex items-center gap-2 mt-2 text-sm font-mono">
          <span className="text-gray-400">⎇</span>
          <span className="text-gray-200 font-bold">{lane.slug}</span>
          <span className="text-green-400 ml-2">{lane.progress}%</span>
          <span className="ml-auto text-gray-500">:{lane.port}</span>
        </div>
      </div>

      <ActionBar laneId={lane.id} onAction={refetch} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
        <div className="bg-[var(--card)] border border-[var(--card-edge)] rounded-xl p-4">
          <h3 className="font-bold text-sm mb-3">Stage Runs</h3>
          <StageRunTable stageRuns={lane.stageRuns} />
        </div>
        <div className="bg-[var(--card)] border border-[var(--card-edge)] rounded-xl p-4">
          <h3 className="font-bold text-sm mb-3">Event Timeline</h3>
          <EventTimeline events={events} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 16: Delete old vanilla dashboard**

Remove `packages/web/public/index.html`.

- [ ] **Step 17: Install dependencies**

Run: `pnpm install`

- [ ] **Step 18: Verify Next.js dev server starts**

Run: `pnpm --filter @harness/web dev`

Expected: Next.js dev server starts on port 3000 without compilation errors.

- [ ] **Step 19: Verify existing tests still pass**

Run: `pnpm --filter @harness/orchestrator test`

Expected: All 32 tests pass.

- [ ] **Step 20: Commit**

```bash
git add packages/web/ -A
git commit -m "feat: build @harness/web with Next.js 15 + Tailwind, replacing vanilla dashboard"
```

---

### Task 5: Integration testing & root script updates

**Files:**
- Modify: `package.json` (root — update dev script for concurrent FE+BE)
- Modify: `packages/web/public/` (ensure old files are cleaned up)

**Interfaces:**
- Consumes: Everything from Tasks 1-4
- Produces: Working end-to-end system, root dev script

- [ ] **Step 1: Update root `package.json` scripts**

```json
{
  "scripts": {
    "dev": "concurrently -n api,web -c blue,green \"pnpm --filter @harness/api dev\" \"pnpm --filter @harness/web dev\"",
    "dev:api": "pnpm --filter @harness/api dev",
    "dev:web": "pnpm --filter @harness/web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  }
}
```

- [ ] **Step 2: Start both servers and verify proxy**

Run (terminal 1): `pnpm dev:api`

Run (terminal 2): `pnpm dev:web`

Test: Open `http://localhost:3000` in a browser. The dashboard should load and show lanes fetched via the Next.js proxy to `localhost:8090`.

- [ ] **Step 3: Test SSE real-time updates**

1. Open `http://localhost:3000` in browser tab A
2. In another terminal, create a lane via API: `curl -X POST http://localhost:8090/api/lanes -H "Content-Type: application/json" -d '{"title":"SSE Test","slug":"sse-test"}'`
3. Tab A should update to show the new lane without a manual refresh

- [ ] **Step 4: Test lane detail page**

1. Click a lane card on the dashboard
2. Verify `/lanes/[id]` page loads with pipeline SVG, stage runs, events
3. Click "Pass" then "Advance" action buttons
4. Verify stage index updates in real-time via SSE

- [ ] **Step 5: Test action buttons**

For each action button (Pass, Advance, Block, Re-enter, Up, Down):
1. Click the button
2. Verify the API responds without error
3. Verify the UI updates via SSE

- [ ] **Step 6: Run all tests**

Run: `pnpm test`

Expected:
- `@harness/orchestrator`: 32 tests pass (state-machine + lock)
- `@harness/sdk`: 5 tests pass (client)
- `@harness/web`: no tests (Next.js, tested manually)
- `@harness/types`: no tests (pure types)
- `@harness/api`: no tests (tested via integration)

- [ ] **Step 7: Commit**

```bash
git add package.json
git commit -m "feat: add concurrent dev script for FE+BE separation"
```
