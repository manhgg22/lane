import type { Database } from "./db.js";
import { getAllLanes, getLaneById, insertStageRun } from "./db.js";
import { STAGES } from "./types.js";
import type { StageName } from "./types.js";
import {
  advanceStage,
  blockStage,
  passStage,
  failStage,
  getCurrentStageRun,
} from "./state-machine.js";
import { handlerRegistry } from "./handlers.js";
import { cleanStaleLocks } from "./lock.js";

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

  const result = await handler.execute(lane, db);

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

export async function runScheduler(db: Database): Promise<SchedulerResult> {
  cleanStaleLocks(db);

  const lanes = getAllLanes(db);
  const eligible = lanes.filter(
    (l) => l.mode === "implement" && l.status.includes("running"),
  );

  const results: RunResult[] = [];
  for (const lane of eligible) {
    const result = await runLane(db, lane.id);
    results.push(result);
  }

  return { processed: results.length, results };
}
