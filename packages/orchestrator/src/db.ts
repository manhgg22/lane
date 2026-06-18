import initSqlJs, { type Database } from "sql.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Lane, LaneEvent, StageRun } from "@harness/types";

export type { Database } from "sql.js";

const DDL = `
CREATE TABLE IF NOT EXISTS lanes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  branch TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'implement',
  port INTEGER NOT NULL,
  db_url TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  criteria TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT '["running"]',
  stage_index INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  ticket TEXT,
  pr_number INTEGER,
  git_commit TEXT NOT NULL DEFAULT '',
  git_subject TEXT NOT NULL DEFAULT '',
  ci TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  qc_dev INTEGER NOT NULL DEFAULT 0,
  qc_local INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stage_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lane_id INTEGER NOT NULL REFERENCES lanes(id),
  stage TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempt INTEGER NOT NULL DEFAULT 1,
  evidence TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  result TEXT,
  message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lane_id INTEGER NOT NULL REFERENCES lanes(id),
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  level TEXT NOT NULL,
  lane_id INTEGER,
  stage TEXT,
  message TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lock_type TEXT UNIQUE NOT NULL,
  lane_id INTEGER NOT NULL REFERENCES lanes(id),
  acquired_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

let _dbPath: string | null = null;

export async function openDb(dbPath: string): Promise<Database> {
  _dbPath = dbPath;
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const SQL = await initSqlJs();

  let db: Database;
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.exec(DDL);
  saveDb(db);
  return db;
}

export function saveDb(db: Database): void {
  if (!_dbPath) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(_dbPath, buffer);
}

export function queryAll(db: Database, sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results: Record<string, unknown>[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push(row as Record<string, unknown>);
  }
  stmt.free();
  return results;
}

export function queryOne(db: Database, sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
  const rows = queryAll(db, sql, params);
  return rows[0];
}

export function run(db: Database, sql: string, params: unknown[] = []): void {
  db.run(sql, params);
  saveDb(db);
}

export function getLastInsertId(db: Database): number {
  const stmt = db.prepare("SELECT last_insert_rowid() as id");
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();
  return (row.id as number) ?? 0;
}

function rowToLane(row: Record<string, unknown>): Lane {
  return {
    id: row.id as number,
    title: row.title as string,
    slug: row.slug as string,
    branch: row.branch as string,
    mode: row.mode as Lane["mode"],
    port: row.port as number,
    dbUrl: row.db_url as string,
    tags: JSON.parse(row.tags as string),
    criteria: JSON.parse((row.criteria as string) ?? "[]"),
    status: JSON.parse(row.status as string),
    stageIndex: row.stage_index as number,
    progress: row.progress as number,
    ticket: (row.ticket as string) ?? null,
    prNumber: (row.pr_number as number) ?? null,
    git: {
      commit: row.git_commit as string,
      subject: row.git_subject as string,
      ci: row.ci as string,
    },
    note: row.note as string,
    priority: (row.priority as number) ?? 0,
    qc: {
      dev: row.qc_dev as number,
      local: row.qc_local as number,
    },
    updatedAt: row.updated_at as string,
    createdAt: row.created_at as string,
  };
}

export function getAllLanes(db: Database): Lane[] {
  return queryAll(db, "SELECT * FROM lanes ORDER BY id").map(rowToLane);
}

export function getLaneById(db: Database, id: number): Lane | undefined {
  const row = queryOne(db, "SELECT * FROM lanes WHERE id = ?", [id]);
  return row ? rowToLane(row) : undefined;
}

export function insertLane(
  db: Database,
  lane: {
    title: string;
    slug: string;
    branch: string;
    port: number;
    tags: string[];
    criteria?: string[];
    mode?: string;
    dbUrl?: string;
  },
): Lane {
  db.run(`
    INSERT INTO lanes (title, slug, branch, port, tags, criteria, mode, db_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    lane.title,
    lane.slug,
    lane.branch,
    lane.port,
    JSON.stringify(lane.tags),
    JSON.stringify(lane.criteria ?? []),
    lane.mode ?? "implement",
    lane.dbUrl ?? "",
  ]);
  const id = getLastInsertId(db);
  saveDb(db);
  return getLaneById(db, id)!;
}

export function updateLane(
  db: Database,
  id: number,
  updates: Partial<{
    mode: string;
    stageIndex: number;
    progress: number;
    status: string[];
    note: string;
    ticket: string | null;
    prNumber: number | null;
    gitCommit: string;
    gitSubject: string;
    ci: string;
    qcDev: number;
    qcLocal: number;
  }>,
): Lane | undefined {
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: unknown[] = [];

  if (updates.mode !== undefined) { sets.push("mode = ?"); params.push(updates.mode); }
  if (updates.stageIndex !== undefined) { sets.push("stage_index = ?"); params.push(updates.stageIndex); }
  if (updates.progress !== undefined) { sets.push("progress = ?"); params.push(updates.progress); }
  if (updates.status !== undefined) { sets.push("status = ?"); params.push(JSON.stringify(updates.status)); }
  if (updates.note !== undefined) { sets.push("note = ?"); params.push(updates.note); }
  if (updates.ticket !== undefined) { sets.push("ticket = ?"); params.push(updates.ticket); }
  if (updates.prNumber !== undefined) { sets.push("pr_number = ?"); params.push(updates.prNumber); }
  if (updates.gitCommit !== undefined) { sets.push("git_commit = ?"); params.push(updates.gitCommit); }
  if (updates.gitSubject !== undefined) { sets.push("git_subject = ?"); params.push(updates.gitSubject); }
  if (updates.ci !== undefined) { sets.push("ci = ?"); params.push(updates.ci); }
  if (updates.qcDev !== undefined) { sets.push("qc_dev = ?"); params.push(updates.qcDev); }
  if (updates.qcLocal !== undefined) { sets.push("qc_local = ?"); params.push(updates.qcLocal); }

  params.push(id);
  run(db, `UPDATE lanes SET ${sets.join(", ")} WHERE id = ?`, params);
  return getLaneById(db, id);
}

