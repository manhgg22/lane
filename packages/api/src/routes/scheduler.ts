import type { FastifyInstance } from "fastify";
import type { Database } from "@harness/orchestrator";
import type { EventBus } from "../event-bus.js";
import type { HarnessConfig } from "@harness/types";
import {
  startScheduler,
  stopScheduler,
  isSchedulerRunning,
  getSchedulerState,
} from "@harness/orchestrator/scheduler";

export async function schedulerRoutes(
  app: FastifyInstance,
  db: Database,
  config: HarnessConfig,
  bus: EventBus,
): Promise<void> {
  app.post("/api/scheduler/start", async (_req, reply) => {
    if (isSchedulerRunning()) {
      return reply.code(200).send({ ok: true, message: "already running" });
    }

    startScheduler(
      db,
      (event) => bus.broadcast(event as any),
      {
        intervalMs: (config as any).scheduler?.intervalMs ?? 10_000,
        maxRetries: (config as any).scheduler?.maxRetries ?? 3,
        retryDelayMs: (config as any).scheduler?.retryDelayMs ?? 30_000,
      },
      config.maxParallel,
    );

    return reply.code(200).send({ ok: true, message: "scheduler started" });
  });

  app.post("/api/scheduler/stop", async (_req, reply) => {
    stopScheduler();
    bus.broadcast({ type: "scheduler:stopped" } as any);
    return reply.code(200).send({ ok: true, message: "scheduler stopped" });
  });

  app.get("/api/scheduler/status", async (_req, reply) => {
    const state = getSchedulerState(db);
    return reply.send(state);
  });
}
