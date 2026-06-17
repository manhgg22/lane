import { describe, it, expect, beforeEach } from "vitest";
import { openDb, insertLane, updateLane } from "./db.js";
import type { Database } from "./db.js";
import { acquireLock, releaseLock, getActiveLock, releaseAllLocks, cleanStaleLocks } from "./lock.js";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { run } from "./db.js";

let db: Database;

function createLane(slug: string, status: string[] = ["running"]) {
  const lane = insertLane(db, {
    title: `Lane ${slug}`,
    slug,
    branch: `feat/${slug}`,
    port: 4001,
    tags: [],
  });
  if (JSON.stringify(status) !== '["running"]') {
    updateLane(db, lane.id, { status: status as any });
  }
  return lane;
}

beforeEach(async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "harness-lock-test-"));
  db = await openDb(join(tmpDir, "test.db"));
});

describe("acquireLock", () => {
  it("succeeds on empty table", () => {
    const lane = createLane("lock-a");
    expect(acquireLock(db, "heavy_stage", lane.id)).toBe(true);

    const active = getActiveLock(db, "heavy_stage");
    expect(active).not.toBeNull();
    expect(active!.laneId).toBe(lane.id);
  });

  it("is idempotent for same lane", () => {
    const lane = createLane("lock-b");
    expect(acquireLock(db, "heavy_stage", lane.id)).toBe(true);
    expect(acquireLock(db, "heavy_stage", lane.id)).toBe(true);
  });

  it("fails for different lane", () => {
    const lane1 = createLane("lock-c");
    const lane2 = createLane("lock-d");
    expect(acquireLock(db, "heavy_stage", lane1.id)).toBe(true);
    expect(acquireLock(db, "heavy_stage", lane2.id)).toBe(false);
  });
});

describe("releaseLock", () => {
  it("frees lock for other lanes", () => {
    const lane1 = createLane("rel-a");
    const lane2 = createLane("rel-b");
    acquireLock(db, "heavy_stage", lane1.id);
    releaseLock(db, "heavy_stage", lane1.id);
    expect(acquireLock(db, "heavy_stage", lane2.id)).toBe(true);
  });
});

describe("releaseAllLocks", () => {
  it("clears all locks for a lane", () => {
    const lane = createLane("all-a");
    acquireLock(db, "heavy_stage", lane.id);
    releaseAllLocks(db, lane.id);
    expect(getActiveLock(db, "heavy_stage")).toBeNull();
  });
});

describe("cleanStaleLocks", () => {
  it("removes old locks when lane is not running", () => {
    const lane = createLane("stale-a", ["stalled"]);
    acquireLock(db, "heavy_stage", lane.id);
    run(db, "UPDATE locks SET acquired_at = datetime('now', '-60 minutes') WHERE lane_id = ?", [lane.id]);

    const cleaned = cleanStaleLocks(db, 30);
    expect(cleaned).toBe(1);
    expect(getActiveLock(db, "heavy_stage")).toBeNull();
  });

  it("keeps locks when lane is running", () => {
    const lane = createLane("stale-b");
    acquireLock(db, "heavy_stage", lane.id);
    run(db, "UPDATE locks SET acquired_at = datetime('now', '-60 minutes') WHERE lane_id = ?", [lane.id]);

    const cleaned = cleanStaleLocks(db, 30);
    expect(cleaned).toBe(0);
    expect(getActiveLock(db, "heavy_stage")).not.toBeNull();
  });
});
