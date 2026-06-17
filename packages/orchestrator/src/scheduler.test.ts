import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db.js";
import {
  startScheduler,
  stopScheduler,
  isSchedulerRunning,
  getSchedulerState,
  ensureSchedulerTable,
} from "./scheduler.js";

describe("scheduler", () => {
  let db: Awaited<ReturnType<typeof openDb>>;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "sched-test-"));
    db = await openDb(join(dir, "test.db"));
    stopScheduler();
  });

  afterEach(() => {
    stopScheduler();
  });

  it("creates scheduler_state table and seed row", () => {
    ensureSchedulerTable(db);
    const state = getSchedulerState(db);
    expect(state.running).toBe(false);
    expect(state.totalTicks).toBe(0);
    expect(state.lastTickAt).toBeNull();
  });

  it("starts and stops scheduler", () => {
    const broadcast = vi.fn();
    const handle = startScheduler(db, broadcast, {
      intervalMs: 60_000,
      maxRetries: 3,
      retryDelayMs: 1000,
    });

    expect(handle.isRunning()).toBe(true);
    expect(isSchedulerRunning()).toBe(true);
    expect(broadcast).toHaveBeenCalledWith({ type: "scheduler:started" });

    handle.stop();
    expect(isSchedulerRunning()).toBe(false);
  });

  it("prevents double start", () => {
    const broadcast = vi.fn();
    startScheduler(db, broadcast, {
      intervalMs: 60_000,
      maxRetries: 3,
      retryDelayMs: 1000,
    });

    const handle2 = startScheduler(db, broadcast, {
      intervalMs: 60_000,
      maxRetries: 3,
      retryDelayMs: 1000,
    });

    expect(broadcast).toHaveBeenCalledTimes(1);
    handle2.stop();
  });

  it("getSchedulerState returns defaults before init", () => {
    const state = getSchedulerState(db);
    expect(state).toEqual({
      running: false,
      intervalMs: 10_000,
      lastTickAt: null,
      totalTicks: 0,
    });
  });
});
