import initSqlJs from "sql.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

let _dbPath = null;

export async function initDb(dbUrl) {
  _dbPath = dbUrl || "./app.db";
  if (_dbPath.startsWith("sqlite:")) _dbPath = _dbPath.slice(7);

  const SQL = await initSqlJs();
  let db;
  if (_dbPath === ":memory:") {
    db = new SQL.Database();
  } else {
    const dir = dirname(_dbPath);
    if (dir && dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(_dbPath)) {
      db = new SQL.Database(readFileSync(_dbPath));
    } else {
      db = new SQL.Database();
    }
  }

  db.run(`CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  save(db);
  return db;
}

function save(db) {
  if (!_dbPath || _dbPath === ":memory:") return;
  writeFileSync(_dbPath, Buffer.from(db.export()));
}

export function getAllTodos(db) {
  const stmt = db.prepare("SELECT * FROM todos ORDER BY id DESC");
  const results = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    results.push({ ...r, done: !!r.done });
  }
  stmt.free();
  return results;
}

export function getTodo(db, id) {
  const stmt = db.prepare("SELECT * FROM todos WHERE id = ?");
  stmt.bind([id]);
  if (!stmt.step()) { stmt.free(); return null; }
  const r = stmt.getAsObject();
  stmt.free();
  return { ...r, done: !!r.done };
}

export function createTodo(db, title) {
  db.run("INSERT INTO todos (title) VALUES (?)", [title]);
  const stmt = db.prepare("SELECT * FROM todos WHERE id = last_insert_rowid()");
  stmt.step();
  const r = stmt.getAsObject();
  stmt.free();
  save(db);
  return { ...r, done: !!r.done };
}

export function updateTodo(db, id, updates) {
  if (updates.title !== undefined) db.run("UPDATE todos SET title = ? WHERE id = ?", [updates.title, id]);
  if (updates.done !== undefined) db.run("UPDATE todos SET done = ? WHERE id = ?", [updates.done ? 1 : 0, id]);
  save(db);
  return getTodo(db, id);
}

export function deleteTodo(db, id) {
  db.run("DELETE FROM todos WHERE id = ?", [id]);
  save(db);
}

export function searchTodos(db, { q = "", page = 1, limit = 10 }) {
  const term = `%${q}%`;
  const offset = (page - 1) * limit;

  const countStmt = db.prepare("SELECT COUNT(*) as cnt FROM todos WHERE title LIKE ? COLLATE NOCASE");
  countStmt.bind([term]);
  countStmt.step();
  const { cnt } = countStmt.getAsObject();
  countStmt.free();

  const stmt = db.prepare("SELECT * FROM todos WHERE title LIKE ? COLLATE NOCASE ORDER BY id DESC LIMIT ? OFFSET ?");
  stmt.bind([term, limit, offset]);
  const results = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    results.push({ ...r, done: !!r.done });
  }
  stmt.free();

  return { data: results, total: cnt, page, limit };
}
