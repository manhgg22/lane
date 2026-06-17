import type { Database } from "./db.js";
import type { Lane, StageName, StageResult } from "@harness/types";
import { STAGES } from "@harness/types";
import { acquireLock, releaseLock } from "./lock.js";
import { updateLane } from "./db.js";
import { runAgent } from "./agent.js";
import { execInContainer, execInLaneDir } from "./exec.js";
import { buildImplementPrompt, buildReviewPrompt } from "./prompt-builder.js";
import { getLaneDir } from "./lane-manager.js";

const HEAVY_LOCK_TYPE = "heavy_stage";
const ROOT_DIR = process.env.HARNESS_ROOT ?? process.cwd();

export interface StageHandler {
  canEnter(lane: Lane, db: Database): boolean;
  execute(lane: Lane, db: Database): Promise<StageResult>;
  onPass(lane: Lane, db: Database): void;
  onFail(lane: Lane, db: Database): void;
}

function createIntakeHandler(): StageHandler {
  return {
    canEnter: () => true,
    async execute(lane: Lane): Promise<StageResult> {
      const dir = getLaneDir(ROOT_DIR, lane.slug);
      if (!dir) return "fail";
      return "pass";
    },
    onPass: () => {},
    onFail: () => {},
  };
}

function createImplementHandler(): StageHandler {
  return {
    canEnter: () => true,
    async execute(lane: Lane): Promise<StageResult> {
      const dir = getLaneDir(ROOT_DIR, lane.slug);
      const criteria = lane.tags;
      const prompt = buildImplementPrompt(lane, criteria);

      try {
        const result = await runAgent(dir, prompt, { timeoutMs: 600_000 });
        if (result.exitCode === 0) {
          return "pass";
        }
        return "fail";
      } catch {
        return "fail";
      }
    },
    onPass: () => {},
    onFail: () => {},
  };
}

function createGatesHandler(): StageHandler {
  return {
    canEnter: () => true,
    async execute(lane: Lane): Promise<StageResult> {
      const dir = getLaneDir(ROOT_DIR, lane.slug);

      const lint = execInLaneDir(dir, "npm run lint", 300_000);
      if (lint.exitCode !== 0) {
        console.error(`[gates] lint failed for ${lane.slug}: ${lint.stderr}`);
        return "fail";
      }

      const typecheck = execInLaneDir(dir, "npm run typecheck", 300_000);
      if (typecheck.exitCode !== 0) {
        console.error(`[gates] typecheck failed for ${lane.slug}: ${typecheck.stderr}`);
        return "fail";
      }

      const test = execInLaneDir(dir, "npm test", 300_000);
      if (test.exitCode !== 0) {
        console.error(`[gates] test failed for ${lane.slug}: ${test.stderr}`);
        return "fail";
      }

      return "pass";
    },
    onPass: () => {},
    onFail: () => {},
  };
}

function createPrHandler(): StageHandler {
  return {
    canEnter: () => true,
    async execute(lane: Lane, db: Database): Promise<StageResult> {
      const dir = getLaneDir(ROOT_DIR, lane.slug);

      const push = execInLaneDir(dir, `git push origin ${lane.branch}`, 60_000);
      if (push.exitCode !== 0) {
        console.error(`[PR] push failed for ${lane.slug}: ${push.stderr}`);
        return "fail";
      }

      const pr = execInLaneDir(
        dir,
        `gh pr create --title "${lane.title}" --body "Automated PR for lane ${lane.slug}" --head ${lane.branch} 2>&1`,
        60_000,
      );

      if (pr.exitCode !== 0) {
        if (pr.stdout.includes("already exists")) {
          return "pass";
        }
        console.error(`[PR] gh pr create failed for ${lane.slug}: ${pr.stdout} ${pr.stderr}`);
        return "fail";
      }

      const prNumberMatch = pr.stdout.match(/\/pull\/(\d+)/);
      if (prNumberMatch) {
        updateLane(db, lane.id, { prNumber: parseInt(prNumberMatch[1], 10) });
      }

      return "pass";
    },
    onPass: () => {},
    onFail: () => {},
  };
}

