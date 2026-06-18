import type { FastifyInstance } from "fastify";
import type { Database } from "@harness/orchestrator";
import { getAllLanes, insertEvent, updateLane } from "@harness/orchestrator";
import type { EventBus } from "../event-bus.js";

export async function laneSignalRoutes(
  app: FastifyInstance,
  db: Database,
  bus: EventBus,
): Promise<void> {
  app.post<{ Params: { slug: string }; Body: { reason: string } }>(
    "/api/lanes/:slug/signal",
    async (request, reply) => {
      const { slug } = request.params;
      const { reason } = request.body;

      const lanes = getAllLanes(db);
      const lane = lanes.find((l) => l.slug === slug);
      if (!lane) {
        return reply.status(404).send({ error: `Lane ${slug} not found` });
      }

      insertEvent(db, lane.id, "action", {
        action: "signal",
        reason,
        source: "pr-review-loop",
      });

      updateLane(db, lane.id, { note: `Signal: ${reason}` });

      const updated = lanes.find((l) => l.slug === slug)!;
      bus.broadcast({ type: "lane:updated", lane: updated });

      return { ok: true, slug, reason };
    },
  );
}
