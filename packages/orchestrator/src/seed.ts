import type { Database } from "./db.js";
import { insertLane, updateLane, insertEvent } from "./db.js";

export function seedDemoData(db: Database): void {
  const stmt = db.prepare("SELECT COUNT(*) as cnt FROM lanes");
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();
  if ((row.cnt as number) > 0) return;

  const lane1 = insertLane(db, {
    title: "Chat bubble tables: scroll + sticky header",
    slug: "chat-md-tables",
    branch: "feat/chat-md-tables",
    port: 3001,
    tags: ["api", "fe", "GO"],
    mode: "watching-pr",
    dbUrl: "sqlite:lanes/chat-md-tables/app.db",
  });

  updateLane(db, lane1.id, {
    stageIndex: 10,
    progress: 94,
    status: ["stalled", "running"],
    ticket: "SC-138",
    prNumber: 106,
    gitCommit: "ae15a09",
    gitSubject: "Merge branch 'feat/chat-md-tables' into development",
    ci: "PR green; dev green",
    note: "SHIPPED ✓ PR#106 green, dev green, SC-138, dev-QC PASS. Watching PR.",
    qcDev: 14,
    qcLocal: 39,
  });

  insertEvent(db, lane1.id, "stage_enter", {
    stage: "watch PR",
    message: "Watching PR for feedback",
  });

  const lane2 = insertLane(db, {
    title: "Codebase quick-wins refactor",
    slug: "codebase-quick-wins",
    branch: "feat/codebase-quick-wins",
    port: 3002,
    tags: ["api", "fe", "GO"],
    mode: "implement",
    dbUrl: "sqlite:lanes/codebase-quick-wins/app.db",
  });

  updateLane(db, lane2.id, {
    stageIndex: 3,
    progress: 42,
    status: ["running"],
    ticket: "SC-137",
    gitCommit: "b3f21c4",
    gitSubject: "refactor: extract shared helpers",
    ci: "PR pending",
    note: "Implementing... gates next.",
  });

  insertEvent(db, lane2.id, "stage_enter", {
    stage: "gates",
    message: "Running lint + typecheck + unit tests",
  });
}
