import type { FastifyInstance } from "fastify";
import type { Database } from "@harness/orchestrator";
import { getAllLanes, getLaneById, getStageRuns, getEvents } from "@harness/orchestrator";

export async function laneRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get("/api/lanes", async () => {
    return getAllLanes(db);
  });

  app.get<{ Params: { id: string } }>("/api/lanes/:id", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const lane = getLaneById(db, id);
    if (!lane) {
      return reply.status(404).send({ error: "Lane not found" });
    }
    const stageRuns = getStageRuns(db, id);
    return { ...lane, stageRuns };
  });

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    "/api/lanes/:id/events",
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const lane = getLaneById(db, id);
      if (!lane) {
        return reply.status(404).send({ error: "Lane not found" });
      }
      const after = request.query.after ? parseInt(request.query.after, 10) : undefined;
      return getEvents(db, id, after);
    },
  );
}
