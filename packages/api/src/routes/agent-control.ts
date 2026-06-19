import type { FastifyInstance } from "fastify";
import type { Database, HarnessConfig } from "@harness/orchestrator";
import {
  getLaneById,
  getAllLanes,
  launchLane,
  resumeLane,
  getActiveSession,
  getAllActiveSessions,
  startMonitoringLane,
  insertEvent,
  getContainerName,
} from "@harness/orchestrator";
import type { EventBus } from "../event-bus.js";

export async function agentControlRoutes(
  app: FastifyInstance,
  db: Database,
  config: HarnessConfig,
  rootDir: string,
  bus: EventBus,
): Promise<void> {
  const credentialsFile = process.env.CLAUDE_CREDENTIALS_FILE ?? "";
  const claudeJsonFile = process.env.CLAUDE_JSON_FILE ?? "";
  const pluginDir = process.env.SUPERPOWERS_PLUGIN_DIR ?? "";

  app.post<{ Params: { id: string }; Body: { maxBudgetUsd?: number } }>(
    "/api/lanes/:id/launch",
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const lane = getLaneById(db, id);
      if (!lane) return reply.status(404).send({ error: "Lane not found" });

      const existing = getActiveSession(lane.id);
      if (existing?.process && !existing.process.killed) {
        return reply.status(409).send({ error: "Agent already running for this lane" });
      }

      const containerName = getContainerName(lane.slug);
      const session = launchLane(rootDir, lane, db, {
        credentialsFile,
        claudeJsonFile,
        containerName,
        pluginDir: pluginDir || undefined,
        maxBudgetUsd: request.body?.maxBudgetUsd,
      });

      startMonitoringLane(rootDir, lane.slug, db, (slug, state) => {
        const updated = getAllLanes(db).find((l) => l.slug === slug);
        if (updated) bus.broadcast({ type: "lane:updated", lane: updated });
      });

      return {
        ok: true,
        laneId: lane.id,
        sessionId: session.sessionId,
        ndjsonPath: session.ndjsonPath,
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { instruction?: string } }>(
    "/api/lanes/:id/resume",
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const lane = getLaneById(db, id);
      if (!lane) return reply.status(404).send({ error: "Lane not found" });

      const session = resumeLane(rootDir, lane, db, {
        credentialsFile,
        claudeJsonFile,
        containerName: getContainerName(lane.slug),
      }, request.body?.instruction);

      if (!session) {
        return reply.status(400).send({ error: "No session to resume (no sessionId found)" });
      }

      insertEvent(db, lane.id, "action", {
        action: "resume",
        instruction: request.body?.instruction ?? "continue",
      });

      return {
        ok: true,
        laneId: lane.id,
        sessionId: session.sessionId,
      };
    },
  );

  app.get("/api/sessions", async () => {
    const sessions = getAllActiveSessions();
    return sessions.map((s) => ({
      laneId: s.laneId,
      slug: s.slug,
      sessionId: s.sessionId,
      alive: s.process ? !s.process.killed : false,
    }));
  });

  app.get<{ Params: { id: string } }>(
    "/api/lanes/:id/session",
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const session = getActiveSession(id);
      if (!session) return reply.status(404).send({ error: "No active session" });

      return {
        laneId: session.laneId,
        slug: session.slug,
        sessionId: session.sessionId,
        alive: session.process ? !session.process.killed : false,
        ndjsonPath: session.ndjsonPath,
        statePath: session.statePath,
      };
    },
  );
}
