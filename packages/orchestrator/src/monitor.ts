import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join, resolve } from "node:path";
import type { Database } from "./db.js";
import { getAllLanes, updateLane, insertEvent, insertAudit } from "./db.js";
import { STAGES } from "@harness/types";
import type { StageName } from "@harness/types";

export interface StateReport {
  stage: string;
  stageIndex: number;
  status: string;
  attempt: number;
  evidence: string[];
  note: string;
  updatedAt: string;
  laneSlug?: string;
  sessionId?: string;
}

export type MonitorCallback = (slug: string, state: StateReport) => void;

const watchers = new Map<string, FSWatcher>();

export function startMonitoringLane(
  rootDir: string,
  slug: string,
  db: Database,
  onStateChange?: MonitorCallback,
): void {
  const laneDir = join(resolve(rootDir, "lanes"), slug);
  const statePath = join(laneDir, ".harness", "state.json");

  if (watchers.has(slug)) return;

  const pollMs = 2000;
  let lastContent = "";

  const interval = setInterval(() => {
    if (!existsSync(statePath)) return;

    try {
      const content = readFileSync(statePath, "utf-8");
      if (content === lastContent) return;
      lastContent = content;

      const state: StateReport = JSON.parse(content);
      processStateUpdate(slug, state, db, onStateChange);
    } catch {}
  }, pollMs);

  watchers.set(slug, interval as unknown as FSWatcher);
}

export function stopMonitoringLane(slug: string): void {
  const w = watchers.get(slug);
  if (w) {
    clearInterval(w as unknown as NodeJS.Timeout);
    watchers.delete(slug);
  }
}

export function stopAllMonitors(): void {
  for (const slug of watchers.keys()) {
    stopMonitoringLane(slug);
  }
}

function processStateUpdate(
  slug: string,
  state: StateReport,
  db: Database,
  onStateChange?: MonitorCallback,
): void {
  const lanes = getAllLanes(db);
  const lane = lanes.find((l) => l.slug === slug);
  if (!lane) return;

  const stageIndex = STAGES.indexOf(state.stage as StageName);
  if (stageIndex < 0) return;

  const updates: Parameters<typeof updateLane>[2] = {};
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
    updateLane(db, lane.id, updates);
    insertEvent(db, lane.id, "stage_enter", {
      stage: state.stage,
      status: state.status,
      attempt: state.attempt,
    });
    insertAudit(db, "info", `${slug}: ${state.stage} -> ${state.status}`, lane.id, state.stage);
  }

  if (onStateChange) {
    onStateChange(slug, state);
  }
}
