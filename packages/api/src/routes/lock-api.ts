import type { FastifyInstance } from "fastify";
import type { Database } from "@harness/orchestrator";
import { acquireLock, releaseLock, getActiveLock, getAllLanes } from "@harness/orchestrator";

export async function lockApiRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.post<{ Body: { lockType: string; slug: string } }>(
    "/api/locks/acquire",
    async (request, reply) => {
      const { lockType, slug } = request.body;
      if (!lockType || !slug) {
        return reply.status(400).send({ error: "lockType and slug required" });
      }

      const lanes = getAllLanes(db);
      const lane = lanes.find((l) => l.slug === slug);
      if (!lane) {
        return reply.status(404).send({ error: `Lane ${slug} not found` });
      }

      const acquired = acquireLock(db, lockType, lane.id);
      if (acquired) {
        return { acquired: true, slug };
      }

      const holder = getActiveLock(db, lockType);
      const heldBy = holder ? lanes.find((l) => l.id === holder.laneId)?.slug : "unknown";
      return { acquired: false, heldBy, acquiredAt: holder?.acquiredAt };
    },
  );

  app.post<{ Body: { lockType: string; slug: string } }>(
    "/api/locks/release",
    async (request, reply) => {
      const { lockType, slug } = request.body;
      if (!lockType || !slug) {
        return reply.status(400).send({ error: "lockType and slug required" });
      }

      const lanes = getAllLanes(db);
      const lane = lanes.find((l) => l.slug === slug);
      if (!lane) {
        return reply.status(404).send({ error: `Lane ${slug} not found` });
      }

      releaseLock(db, lockType, lane.id);
      return { released: true, slug };
    },
  );
}