function createIntegrateHandler(): StageHandler {
  return {
    canEnter: () => true,
    async execute(lane: Lane): Promise<StageResult> {
      const dir = getLaneDir(ROOT_DIR, lane.slug);

      const fetch = execInLaneDir(dir, `git fetch origin`, 60_000);
      if (fetch.exitCode !== 0) {
        return "fail";
      }

      const merge = execInLaneDir(dir, `git merge origin/development --no-edit`, 60_000);
      if (merge.exitCode !== 0) {
        if (merge.stderr.includes("CONFLICT") || merge.stdout.includes("CONFLICT")) {
          execInLaneDir(dir, "git merge --abort");
          return "blocked";
        }
        return "fail";
      }

      return "pass";
    },
    onPass: () => {},
    onFail: () => {},
  };
}

function createHeavyHandler(): StageHandler {
  return {
    canEnter(lane: Lane, db: Database): boolean {
      return acquireLock(db, HEAVY_LOCK_TYPE, lane.id);
    },
    async execute(lane: Lane): Promise<StageResult> {
      const containerName = `harness-${lane.slug}`;
      const result = execInContainer(containerName, "npm test", 600_000);

      if (result.exitCode === 0) {
        return "pass";
      }

      console.error(`[heavy] tests failed in ${containerName}: ${result.stderr}`);
      return "fail";
    },
    onPass(lane: Lane, db: Database): void {
      releaseLock(db, HEAVY_LOCK_TYPE, lane.id);
    },
    onFail(lane: Lane, db: Database): void {
      releaseLock(db, HEAVY_LOCK_TYPE, lane.id);
    },
  };
}

function createReviewHandler(): StageHandler {
  return {
    canEnter: () => true,
    async execute(lane: Lane): Promise<StageResult> {
      const dir = getLaneDir(ROOT_DIR, lane.slug);

      const diffResult = execInLaneDir(dir, "git diff origin/development...HEAD", 30_000);
      if (!diffResult.stdout.trim()) {
        return "pass";
      }

      try {
        const prompt = buildReviewPrompt(lane, diffResult.stdout);
        const result = await runAgent(dir, prompt, { timeoutMs: 300_000 });

        if (result.output.includes("ISSUES_FOUND: true")) {
          return "blocked";
        }

        return "pass";
      } catch {
        return "blocked";
      }
    },
    onPass: () => {},
    onFail: () => {},
  };
}

function createErGateHandler(): StageHandler {
  return {
    canEnter: () => true,
    async execute(): Promise<StageResult> {
      return "blocked";
    },
    onPass: () => {},
    onFail: () => {},
  };
}

function createPushDevHandler(): StageHandler {
  return {
    canEnter: () => true,
    async execute(lane: Lane): Promise<StageResult> {
      const dir = getLaneDir(ROOT_DIR, lane.slug);

      const push = execInLaneDir(dir, `git push origin ${lane.branch}`, 60_000);
      if (push.exitCode !== 0) {
        console.error(`[push-dev] push failed for ${lane.slug}: ${push.stderr}`);
        return "fail";
      }

      return "pass";
    },
    onPass: () => {},
    onFail: () => {},
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

const HANDLER_MAP: Record<StageName, () => StageHandler> = {
  "intake": createIntakeHandler,
  "implement": createImplementHandler,
  "gates": createGatesHandler,
  "PR": createPrHandler,
  "integrate": createIntegrateHandler,
  "e2e+QC": createHeavyHandler,
  "review": createReviewHandler,
  "er gate": createErGateHandler,
  "push-dev": createPushDevHandler,
  "dev/QC": createHeavyHandler,
  "watch PR": createWatchPrHandler,
  "done": createDoneHandler,
};

for (const stage of STAGES) {
  const factory = HANDLER_MAP[stage];
  handlerRegistry.set(stage, factory());
}
