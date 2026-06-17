import { describe, it, expect, beforeEach } from "vitest";
import { openDb, insertLane, updateLane, insertStageRun, getCurrentStageRun, getLaneById, getEvents } from "./db.js";
import type { Database } from "./db.js";
import { STAGES } from "./types.js";
import {
  TRANSITION_MAP,
  calcProgress,
  advanceStage,
  reEnterStage,
  blockStage,
  passStage,
  failStage,
  passNoEvidence,
} from "./state-machine.js";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

let db: Database;

beforeEach(async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "harness-sm-test-"));
  db = await openDb(join(tmpDir, "test.db"));
});

function createTestLane(stageIndex = 0) {
  return insertLane(db, {
    title: "Test Lane",
    slug: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    branch: "feat/test",
    port: 4001,
    tags: ["test"],
  });
}

describe("TRANSITION_MAP", () => {
  it("has an entry for every stage", () => {
    for (const stage of STAGES) {
      expect(TRANSITION_MAP).toHaveProperty(stage);
    }
  });

  it("done maps to null", () => {
    expect(TRANSITION_MAP["done"]).toBeNull();
  });

  it("all non-done stages map to a valid stage", () => {
    for (const stage of STAGES) {
      if (stage === "done") continue;
      const next = TRANSITION_MAP[stage];
      expect(STAGES).toContain(next);
    }
  });
});

describe("calcProgress", () => {
  it("returns 0 for index 0", () => {
    expect(calcProgress(0)).toBe(0);
  });

  it("returns 100 for last index", () => {
    expect(calcProgress(STAGES.length - 1)).toBe(100);
  });

  it("returns 45 for index 5", () => {
    expect(calcProgress(5)).toBe(45);
  });
});

describe("advanceStage", () => {
  it("advances from intake to implement when current stage is passed", () => {
    const lane = createTestLane();
    insertStageRun(db, lane.id, "intake");
    passStage(db, lane.id);

    const updated = advanceStage(db, lane.id);
    expect(updated.stageIndex).toBe(1);
    expect(STAGES[updated.stageIndex]).toBe("implement");

    const sr = getCurrentStageRun(db, lane.id);
    expect(sr).toBeDefined();
    expect(sr!.stage).toBe("implement");
    expect(sr!.state).toBe("current");
  });

  it("throws if current stage is not passed", () => {
    const lane = createTestLane();
    insertStageRun(db, lane.id, "intake");

    expect(() => advanceStage(db, lane.id)).toThrow("no passed run");
  });

  it("throws if lane is already at done", () => {
    const lane = createTestLane();
    updateLane(db, lane.id, { stageIndex: STAGES.indexOf("done") });

    expect(() => advanceStage(db, lane.id)).toThrow("already at \"done\"");
  });

  it("creates stage_enter event", () => {
    const lane = createTestLane();
    insertStageRun(db, lane.id, "intake");
    passStage(db, lane.id);
    advanceStage(db, lane.id);

    const events = getEvents(db, lane.id);
    const enterEvent = events.find(
      (e) => e.type === "stage_enter" && (e.payload as { stage: string }).stage === "implement",
    );
    expect(enterEvent).toBeDefined();
  });
});

describe("reEnterStage", () => {
  it("bumps attempt counter", () => {
    const lane = createTestLane();
    insertStageRun(db, lane.id, "gates");

    const updated = reEnterStage(db, lane.id, "gates");
    const sr = getCurrentStageRun(db, updated.id);
    expect(sr).toBeDefined();
    expect(sr!.attempt).toBe(2);
    expect(sr!.stage).toBe("gates");
  });

  it("creates re_enter event", () => {
    const lane = createTestLane();
    insertStageRun(db, lane.id, "gates");
    reEnterStage(db, lane.id, "gates");

    const events = getEvents(db, lane.id);
    const reEnterEvent = events.find((e) => e.type === "re_enter");
    expect(reEnterEvent).toBeDefined();
  });
});

describe("blockStage", () => {
  it("marks stage as blocked and sets needs_you", () => {
    const lane = createTestLane();
    insertStageRun(db, lane.id, "gates");

    const updated = blockStage(db, lane.id, "CI failed");
    expect(updated.status).toContain("needs_you");

    const sr = getCurrentStageRun(db, lane.id);
    expect(sr).toBeDefined();
    expect(sr!.result).toBe("blocked");
    expect(sr!.message).toBe("CI failed");

    const events = getEvents(db, lane.id);
    const blockedEvent = events.find((e) => e.type === "blocked");
    expect(blockedEvent).toBeDefined();
  });
});

describe("passStage", () => {
  it("marks stage as done with evidence", () => {
    const lane = createTestLane();
    insertStageRun(db, lane.id, "intake");
    passStage(db, lane.id, ["screenshot.png"]);

    const sr = getCurrentStageRun(db, lane.id);
    expect(sr).toBeUndefined();

    const events = getEvents(db, lane.id);
    const passEvent = events.find((e) => e.type === "stage_pass");
    expect(passEvent).toBeDefined();
    expect((passEvent!.payload as { evidence: string[] }).evidence).toEqual(["screenshot.png"]);
  });
});

describe("failStage", () => {
  it("marks stage as failed", () => {
    const lane = createTestLane();
    insertStageRun(db, lane.id, "gates");
    failStage(db, lane.id, "tests broken");

    const events = getEvents(db, lane.id);
    const failEvent = events.find((e) => e.type === "stage_fail");
    expect(failEvent).toBeDefined();
  });
});

describe("passNoEvidence", () => {
  it("marks stage as passed_no_evidence", () => {
    const lane = createTestLane();
    insertStageRun(db, lane.id, "review");
    passNoEvidence(db, lane.id);

    const events = getEvents(db, lane.id);
    const passEvent = events.find(
      (e) => e.type === "stage_pass" && (e.payload as { noEvidence?: boolean }).noEvidence,
    );
    expect(passEvent).toBeDefined();
  });
});

describe("full pipeline traversal", () => {
  it("walks through all stages from intake to done", () => {
    const lane = createTestLane();

    insertStageRun(db, lane.id, "intake");
    for (let i = 0; i < STAGES.length - 1; i++) {
      passStage(db, lane.id);
      advanceStage(db, lane.id);
    }

    const final = getLaneById(db, lane.id)!;
    expect(final.stageIndex).toBe(STAGES.length - 1);
    expect(final.progress).toBe(100);
    expect(STAGES[final.stageIndex]).toBe("done");
  });
});

describe("persist-before-return", () => {
  it("survives DB reload", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "harness-persist-"));
    const dbPath = join(tmpDir, "test.db");
    let db1 = await openDb(dbPath);

    const lane = insertLane(db1, {
      title: "Persist Test",
      slug: "persist-test",
      branch: "feat/persist",
      port: 4099,
      tags: [],
    });

    insertStageRun(db1, lane.id, "intake");
    passStage(db1, lane.id);
    advanceStage(db1, lane.id);

    const db2 = await openDb(dbPath);
    const reloaded = getLaneById(db2, lane.id)!;
    expect(reloaded.stageIndex).toBe(1);
    expect(STAGES[reloaded.stageIndex]).toBe("implement");
  });
});
