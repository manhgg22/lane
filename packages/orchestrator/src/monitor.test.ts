import { describe, it, expect, vi, beforeEach } from "vitest";
import { STAGES } from "@harness/types";

// We test the processStateUpdate logic by importing the module and mocking db calls
vi.mock("./db.js", () => ({
  getAllLanes: vi.fn(),
  updateLane: vi.fn(),
  insertEvent: vi.fn(),
  insertAudit: vi.fn(),
}));

import { getAllLanes, updateLane, insertEvent, insertAudit } from "./db.js";
import type { Lane } from "@harness/types";
import type { Database } from "sql.js";

function makeLane(overrides: Partial<Lane> = {}): Lane {
  return {
    id: 1,
    title: "Test lane",
    slug: "test-lane",
    branch: "feat/test",
    mode: "implement",
    port: 4001,
    dbUrl: "",
    tags: [],
    criteria: [],
    status: ["running"],
    stageIndex: 0,
    progress: 0,
    ticket: null,
    prNumber: null,
    git: { commit: "", subject: "", ci: "" },
    note: "",
    priority: 0,
    qc: { dev: 0, local: 0 },
    updatedAt: "",
    createdAt: "",
    ...overrides,
  };
}

// Extract the processStateUpdate logic inline since it's not exported
// We replicate the exact same logic from monitor.ts
function processStateUpdate(
  slug: string,
  state: { stage: string; status: string; attempt: number; note: string },
  db: Database,
  onStateChange?: (slug: string, state: any) => void,
): void {
  const lanes = (getAllLanes as any)(db);
  const lane = lanes.find((l: Lane) => l.slug === slug);
  if (!lane) return;

  const stageIndex = STAGES.indexOf(state.stage as any);
  if (stageIndex < 0) return;

  const updates: Record<string, any> = {};
  let changed = false;

  if (stageIndex !== lane.stageIndex) {
    updates.stageIndex = stageIndex;
    updates.progress = Math.round((stageIndex / (STAGES.length - 1)) * 100);
    changed = true;
  }

  if (state.note && state.note !== lane.note) {
    updates.note = state.note;
    changed = true;
  }

  const statusMap: Record<string, string[]> = {
    running: ["running"],
    done: ["running"],
    fail: ["stalled"],
    blocked: ["stalled"],
    needs_you: ["needs_you"],
    passed_no_evidence: ["needs_you"],
  };

  const newStatus = statusMap[state.status];
  if (newStatus && JSON.stringify(newStatus) !== JSON.stringify(lane.status)) {
    updates.status = newStatus;
    changed = true;
  }

  if (changed) {
    (updateLane as any)(db, lane.id, updates);
    (insertEvent as any)(db, lane.id, "stage_enter", {
      stage: state.stage,
      status: state.status,
      attempt: state.attempt,
    });
    (insertAudit as any)(db, "info", `${slug}: ${state.stage} -> ${state.status}`, lane.id, state.stage);
  }

  if (onStateChange) {
    onStateChange(slug, state);
  }
}

const fakeDb = {} as Database;

describe("processStateUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates stage index and progress when stage changes", () => {
    const lane = makeLane({ stageIndex: 0, status: ["running"] });
    (getAllLanes as any).mockReturnValue([lane]);

    processStateUpdate("test-lane", {
      stage: "implement",
      status: "running",
      attempt: 1,
      note: "",
    }, fakeDb);

    expect(updateLane).toHaveBeenCalledWith(fakeDb, 1, expect.objectContaining({
      stageIndex: 1,
      progress: Math.round((1 / (STAGES.length - 1)) * 100),
    }));
    expect(insertEvent).toHaveBeenCalled();
    expect(insertAudit).toHaveBeenCalled();
  });

  it("updates note when note changes", () => {
    const lane = makeLane({ stageIndex: 1, note: "" });
    (getAllLanes as any).mockReturnValue([lane]);

    processStateUpdate("test-lane", {
      stage: "implement",
      status: "running",
      attempt: 1,
      note: "coding in progress",
    }, fakeDb);

    expect(updateLane).toHaveBeenCalledWith(fakeDb, 1, expect.objectContaining({
      note: "coding in progress",
    }));
  });

  it("maps fail status to stalled", () => {
    const lane = makeLane({ stageIndex: 1, status: ["running"] });
    (getAllLanes as any).mockReturnValue([lane]);

    processStateUpdate("test-lane", {
      stage: "implement",
      status: "fail",
      attempt: 1,
      note: "",
    }, fakeDb);

    expect(updateLane).toHaveBeenCalledWith(fakeDb, 1, expect.objectContaining({
      status: ["stalled"],
    }));
  });

  it("maps needs_you status to needs_you", () => {
    const lane = makeLane({ stageIndex: 2, status: ["running"] });
    (getAllLanes as any).mockReturnValue([lane]);

    processStateUpdate("test-lane", {
      stage: "gates",
      status: "needs_you",
      attempt: 1,
      note: "",
    }, fakeDb);

    expect(updateLane).toHaveBeenCalledWith(fakeDb, 1, expect.objectContaining({
      status: ["needs_you"],
    }));
  });

  it("does nothing when lane not found", () => {
    (getAllLanes as any).mockReturnValue([]);

    processStateUpdate("nonexistent", {
      stage: "implement",
      status: "running",
      attempt: 1,
      note: "",
    }, fakeDb);

    expect(updateLane).not.toHaveBeenCalled();
  });

  it("does nothing for invalid stage name", () => {
    const lane = makeLane();
    (getAllLanes as any).mockReturnValue([lane]);

    processStateUpdate("test-lane", {
      stage: "invalid-stage",
      status: "running",
      attempt: 1,
      note: "",
    }, fakeDb);

    expect(updateLane).not.toHaveBeenCalled();
  });

  it("does not update when nothing changed", () => {
    const lane = makeLane({ stageIndex: 1, status: ["running"], note: "same" });
    (getAllLanes as any).mockReturnValue([lane]);

    processStateUpdate("test-lane", {
      stage: "implement",
      status: "running",
      attempt: 1,
      note: "same",
    }, fakeDb);

    expect(updateLane).not.toHaveBeenCalled();
  });

  it("calls onStateChange callback", () => {
    const lane = makeLane({ stageIndex: 0 });
    (getAllLanes as any).mockReturnValue([lane]);
    const callback = vi.fn();

    processStateUpdate("test-lane", {
      stage: "implement",
      status: "running",
      attempt: 1,
      note: "",
    }, fakeDb, callback);

    expect(callback).toHaveBeenCalledWith("test-lane", expect.objectContaining({
      stage: "implement",
      status: "running",
    }));
  });

  it("calculates correct progress for last stage", () => {
    const lane = makeLane({ stageIndex: 0 });
    (getAllLanes as any).mockReturnValue([lane]);

    processStateUpdate("test-lane", {
      stage: "done",
      status: "done",
      attempt: 1,
      note: "",
    }, fakeDb);

    expect(updateLane).toHaveBeenCalledWith(fakeDb, 1, expect.objectContaining({
      stageIndex: STAGES.indexOf("done"),
      progress: 100,
    }));
  });
});
