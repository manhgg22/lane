import type { Database } from "./db.js";
import { queryAll, run as dbRun } from "./db.js";
import { releaseAllLocks } from "./lock.js";
import { createLogger } from "./logger.js";

const log = createLogger("recovery");

export function recoverFromCrash(db: Database): {
  resetStageRuns: number;
  releasedLocks: number;
} {
  let resetStageRuns = 0;
  let releasedLocks = 0;

  const stuckRuns = queryAll(
    db,
    `SELECT sr.id, sr.lane_id, sr.stage
     FROM stage_runs sr
     JOIN lanes l ON l.id = sr.lane_id
     WHERE sr.state = 'current'
     AND json_extract(l.status, '$[0]') = 'running'`,
  );

  for (const row of stuckRuns) {
    dbRun(db, "UPDATE stage_runs SET state = 'pending' WHERE id = ?", [row.id as number]);
    resetStageRuns++;
    log.info(`Reset stuck stage_run ${row.id} (lane ${row.lane_id}, stage ${row.stage})`);
  }

  const orphanLocks = queryAll(db, "SELECT DISTINCT lane_id FROM locks");
  for (const row of orphanLocks) {
    const laneId = row.lane_id as number;
    const lane = queryAll(db, "SELECT status FROM lanes WHERE id = ?", [laneId]);
    if (lane.length === 0 || !JSON.parse(lane[0].status as string).includes("running")) {
      releaseAllLocks(db, laneId);
      releasedLocks++;
      log.info(`Released orphan locks for lane ${laneId}`);
    }
  }

  if (resetStageRuns > 0 || releasedLocks > 0) {
    log.warn(`Crash recovery: reset ${resetStageRuns} stage runs, released ${releasedLocks} locks`);
  } else {
    log.info("Crash recovery: no stuck state found");
  }

  return { resetStageRuns, releasedLocks };
}
