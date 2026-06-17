import type { Database } from "./db.js";
import {
  getLaneById,
  updateLane,
  insertEvent,
  insertStageRun,
  updateStageRun,
  getCurrentStageRun as dbGetCurrentStageRun,
  queryAll,
  queryOne,
} from "./db.js";
import { STAGES } from "@harness/types";
import type { Lane, StageName, StageRun } from "@harness/types";

export const TRANSITION_MAP: Record<StageName, StageName | null> = {
  intake: "implement",
  implement: "gates",
  gates: "PR",
  PR: "integrate",
  integrate: "e2e+QC",
  "e2e+QC": "review",
  review: "er gate",
  "er gate": "push-dev",
  "push-dev": "dev/QC",
  "dev/QC": "watch PR",
  "watch PR": "done",
  done: null,
};

export const HEAVY_STAGES: Set<StageName> = new Set(["e2e+QC", "dev/QC"]);

export function calcProgress(stageIndex: number): number {
  return Math.round((stageIndex / (STAGES.length - 1)) * 100);
}

export function isHeavyStage(stage: StageName): boolean {
  return HEAVY_STAGES.has(stage);
}

export function getCurrentStageRun(db: Database, laneId: number): StageRun | undefined {
  return dbGetCurrentStageRun(db, laneId);
}

function requireLane(db: Database, laneId: number): Lane {
  const lane = getLaneById(db, laneId);
  if (!lane) throw new Error(`Lane ${laneId} not found`);
  return lane;
}

function requireCurrentStageRun(db: Database, laneId: number): StageRun {
  const sr = dbGetCurrentStageRun(db, laneId);
  if (!sr) throw new Error(`No active stage run for lane ${laneId}`);
  return sr;
}

export function advanceStage(db: Database, laneId: number): Lane {
  const lane = requireLane(db, laneId);
  const currentStage = STAGES[lane.stageIndex] as StageName;

  if (currentStage === "done") {
    throw new Error(`Lane ${laneId} is already at "done"`);
  }

  const passedRun = queryOne(
    db,
    "SELECT * FROM stage_runs WHERE lane_id = ? AND stage = ? AND result = 'pass' ORDER BY id DESC LIMIT 1",
    [laneId, currentStage],
  );
  if (!passedRun) {
    throw new Error(
      `Cannot advance lane ${laneId}: stage "${currentStage}" has no passed run`,
    );
  }

  const nextStage = TRANSITION_MAP[currentStage]!;
  const nextIndex = STAGES.indexOf(nextStage);

  insertStageRun(db, laneId, nextStage);
  insertEvent(db, laneId, "stage_enter", { stage: nextStage, from: currentStage });
  updateLane(db, laneId, {
    stageIndex: nextIndex,
    progress: calcProgress(nextIndex),
  });

  return requireLane(db, laneId);
}

export function reEnterStage(db: Database, laneId: number, stage: StageName): Lane {
  requireLane(db, laneId);

  const rows = queryAll(
    db,
    "SELECT MAX(attempt) as max_attempt FROM stage_runs WHERE lane_id = ? AND stage = ?",
    [laneId, stage],
  );
  const maxAttempt = (rows[0]?.max_attempt as number) ?? 0;

  insertStageRun(db, laneId, stage, maxAttempt + 1);
  insertEvent(db, laneId, "re_enter", { stage, attempt: maxAttempt + 1 });

  return requireLane(db, laneId);
}

export function blockStage(db: Database, laneId: number, reason: string): Lane {
  const lane = requireLane(db, laneId);
  const sr = requireCurrentStageRun(db, laneId);

  updateStageRun(db, sr.id, {
    state: "pending",
    result: "blocked",
    endedAt: new Date().toISOString(),
    message: reason,
  });

  const newStatus = lane.status.includes("needs_you")
    ? lane.status
    : [...lane.status, "needs_you"];
  updateLane(db, laneId, { status: newStatus as Lane["status"] });

  insertEvent(db, laneId, "blocked", { stage: sr.stage, reason });

  return requireLane(db, laneId);
}

export function passStage(db: Database, laneId: number, evidence: string[] = []): Lane {
  requireLane(db, laneId);
  const sr = requireCurrentStageRun(db, laneId);

  updateStageRun(db, sr.id, {
    state: "done",
    result: "pass",
    evidence,
    endedAt: new Date().toISOString(),
  });

  insertEvent(db, laneId, "stage_pass", {
    stage: sr.stage,
    evidence,
  });

  return requireLane(db, laneId);
}

export function failStage(db: Database, laneId: number, reason: string): Lane {
  requireLane(db, laneId);
  const sr = requireCurrentStageRun(db, laneId);

  updateStageRun(db, sr.id, {
    state: "done",
    result: "fail",
    endedAt: new Date().toISOString(),
    message: reason,
  });

  insertEvent(db, laneId, "stage_fail", { stage: sr.stage, reason });

  return requireLane(db, laneId);
}

export function passNoEvidence(db: Database, laneId: number): Lane {
  requireLane(db, laneId);
  const sr = requireCurrentStageRun(db, laneId);

  updateStageRun(db, sr.id, {
    state: "passed_no_evidence",
    result: "pass",
    endedAt: new Date().toISOString(),
  });

  insertEvent(db, laneId, "stage_pass", {
    stage: sr.stage,
    noEvidence: true,
  });

  return requireLane(db, laneId);
}
