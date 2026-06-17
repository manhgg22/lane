import type { Database } from "./db.js";
import { getAllLanes, getLaneById, insertStageRun } from "./db.js";
import { STAGES } from "@harness/types";
import type { StageName, RunResult, SchedulerResult } from "@harness/types";
import {
  advanceStage,
  blockStage,
  passStage,
  failStage,
  getCurrentStageRun,
} from "./state-machine.js";
import { handlerRegistry } from "./handlers.js";
import { cleanStaleLocks } from "./lock.js";
import { createSemaphore } from "./semaphore.js";

export async function runLane(db: Database, laneId: number): Promise<RunResult> {
  const lane = getLaneById(db, laneId);
  if (!lane) throw new Error(`Lane ${laneId} not found`);

  const currentStage = STAGES[lane.stageIndex] as StageName;

  if (currentStage === "done") {
    return { laneId, stage: currentStage, action: "skipped", reason: "already done" };
  }

  let sr = getCurrentStageRun(db, laneId);
  if (!sr) {
    sr = insertStageRun(db, laneId, currentStage);
  }

  if (sr.result === "blocked") {
    return { laneId, stage: currentStage, action: "skipped", reason: "blocked" };
  }

  const handler = handlerRegistry.get(currentStage);
  if (!handler) {
    return { laneId, stage: currentStage, action: "skipped", reason: "no handler" };
  }

  if (!handler.canEnter(lane, db)) {
    return { laneId, stage: currentStage, action: "skipped", reason: "lock contention" };
  }

  let result;
  try {
    result = await handler.execute(lane, db);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failStage(db, laneId, `handler threw: ${message}`);
    handler.onFail(lane, db);
    return { laneId, stage: currentStage, action: "failed", reason: message };
  }

  switch (result) {
    case "pass":
      passStage(db, laneId);
      handler.onPass(lane, db);
      advanceStage(db, laneId);
      return { laneId, stage: currentStage, action: "advanced" };

    case "fail":
      failStage(db, laneId, "handler returned fail");
      handler.onFail(lane, db);
      return { laneId, stage: currentStage, action: "failed" };

    case "blocked":
      blockStage(db, laneId, "handler returned blocked");
      return { laneId, stage: currentStage, action: "blocked" };

    default:
      return { laneId, stage: currentStage, action: "skipped", reason: "unknown result" };
  }
}

export async function runScheduler(
  db: Database,
  maxParallel: number = 5,
): Promise<SchedulerResult> {
  cleanStaleLocks(db);

  const lanes = getAllLanes(db);
  const eligible = lanes
    .filter((l) => l.mode === "implement" && l.status.includes("running"))
    .sort((a, b) => (b as any).priority ?? 0 - ((a as any).priority ?? 0));

  const sem = createSemaphore(maxParallel);
  const results: RunResult[] = [];

  const tasks = eligible.map(async (lane) => {
    await sem.acquire();
    try {
      const result = await runLane(db, lane.id);
      results.push(result);
    } catch (err) {
      console.error(`[scheduler] runLane(${lane.id}) error:`, err);
    } finally {
      sem.release();
    }
  });

  await Promise.allSettled(tasks);

  return { processed: results.length, results };
}
