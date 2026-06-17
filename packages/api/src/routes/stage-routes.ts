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
