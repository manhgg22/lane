import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, insertLane, insertStageRun, updateStageRun, queryAll } from "./db.js";
import { acquireLock } from "./lock.js";
import { recoverFromCrash } from "./recovery.js";

describe("recoverFromCrash", () => {
  let db: Awaited<ReturnType<typeof openDb>>;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-test-"));
    db = await openDb(join(dir, "test.db"));
  });

  it("resets stuck stage_runs from current to pending", async () => {
    const lane = insertLane(db, {
      title: "Test Lane",
      slug: "test-lane-recover",
      branch: "feat/test",
      port: 4001,
      tags: ["test"],
    });

    const sr = insertStageRun(db, lane.id, "implement");
    expect(sr.state).toBe("current");

    const result = recoverFromCrash(db);

    expect(result.resetStageRuns).toBe(1);

    const rows = queryAll(db, "SELECT state FROM stage_runs WHERE id = ?", [sr.id]);
    expect(rows[0].state).toBe("pending");
  });

  it("releases orphan locks for non-running lanes", async () => {
    const lane = insertLane(db, {
      title: "Stalled Lane",
      slug: "stalled-lane",
      branch: "feat/stalled",
      port: 4002,
      tags: [],
    });

    acquireLock(db, "heavy_stage", lane.id);

    db.run("UPDATE lanes SET status = ? WHERE id = ?", [
      JSON.stringify(["stalled"]),
      lane.id,
    ]);

    const result = recoverFromCrash(db);

    expect(result.releasedLocks).toBe(1);

    const locks = queryAll(db, "SELECT * FROM locks WHERE lane_id = ?", [lane.id]);
    expect(locks.length).toBe(0);
  });

  it("does nothing when no stuck state exists", async () => {
    const result = recoverFromCrash(db);

    expect(result.resetStageRuns).toBe(0);
    expect(result.releasedLocks).toBe(0);
  });
});
