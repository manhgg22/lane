import type { Database } from "./db.js";
import { queryOne, queryAll, run } from "./db.js";
import { getAllLanes } from "./db.js";

export function acquireLock(db: Database, lockType: string, laneId: number): boolean {
  const existing = queryOne(db, "SELECT * FROM locks WHERE lock_type = ?", [lockType]);
  if (!existing) {
    try {
      run(db, "INSERT INTO locks (lock_type, lane_id) VALUES (?, ?)", [lockType, laneId]);
      return true;
    } catch {
      return false;
    }
  }
  return (existing.lane_id as number) === laneId;
}

export function releaseLock(db: Database, lockType: string, laneId: number): void {
  run(db, "DELETE FROM locks WHERE lock_type = ? AND lane_id = ?", [lockType, laneId]);
}

export function getActiveLock(
  db: Database,
  lockType: string,
): { laneId: number; acquiredAt: string } | null {
  const row = queryOne(db, "SELECT * FROM locks WHERE lock_type = ?", [lockType]);
  if (!row) return null;
  return { laneId: row.lane_id as number, acquiredAt: row.acquired_at as string };
}

export function releaseAllLocks(db: Database, laneId: number): void {
  run(db, "DELETE FROM locks WHERE lane_id = ?", [laneId]);
}

export function cleanStaleLocks(db: Database, staleMinutes: number = 30): number {
  const rows = queryAll(
    db,
    "SELECT * FROM locks WHERE acquired_at < datetime('now', ?)",
    [`-${staleMinutes} minutes`],
  );

  let cleaned = 0;
  const lanes = getAllLanes(db);
  const laneMap = new Map(lanes.map((l) => [l.id, l]));

  for (const row of rows) {
    const lane = laneMap.get(row.lane_id as number);
    if (!lane || !lane.status.includes("running")) {
      run(db, "DELETE FROM locks WHERE id = ?", [row.id as number]);
      cleaned++;
    }
  }

  return cleaned;
}
