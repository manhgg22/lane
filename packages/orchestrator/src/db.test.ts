import { describe, it, expect, beforeEach } from "vitest";
import { openDb, getAllLanes, getLaneById, insertLane, updateLane, insertEvent, getEvents, getStageRuns } from "./db.js";
import { seedDemoData } from "./seed.js";
import type { Database } from "./db.js";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

let db: Database;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "harness-test-"));
  db = await openDb(join(tmpDir, "test.db"));
});

describe("DDL + basic operations", () => {
  it("creates tables and starts empty", () => {
    const lanes = getAllLanes(db);
    expect(lanes).toEqual([]);
  });

  it("inserts and retrieves a lane", () => {
    const lane = insertLane(db, {
      title: "Test task",
      slug: "test-task",
      branch: "feat/test-task",
      port: 3001,
      tags: ["api"],
    });
    expect(lane.id).toBe(1);
    expect(lane.title).toBe("Test task");
    expect(lane.slug).toBe("test-task");
    expect(lane.port).toBe(3001);
    expect(lane.tags).toEqual(["api"]);
    expect(lane.mode).toBe("implement");
    expect(lane.stageIndex).toBe(0);
    expect(lane.progress).toBe(0);

    const fetched = getLaneById(db, 1);
    expect(fetched).toBeDefined();
    expect(fetched!.title).toBe("Test task");
  });

  it("updates a lane", () => {
    insertLane(db, {
      title: "Task",
      slug: "task-1",
      branch: "feat/task-1",
      port: 3001,
      tags: [],
    });
    const updated = updateLane(db, 1, {
      stageIndex: 5,
      progress: 60,
      status: ["running"],
      note: "In progress",
      ticket: "SC-100",
      prNumber: 42,
      gitCommit: "abc123",
      gitSubject: "feat: something",
      ci: "green",
      qcDev: 10,
      qcLocal: 30,
    });
    expect(updated!.stageIndex).toBe(5);
    expect(updated!.progress).toBe(60);
    expect(updated!.status).toEqual(["running"]);
    expect(updated!.ticket).toBe("SC-100");
    expect(updated!.prNumber).toBe(42);
    expect(updated!.qc.dev).toBe(10);
    expect(updated!.qc.local).toBe(30);
  });

  it("enforces unique slug", () => {
    insertLane(db, { title: "A", slug: "same", branch: "b", port: 3001, tags: [] });
    expect(() =>
      insertLane(db, { title: "B", slug: "same", branch: "c", port: 3002, tags: [] }),
    ).toThrow();
  });
});

describe("events", () => {
  it("inserts and retrieves events", () => {
    insertLane(db, { title: "T", slug: "s", branch: "b", port: 3001, tags: [] });
    insertEvent(db, 1, "stage_enter", { stage: "implement" });
    insertEvent(db, 1, "stage_pass", { stage: "implement" });

    const events = getEvents(db, 1);
    expect(events.length).toBe(2);
    expect(events[0].type).toBe("stage_pass");
    expect(events[1].type).toBe("stage_enter");
  });
});

describe("seed", () => {
  it("seeds demo data with 2 lanes", () => {
    seedDemoData(db);
    const lanes = getAllLanes(db);
    expect(lanes.length).toBe(2);
    expect(lanes[0].slug).toBe("chat-md-tables");
    expect(lanes[0].stageIndex).toBe(10);
    expect(lanes[1].slug).toBe("codebase-quick-wins");
  });

  it("does not double-seed", () => {
    seedDemoData(db);
    seedDemoData(db);
    expect(getAllLanes(db).length).toBe(2);
  });
});
