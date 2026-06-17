import type { Database } from "./db.js";
import type { SchedulerOptions, RunResult } from "@harness/types";
import { getAllLanes, queryOne, run as dbRun } from "./db.js";
import { runLane } from "./runner.js";
import { reEnterStage, getCurrentStageRun } from "./state-machine.js";
import { cleanStaleLocks } from "./lock.js";

const SCHEDULER_DDL = `
CREATE TABLE IF NOT EXISTS scheduler_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  running INTEGER NOT NULL DEFAULT 0,
  interval_ms INTEGER NOT NULL DEFAULT 10000,
  last_tick_at TEXT,
  total_ticks INTEGER NOT NULL DEFAULT 0
);
`;

export function ensureSchedulerTable(db: Database): void {
  db.exec(SCHEDULER_DDL);
  const row = queryOne(db, "SELECT id FROM scheduler_state WHERE id = 1");
  if (!row) {
    dbRun(db, "INSERT INTO scheduler_state (id) VALUES (1)");
  }
}

export interface SchedulerHandle {
  stop(): void;
  isRunning(): boolean;
}

export type SchedulerBroadcast = (event: {
  type: string;
  [key: string]: unknown;
}) => void;

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;
let _tickInProgress = false;

export function startScheduler(
  db: Database,
  broadcast: SchedulerBroadcast,
  options: SchedulerOptions = { intervalMs: 10_000, maxRetries: 3, retryDelayMs: 30_000 },
  maxParallel: number = 5,
): SchedulerHandle {
  if (_running) {
    return { stop: stopScheduler, isRunning: () => _running };
  }

  ensureSchedulerTable(db);
  _running = true;
  dbRun(db, "UPDATE scheduler_state SET running = 1 WHERE id = 1");

  broadcast({ type: "scheduler:started" });

  _timer = setInterval(async () => {
    if (_tickInProgress) return;
    _tickInProgress = true;

    try {
      const result = await schedulerTick(db, broadcast, options, maxParallel);
      dbRun(
        db,
        "UPDATE scheduler_state SET last_tick_at = datetime('now'), total_ticks = total_ticks + 1 WHERE id = 1",
      );
      broadcast({
        type: "scheduler:tick",
        result: { ok: true, processed: result.length, results: result },
      });
    } catch (err) {
      console.error("[scheduler] tick error:", err);
    } finally {
      _tickInProgress = false;
    }
  }, options.intervalMs);

  return { stop: stopScheduler, isRunning: () => _running };
}

export function stopScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _running = false;
}

export function isSchedulerRunning(): boolean {
  return _running;
}

export function getSchedulerState(db: Database): {
  running: boolean;
  intervalMs: number;
  lastTickAt: string | null;
  totalTicks: number;
} {
  ensureSchedulerTable(db);
  const row = queryOne(db, "SELECT * FROM scheduler_state WHERE id = 1");
  if (!row) {
    return { running: false, intervalMs: 10_000, lastTickAt: null, totalTicks: 0 };
  }
  return {
    running: (row.running as number) === 1,
    intervalMs: row.interval_ms as number,
    lastTickAt: (row.last_tick_at as string) ?? null,
    totalTicks: row.total_ticks as number,
  };
}

async function schedulerTick(
  db: Database,
  broadcast: SchedulerBroadcast,
  options: SchedulerOptions,
  maxParallel: number,
): Promise<RunResult[]> {
  cleanStaleLocks(db);

  const lanes = getAllLanes(db);
  const eligible = lanes
    .filter((l) => l.mode === "implement" && l.status.includes("running"))
    .slice(0, maxParallel);

  const results: RunResult[] = [];

  for (const lane of eligible) {
    try {
      const result = await runLane(db, lane.id);
      results.push(result);

      if (result.action === "failed") {
        const sr = getCurrentStageRun(db, lane.id);
        const attempt = sr?.attempt ?? 1;
        if (attempt < options.maxRetries) {
          reEnterStage(db, lane.id, result.stage);
        }
      }
    } catch (err) {
      console.error(`[scheduler] runLane(${lane.id}) error:`, err);
    }
  }

  return results;
}