export function getStageRuns(db: Database, laneId: number): StageRun[] {
  return queryAll(
    db,
    "SELECT * FROM stage_runs WHERE lane_id = ? ORDER BY started_at DESC LIMIT 20",
    [laneId],
  ).map(rowToStageRun);
}

export function getEvents(db: Database, laneId: number, after?: number): LaneEvent[] {
  const sql = after
    ? "SELECT * FROM events WHERE lane_id = ? AND id > ? ORDER BY id LIMIT 100"
    : "SELECT * FROM events WHERE lane_id = ? ORDER BY id DESC LIMIT 50";
  const params = after ? [laneId, after] : [laneId];
  return queryAll(db, sql, params).map((row) => ({
    id: row.id as number,
    laneId: row.lane_id as number,
    ts: row.ts as string,
    type: row.type as LaneEvent["type"],
    payload: JSON.parse(row.payload as string),
  }));
}

export function insertEvent(
  db: Database,
  laneId: number,
  type: LaneEvent["type"],
  payload: Record<string, unknown> = {},
): void {
  run(
    db,
    "INSERT INTO events (lane_id, type, payload) VALUES (?, ?, ?)",
    [laneId, type, JSON.stringify(payload)],
  );
}

export function insertStageRun(
  db: Database,
  laneId: number,
  stage: string,
  attempt: number = 1,
): StageRun {
  db.run(
    "INSERT INTO stage_runs (lane_id, stage, state, attempt) VALUES (?, ?, 'current', ?)",
    [laneId, stage, attempt],
  );
  const id = getLastInsertId(db);
  saveDb(db);
  const row = queryOne(db, "SELECT * FROM stage_runs WHERE id = ?", [id])!;
  return rowToStageRun(row);
}

export function updateStageRun(
  db: Database,
  id: number,
  updates: Partial<{
    state: string;
    result: string | null;
    evidence: string[];
    endedAt: string;
    message: string;
  }>,
): void {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.state !== undefined) { sets.push("state = ?"); params.push(updates.state); }
  if (updates.result !== undefined) { sets.push("result = ?"); params.push(updates.result); }
  if (updates.evidence !== undefined) { sets.push("evidence = ?"); params.push(JSON.stringify(updates.evidence)); }
  if (updates.endedAt !== undefined) { sets.push("ended_at = ?"); params.push(updates.endedAt); }
  if (updates.message !== undefined) { sets.push("message = ?"); params.push(updates.message); }

  if (sets.length === 0) return;
  params.push(id);
  run(db, `UPDATE stage_runs SET ${sets.join(", ")} WHERE id = ?`, params);
}

export function getCurrentStageRun(
  db: Database,
  laneId: number,
): StageRun | undefined {
  const row = queryOne(
    db,
    "SELECT * FROM stage_runs WHERE lane_id = ? AND state IN ('current','pending') ORDER BY id DESC LIMIT 1",
    [laneId],
  );
  return row ? rowToStageRun(row) : undefined;
}

export interface AuditEntry {
  id: number;
  ts: string;
  level: string;
  laneId: number | null;
  stage: string | null;
  message: string;
  data: Record<string, unknown>;
}

export function insertAudit(
  db: Database,
  level: string,
  message: string,
  laneId?: number,
  stage?: string,
  data?: Record<string, unknown>,
): void {
  run(
    db,
    "INSERT INTO audit_log (level, message, lane_id, stage, data) VALUES (?, ?, ?, ?, ?)",
    [level, message, laneId ?? null, stage ?? null, JSON.stringify(data ?? {})],
  );
}

export function getAuditLog(
  db: Database,
  options: { limit?: number; level?: string } = {},
): AuditEntry[] {
  const { limit = 100, level } = options;
  const sql = level
    ? "SELECT * FROM audit_log WHERE level = ? ORDER BY id DESC LIMIT ?"
    : "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?";
  const params = level ? [level, limit] : [limit];

  return queryAll(db, sql, params).map((row) => ({
    id: row.id as number,
    ts: row.ts as string,
    level: row.level as string,
    laneId: (row.lane_id as number) ?? null,
    stage: (row.stage as string) ?? null,
    message: row.message as string,
    data: JSON.parse(row.data as string),
  }));
}

function rowToStageRun(row: Record<string, unknown>): StageRun {
  return {
    id: row.id as number,
    laneId: row.lane_id as number,
    stage: row.stage as string,
    state: row.state as StageRun["state"],
    attempt: row.attempt as number,
    evidence: JSON.parse(row.evidence as string),
    startedAt: row.started_at as string,
    endedAt: (row.ended_at as string) ?? null,
    result: (row.result as StageRun["result"]) ?? null,
    message: row.message as string,
  };
}
