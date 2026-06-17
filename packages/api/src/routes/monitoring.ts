import type { FastifyInstance } from "fastify";
import type { Database } from "@harness/orchestrator";
import {
  getAuditLog,
  getAllLanes,
  queryAll,
} from "@harness/orchestrator";
import { isSchedulerRunning, getSchedulerState } from "@harness/orchestrator/scheduler";

export async function monitoringRoutes(
  app: FastifyInstance,
  db: Database,
): Promise<void> {
  app.get("/api/audit", async (req, reply) => {
    const { limit, level } = req.query as { limit?: string; level?: string };
    const entries = getAuditLog(db, {
      limit: limit ? parseInt(limit, 10) : 100,
      level: level || undefined,
    });
    return reply.send(entries);
  });

  app.get("/api/metrics", async (_req, reply) => {
    const lanes = getAllLanes(db);
    const schedulerState = getSchedulerState(db);

    const byStatus = {
      running: lanes.filter((l) => l.status.includes("running")).length,
      stalled: lanes.filter((l) => l.status.includes("stalled")).length,
      needs_you: lanes.filter((l) => l.status.includes("needs_you")).length,
    };

    const stageRuns = queryAll(
      db,
      `SELECT stage,
              COUNT(*) as total,
              AVG(CASE WHEN ended_at IS NOT NULL
                   THEN (julianday(ended_at) - julianday(started_at)) * 86400
                   ELSE NULL END) as avg_duration_sec
       FROM stage_runs
       GROUP BY stage`,
    );

    const lockCount = queryAll(db, "SELECT COUNT(*) as count FROM locks");

    return reply.send({
      lanes: {
        total: lanes.length,
        byStatus,
      },
      stages: stageRuns.map((r) => ({
        stage: r.stage,
        total: r.total,
        avgDurationSec: r.avg_duration_sec ? Math.round(r.avg_duration_sec as number) : null,
      })),
      locks: {
        active: (lockCount[0]?.count as number) ?? 0,
      },
      scheduler: schedulerState,
    });
  });

  app.get("/api/health/deep", async (_req, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      queryAll(db, "SELECT 1");
      checks.database = { ok: true };
    } catch (err) {
      checks.database = { ok: false, detail: String(err) };
    }

    checks.scheduler = {
      ok: true,
      detail: isSchedulerRunning() ? "running" : "stopped",
    };

    const lanes = getAllLanes(db);
    checks.lanes = {
      ok: true,
      detail: `${lanes.length} lanes`,
    };

    const allOk = Object.values(checks).every((c) => c.ok);

    return reply
      .code(allOk ? 200 : 503)
      .send({ ok: allOk, ts: new Date().toISOString(), checks });
  });
}
