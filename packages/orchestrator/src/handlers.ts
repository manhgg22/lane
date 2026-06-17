import type { Database } from "./db.js";
import type { Lane, StageName, StageResult } from "@harness/types";
import { STAGES } from "@harness/types";
import { acquireLock, releaseLock } from "./lock.js";

const HEAVY_LOCK_TYPE = "heavy_stage";

export interface StageHandler {
  canEnter(lane: Lane, db: Database): boolean;
  execute(lane: Lane, db: Database): Promise<StageResult>;
  onPass(lane: Lane, db: Database): void;
  onFail(lane: Lane, db: Database): void;
}

function createStubHandler(): StageHandler {
  return {
    canEnter: () => true,
    execute: async () => "pass",
    onPass: () => {},
    onFail: () => {},
  };
}

function createHeavyStubHandler(): StageHandler {
  return {
    canEnter(lane: Lane, db: Database): boolean {
      return acquireLock(db, HEAVY_LOCK_TYPE, lane.id);
    },
    async execute(): Promise<StageResult> {
      return "pass";
    },
    onPass(lane: Lane, db: Database): void {
      releaseLock(db, HEAVY_LOCK_TYPE, lane.id);
    },
    onFail(lane: Lane, db: Database): void {
      releaseLock(db, HEAVY_LOCK_TYPE, lane.id);
    },
  };
}

function createWatchPrHandler(): StageHandler {
  return {
    canEnter: () => true,
    async execute(): Promise<StageResult> {
      return "blocked";
    },
    onPass: () => {},
    onFail: () => {},
  };
}

function createDoneHandler(): StageHandler {
  return {
    canEnter: () => false,
    async execute(): Promise<StageResult> {
      return "pass";
    },
    onPass: () => {},
    onFail: () => {},
  };
}

export const handlerRegistry: Map<StageName, StageHandler> = new Map();

for (const stage of STAGES) {
  if (stage === "e2e+QC" || stage === "dev/QC") {
    handlerRegistry.set(stage, createHeavyStubHandler());
  } else if (stage === "watch PR") {
    handlerRegistry.set(stage, createWatchPrHandler());
  } else if (stage === "done") {
    handlerRegistry.set(stage, createDoneHandler());
  } else {
    handlerRegistry.set(stage, createStubHandler());
  }
}
