import type { FastifyInstance } from "fastify";
import type { Database, HarnessConfig, Lane } from "@harness/orchestrator";
import type { EventBus } from "../event-bus.js";
import {
  getLaneById,
  getAllLanes,
  createFullLane,
  upLane,
  downLane,
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
