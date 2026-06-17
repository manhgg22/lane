# Feature Harness — Spec kỹ thuật & Kế hoạch triển khai

Phiên bản: 1.0 · Mục tiêu: dựng lại hệ thống điều phối **nhiều AI agent chạy song song qua một pipeline phát triển phần mềm**, kèm dashboard "live watch" (lấy cảm hứng từ video tham khảo).

---

## 0. Cách đọc tài liệu & giả định nền

**Giả định mặc định** (đổi được, mỗi chỗ có ghi cách thay):
- Ngôn ngữ: **TypeScript** cho cả orchestrator, API và FE (một ngôn ngữ, ít ma sát).
- Runtime: **Node 20+**. Quản lý tiến trình con bằng `execa`.
- Lưu trạng thái: **SQLite** (`better-sqlite3`) — file-based, hợp với "live watch". *(Đổi sang Postgres nếu cần nhiều máy.)*
- Cô lập lane: **git worktree + 1 port + 1 DB** cho mỗi lane.
- Agent: **adapter pluggable**, mặc định gọi một **CLI agent headless** (Claude Code / Cursor CLI / aider…). Hệ không phụ thuộc agent cụ thể.
- CI/Git: **`git` + `gh` CLI**.
- QC ảnh: **Playwright**.
- Quy mô: **local, single-user** ở v1. Multi-user là stretch.

**Ký hiệu nghiệm thu:** mỗi milestone có mục **✅ Done when** = điều kiện coi là xong.

---

## 1. Mục tiêu / Phi mục tiêu / Tiêu chí thành công

### 1.1 Mục tiêu
1. Chạy **N task song song**, mỗi task trong môi trường cô lập, không đụng nhau.
2. Mỗi task được một agent đưa qua **pipeline chuẩn hoá** (intake → … → done) với **tự sửa lỗi** và **dừng chờ người** khi cần.
3. **Dashboard live** hiển thị trạng thái mọi lane: tiến độ, bước hiện tại, git/CI, QC, và cho thao tác (start/stop/reset…).
4. Mọi trạng thái **bền vững** (restart orchestrator không mất tiến độ).

### 1.2 Phi mục tiêu (v1)
- Không làm multi-tenant/đa người dùng có phân quyền.
- Không tự host model; chỉ gọi agent CLI/API có sẵn.
- Không auto-merge vào main (luôn cần người duyệt ở `watch PR`).

### 1.3 Tiêu chí thành công (đo được)
- Khởi tạo 5 lane từ 5 task chỉ bằng **1 lệnh / 1 file config**.
- Một task "happy path" tự chạy hết pipeline tới `watch PR` **không cần can thiệp**.
- Dashboard phản ánh trạng thái thật **trễ ≤ 5s**.
- Kill orchestrator giữa chừng rồi bật lại → các lane **resume đúng bước**.

---

## 2. Thuật ngữ (glossary)

| Thuật ngữ | Nghĩa |
|---|---|
| **Lane** | Một làn việc độc lập = 1 task + 1 worktree + 1 port + 1 DB + 1 agent. |
| **Harness / Orchestrator** | Tiến trình trung tâm tạo & điều phối các lane, chạy state machine, gom trạng thái. |
| **Stage** | Một bước trong pipeline (intake, implement, …). |
| **Gate** | Cổng kiểm tra phải PASS mới qua bước sau (lint/type/test/criteria). |
| **Worktree** | Một bản checkout git riêng cho một branch (`git worktree`). |
| **Evidence** | Bằng chứng một stage thật sự pass (log, ảnh QC, kết quả test). |
| **Self-heal / re-enter** | Cơ chế agent tự sửa lỗi rồi quay lại stage trước. |
| **Needs-you / blocked** | Lane dừng chờ con người (duyệt/merge/quyết định). |

---

## 3. Kiến trúc tổng thể

```
                         ┌───────────────────────────────────────┐
                         │            ORCHESTRATOR (Node)          │
                         │  - lane manager (tạo/destroy worktree)  │
                         │  - port allocator                       │
                         │  - state machine runner (per lane)      │
                         │  - agent adapter                        │
                         │  - git/CI poller   - QC capturer        │
                         │  - persistence (SQLite)                 │
                         └───────────────┬───────────────────────-─┘
                                         │ supervises
        ┌──────────────┬──────────────┬─┴────────────┬──────────────┐
     ┌──▼──┐        ┌──▼──┐        ┌──▼──┐        ┌──▼──┐        ┌──▼──┐
     │lane1│        │lane2│        │lane3│        │lane4│        │lane5│
     │wt+   │        │     │        │     │        │     │        │     │
     │:3001 │        │:3002│        │:3003│        │:3004│        │:3005│
     │db1   │        │db2  │        │db3  │        │db4  │        │db5  │
     │agent │        │agent│        │agent│        │agent│        │agent│
     └──────┘        └─────┘        └─────┘        └─────┘        └─────┘
                                         │ reads state
                         ┌───────────────▼───────────────┐
                         │        API (Fastify)           │  GET /api/lanes, POST /api/lanes/:id/:action …
                         └───────────────┬───────────────┘
                                         │ poll 3–4s (hoặc SSE)
                         ┌───────────────▼───────────────┐
                         │     DASHBOARD (React/Vite)     │  header counters · pipeline SVG · lane cards
                         └────────────────────────────────┘
```

**Tách process:** Orchestrator và API **có thể chung 1 process** (đơn giản, v1) hoặc tách (API chỉ đọc SQLite). Khuyến nghị v1: **chung 1 Node process**, API đọc cùng SQLite mà runner ghi.

---

## 4. Mô hình cô lập lane

### 4.1 Worktree
- Mỗi lane = 1 branch `feat/<slug>` checkout qua `git worktree add lanes/laneN feat/<slug>`.
- Thư mục worktree độc lập → agent sửa file không đụng lane khác.

### 4.2 Cấp phát port
- Dải port cố định, ví dụ `BASE_PORT=3001`, lane k dùng `BASE_PORT + (k-1)`.
- Port allocator giữ map `laneId → port`, kiểm tra port trống trước khi spawn (tránh đụng).

### 4.3 Database riêng
- Mặc định mỗi lane 1 file SQLite `lanes/laneN/app.db`, hoặc 1 schema/DB Postgres `lane_N`.
- Truyền qua env khi spawn app: `DATABASE_URL`.

### 4.4 Biến môi trường truyền vào app mỗi lane
```
PORT=<3001..>
DATABASE_URL=<per-lane>
LANE_ID=<n>
NODE_ENV=development
```

> **Đổi cô lập mạnh hơn:** dùng docker-compose, mỗi lane 1 service với `PORT`/`DATABASE_URL` riêng (xem §13.3).

---

## 5. Data model

### 5.1 Thực thể chính

**Lane**
```ts
type LaneStatus = "running" | "stalled" | "needs_you";
type StageState = "pending" | "current" | "done" | "passed_no_evidence";

interface Lane {
  id: number;
  title: string;                 // mô tả task
  slug: string;                  // dùng cho branch/worktree
  branch: string;                // feat/<slug>
  mode: "watching-pr" | "review-loop" | "implement";
  port: number;
  dbUrl: string;
  tags: string[];                // ["api","fe","GO"]
  status: LaneStatus[];          // có thể nhiều (RUNNING + STALLED)
  stageIndex: number;            // 0..N-1 (bước hiện tại)
  progress: number;              // 0..100
  ticket: string | null;         // "SC-138"
  prNumber: number | null;       // 106
  git: { commit: string; subject: string; ci: string };
  note: string;                  // dòng trạng thái mới nhất
  qc: { dev: number; local: number };
  updatedAt: string;             // ISO
  createdAt: string;
}
```

**StageRun** (lịch sử mỗi lần chạy 1 stage của 1 lane)
```ts
interface StageRun {
  id: number;
  laneId: number;
  stage: string;                 // "implement"
  state: StageState;
  attempt: number;               // số lần thử (self-heal tăng dần)
  evidence: string[];            // đường dẫn log/ảnh/test report
  startedAt: string;
  endedAt: string | null;
  result: "pass" | "fail" | "blocked" | null;
  message: string;
}
```

**Event** (audit log để FE và debug)
```ts
interface Event {
  id: number; laneId: number; ts: string;
  type: "stage_enter" | "stage_pass" | "stage_fail" | "re_enter" | "blocked" | "action";
  payload: Record<string, unknown>;
}
```

### 5.2 Schema SQLite (DDL)
```sql
CREATE TABLE lanes (
  id INTEGER PRIMARY KEY, title TEXT, slug TEXT UNIQUE, branch TEXT,
  mode TEXT, port INTEGER, db_url TEXT, tags TEXT, status TEXT,
  stage_index INTEGER, progress INTEGER, ticket TEXT, pr_number INTEGER,
  git_commit TEXT, git_subject TEXT, ci TEXT, note TEXT,
  qc_dev INTEGER, qc_local INTEGER, created_at TEXT, updated_at TEXT
);
CREATE TABLE stage_runs (
  id INTEGER PRIMARY KEY, lane_id INTEGER, stage TEXT, state TEXT,
  attempt INTEGER, evidence TEXT, started_at TEXT, ended_at TEXT,
  result TEXT, message TEXT
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY, lane_id INTEGER, ts TEXT, type TEXT, payload TEXT
);
```
*(tags/status/evidence/payload lưu dạng JSON string.)*

---

## 6. Pipeline state machine (trái tim hệ thống)

### 6.1 Danh sách stage
```
0 intake → 1 implement → 2 gates → 3 PR → 4 integrate → 5 e2e+QC
→ 6 review → 7 er gate → 8 push-dev → 9 dev/QC → 10 watch PR → 11 done
```

### 6.2 Định nghĩa & gate mỗi stage

| # | Stage | Việc làm | Điều kiện PASS (gate) | Nếu FAIL |
|---|---|---|---|---|
| 0 | intake | Đọc task + tiêu chí, tạo worktree/branch/DB, bật app | App lên, criteria parse được | abort + báo lỗi |
| 1 | implement | Agent code theo criteria | Build ok, không lỗi cú pháp | re-enter(1), tăng attempt |
| 2 | gates | lint + typecheck + unit test + đối chiếu criteria | tất cả PASS | re-enter(1) (quay lại sửa code) |
| 3 | PR | Tạo PR (`gh pr create`) | PR tạo được | re-enter(2) |
| 4 | integrate | Merge nhánh tích hợp | merge sạch | nếu conflict → `re-merge → re-integrate` (lặp lại 4) |
| 5 | e2e+QC | Playwright e2e + chụp ảnh QC | e2e xanh + có **evidence** (ảnh/log) | re-enter(1) hoặc `fix_on_branch` |
| 6 | review | Auto-review + trả lời comment | không còn comment blocking | re-enter theo loại comment |
| 7 | er gate | Cổng release/error; cần người duyệt | người approve | `blocked → needs_you` |
| 8 | push-dev | Đẩy lên môi trường dev | deploy ok | re-enter(8) hoặc fix_on_branch |
| 9 | dev/QC | QC trên dev | dev QC PASS | fix_on_branch → quay lại stage phù hợp |
| 10 | watch PR | Theo dõi PR chờ người merge | người merge | giữ trạng thái `watching-pr` (không tự qua) |
| 11 | done | Dọn dẹp worktree (tuỳ chọn) | — | — |

### 6.3 Luật chuyển trạng thái (transition rules)
- **PASS** ở stage i (kèm evidence hợp lệ) → stage i+1, ghi `stage_pass`.
- **PASS nhưng thiếu evidence** → state `passed_no_evidence` (vàng), **không tự qua**, gắn cờ "check it".
- **FAIL** → áp `recovery` của stage (re-enter index nào): tăng `attempt`, ghi `re_enter`.
- **attempt > MAX_ATTEMPTS** (vd 3) → chuyển `blocked` (needs_you), dừng auto.
- **conflict ở integrate** → loop nội bộ stage 4 tới khi sạch hoặc `blocked`.
- **er gate / watch PR** → luôn `needs_you` cho tới khi có hành động người (approve/merge).

### 6.4 Self-heal & fix-on-branch
- `self_resolve(stage)`: agent nhận log lỗi + diff, sửa, rồi **re-enter** stage chỉ định.
- `fix_on_branch`: tạo commit sửa nhanh trên chính branch rồi quay lại stage QC tương ứng.
- Mỗi self-heal **đều ghi Event** để dashboard hiển thị "↻ self-resolves & continues".

### 6.5 Trạng thái lane (cho header counters)
- `running`: state machine đang chạy stage.
- `stalled`: dừng tạm (vd `watching-pr` lâu, hoặc attempt cao chưa blocked).
- `needs_you`: cần người (er gate / merge / quá attempt).

> **Định nghĩa "evidence" rõ ràng là điểm khác biệt quan trọng:** một stage chỉ thực sự `done` khi có artifact chứng minh (test report path, ảnh QC). Nếu không → `passed_no_evidence`. Điều này chặn agent "báo xanh" giả.

---

## 7. Orchestrator spec

### 7.1 Trách nhiệm
1. **Lane manager:** tạo/destroy worktree, DB, app process.
2. **Port allocator.**
3. **Runner:** với mỗi lane chạy state machine (1 "tick loop"/lane hoặc 1 scheduler chung).
4. **Agent adapter:** gọi agent cho các stage cần (implement/gates-fix/review).
5. **Git/CI poller:** cập nhật `git`, `ci`, `prNumber`.
6. **QC capturer:** chạy Playwright, đếm ảnh.
7. **Persistence:** ghi mọi thay đổi vào SQLite.

### 7.2 Vòng lặp chính (pseudo)
```ts
async function tick(lane: Lane) {
  const stage = STAGES[lane.stageIndex];
  const run = await runStage(lane, stage);          // gọi handler theo stage
  if (run.result === "pass" && hasEvidence(run))    advance(lane);
  else if (run.result === "pass")                   markPassedNoEvidence(lane);
  else if (run.result === "blocked")                setNeedsYou(lane);
  else /* fail */                                    applyRecovery(lane, stage, run);
  await persist(lane);
  emit(lane);                                        // cho FE
}
// scheduler: chạy tick cho từng lane, có concurrency limit (vd 5 lane song song)
```

### 7.3 Giám sát tiến trình app
- App mỗi lane chạy nền (`execa('npm',['run','dev'],{cwd, env})`), lưu `pid`.
- Health-check port (`GET :PORT/health`) trước khi vào QC.
- Tự restart nếu chết bất ngờ (giới hạn số lần).

### 7.4 Concurrency & tài nguyên
- `MAX_PARALLEL_LANES` (vd 5) để không quá tải máy + quota agent.
- Hàng đợi: lane mới `pending` cho tới khi có slot.

---

## 8. Agent adapter spec (pluggable)

### 8.1 Interface
```ts
interface AgentAdapter {
  name: string;
  // chạy 1 nhiệm vụ trong worktree, trả về kết quả + đường dẫn log
  run(input: AgentInput): Promise<AgentResult>;
}
interface AgentInput {
  cwd: string;                 // thư mục worktree của lane
  goal: string;                // mục tiêu stage (implement/fix/review)
  criteria: string[];          // tiêu chí pass
  context: string;             // log lỗi, diff, comment PR…
  timeoutSec: number;
}
interface AgentResult {
  ok: boolean;
  summary: string;             // tóm tắt agent làm gì
  changedFiles: string[];
  logPath: string;             // evidence
}
```

### 8.2 Adapter mặc định: CLI agent headless
- Ghi prompt ra file `.harness/prompt.md` (goal + criteria + context).
- Gọi CLI agent ở chế độ non-interactive trong `cwd`, stream log ra `.harness/logs/<stage>-<attempt>.log`.
- Parse exit code + log để suy ra `ok`.
- *(Có thể thay bằng adapter gọi thẳng API model nếu muốn kiểm soát hơn.)*

### 8.3 Hợp đồng đầu ra (output contract)
- Yêu cầu agent kết thúc bằng một dòng JSON máy đọc được, ví dụ:
  `<<HARNESS_RESULT>>{"ok":true,"summary":"...","changedFiles":[...]}<<END>>`
- Orchestrator parse khối này; không thấy → coi như fail (an toàn).

---

## 9. Git & CI integration

### 9.1 Branch strategy
```
main ──────────────────────────────────
 └─ development ───────────────  (nhánh tích hợp)
      ├─ feat/chat-md-tables   (lane1)
      ├─ feat/codebase-quick-wins (lane2)
      └─ feat/...
```

### 9.2 Lệnh chính
- Tạo lane: `git worktree add lanes/laneN -b feat/<slug> development`
- PR: `gh pr create --base development --head feat/<slug> --title ... --body ...`
- Trạng thái CI: `gh pr checks <n> --json` / `gh run list --branch feat/<slug>`
- Đọc commit: `git -C lanes/laneN log -1 --pretty=%h|%s`
- Dọn: `git worktree remove lanes/laneN` (khi done).

### 9.3 Map về field FE
- `ci` ví dụ `"PR green; dev green"` tổng hợp từ check PR + check development.

---

## 10. QC capture spec (Playwright)

- Sau e2e/dev-QC, chạy script chụp các màn hình chính của app lane (`http://localhost:PORT/...`).
- Lưu vào `lanes/laneN/.harness/qc-dev/*.png` và `.../qc-local/*.png`.
- Đếm số file → `qc.dev`, `qc.local` cho thumbnail.
- Ảnh chính là **evidence** cho stage QC.

---

## 11. API spec

> REST + JSON. v1 dùng **polling**; SSE là nâng cấp.

### 11.1 Endpoints
| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/lanes` | Danh sách tất cả lane (cho dashboard) |
| GET | `/api/lanes/:id` | Chi tiết 1 lane + stage_runs gần đây |
| GET | `/api/lanes/:id/events?after=` | Event log (audit/timeline) |
| POST | `/api/lanes` | Tạo lane mới `{title, slug, criteria, tags}` |
| POST | `/api/lanes/:id/up` | Start/resume lane |
| POST | `/api/lanes/:id/down` | Dừng lane (kill app + pause runner) |
| POST | `/api/lanes/:id/clear` | Xoá log/QC tạm |
| POST | `/api/lanes/:id/agents` | Lấy/đặt cấu hình agent của lane |
| POST | `/api/lanes/:id/creds` | Lấy/đặt credentials (env) |
| POST | `/api/lanes/:id/reset` | Reset về stage 0 (giữ branch) |
| GET | `/api/health` | health-check |
| GET | `/api/events/stream` | *(stretch)* SSE realtime |

### 11.2 Hợp đồng `GET /api/lanes` (đúng cái FE đang dùng)
```json
[
  {
    "id": 1, "title": "Chat bubble tables: scroll + sticky header",
    "branch": "feat/chat-md-tables", "mode": "watching-pr",
    "stageIndex": 10, "progress": 94, "tags": ["api","fe","GO"],
    "status": ["STALLED","RUNNING"],
    "git": { "commit": "ae15a09", "subject": "Merge branch 'feat/chat-md-tables' into development", "ci": "PR green; dev green" },
    "ticket": "SC-138", "prNumber": 106, "port": 3001,
    "note": "SHIPPED ✓ PR#106 green, dev green, SC-138, dev-QC PASS. Watching PR.",
    "qc": { "dev": 14, "local": 39 }, "updatedAt": "..."
  }
]
```

### 11.3 Các nút card → action
`up`→`POST /up` · `down`→`/down` · `clear`→`/clear` · `agents`→`/agents` · `creds`→`/creds` · `reset`→`/reset`. Trả `{ok:true, lane:<Lane>}`.

---

## 12. Frontend spec

> Khởi điểm: file `feature-harness-clone.html` (vanilla) đã có. Khuyến nghị nâng cấp **React + Vite + TypeScript**.

### 12.1 Component tree
```
<App>
 ├─ <Header counters />                 // 5 lanes · running · need you · stalled · + Add
 ├─ <LaneDetail lane={selected}>        // panel trên
 │    ├─ <PipelineGraph stageIndex tooltips />   // SVG 12 node + vòng feedback
 │    ├─ <Legend />
 │    ├─ <BranchSelector lanes onSelect />
 │    └─ <QcThumbnails dev local />
 └─ <LaneGrid lanes selected onSelect>
      └─ <LaneCard lane onAction>        // title, progress, tags, git log, links, note, 6 nút
```

### 12.2 State & data flow
- `useLanes()` hook: poll `GET /api/lanes` mỗi 3–4s → state `lanes`.
- `selectedId` (mặc định lane đầu) → quyết định `<LaneDetail>` vẽ pipeline nào.
- Action nút → `POST /api/lanes/:id/:action` → refetch ngay (optimistic update tuỳ chọn).
- *(Stretch: thay polling bằng SSE `/api/events/stream` để realtime + nhẹ.)*

### 12.3 Đặc tả `<PipelineGraph>`
- Input: `stageIndex`, danh sách stage, các flag (blocked, passedNoEvidence ở stage nào).
- Vẽ 12 node hàng ngang + mũi tên; node: `done`(xanh)/`current`(pink, pulse)/`pending`(xám)/`passed_no_evidence`(vàng).
- Vẽ feedback: blue dashed (re-enter), red dashed (fail/re-merge), node phụ `fix on branch`, `blocked — needs you`, `ticket`.
- Hover node → tooltip: stage, attempt, evidence, message.
- Responsive: scroll ngang trên mobile.

### 12.4 Đặc tả `<LaneCard>`
- Header: `LANE n` + badges status (STALLED/RUNNING/NEEDS YOU).
- Progress bar gradient + `%`.
- Tags (api/fe/GO) + thời gian cập nhật.
- Log git (commit + CI) + links `#PR / ticket / :port`.
- Ô note trạng thái (xanh / vàng nếu cần kiểm).
- 6 nút action gọi API.

### 12.5 Empty/error states
- Chưa có lane → khối "Add your first lane" + nút.
- API lỗi → banner "Can't reach orchestrator — retrying…" (không vỡ layout).

---

## 13. Config & file mẫu

### 13.1 `lanes.yaml` (khai báo task → tạo lane)
```yaml
maxParallel: 5
basePort: 3001
integrationBranch: development
agent: claude-code            # tên adapter
lanes:
  - title: "Chat bubble tables: scroll + sticky header"
    slug: chat-md-tables
    tags: [api, fe, GO]
    criteria:
      - "sticky header khi scroll danh sách"
      - "không vỡ layout mobile"
  - title: "Codebase quick-wins refactor"
    slug: codebase-quick-wins
    tags: [api, fe, GO]
    criteria: ["không đổi behavior", "test xanh"]
```

### 13.2 `.env`
```
DATABASE_DIR=./.harness/db
BASE_PORT=3001
MAX_PARALLEL_LANES=5
MAX_ATTEMPTS=3
GH_TOKEN=...
AGENT_CMD="claude"            # lệnh CLI agent
POLL_MS=4000
```

### 13.3 `docker-compose` per-lane (tuỳ chọn, cô lập mạnh)
```yaml
# sinh động: mỗi lane 1 service, orchestrator render file này từ template
services:
  lane1:
    build: ./lanes/lane1
    environment: [ "PORT=3001", "DATABASE_URL=postgres://db/lane1" ]
    ports: ["3001:3001"]
```

---

## 14. Cấu trúc repo đề xuất

```
feature-harness/
├── packages/
│   ├── orchestrator/        # state machine, lane manager, agent adapter, pollers
│   │   ├── src/
│   │   │   ├── runner.ts
│   │   │   ├── stages/      # 1 file / stage handler
│   │   │   ├── lane-manager.ts
│   │   │   ├── agent/       # adapters: claude-code.ts, api.ts
│   │   │   ├── git.ts  ci.ts  qc.ts
│   │   │   └── db.ts
│   │   └── package.json
│   ├── api/                 # Fastify (có thể import chung orchestrator)
│   └── web/                 # React + Vite dashboard
├── lanes/                   # worktrees sinh ra ở đây (gitignored)
├── .harness/                # db, logs, qc, prompts (gitignored)
├── lanes.yaml
└── README.md
```

---

## 15. Kế hoạch triển khai (milestones)

> Mỗi milestone độc lập demo được. Effort là ước lượng cho 1 dev (ngày người).

### M0 — Khung & data (≈1–2 ngày)
- Init monorepo (pnpm workspaces), TS config, SQLite `db.ts`, types (§5).
- Seed 1 lane giả, `GET /api/lanes` trả từ DB.
- ✅ **Done when:** mở FE thấy 1 lane đọc từ API thật.

### M1 — Lane isolation (≈2–3 ngày)
- `lane-manager`: tạo worktree + cấp port + tạo DB + spawn app (`execa`) + health-check.
- API `POST /api/lanes`, `/up`, `/down`.
- ✅ **Done when:** tạo lane từ `lanes.yaml` → app chạy ở `:3001`, `/down` kill sạch.

### M2 — State machine khung (≈3–4 ngày)
- `runner` + scheduler concurrency, `stages/` handlers stub, ghi `stage_runs` + `events`.
- Luật advance / re-enter / blocked / passed_no_evidence (§6.3).
- ✅ **Done when:** một lane "fake handlers" tự chạy intake→done, FE thấy node đổi màu theo thời gian thực, kill orchestrator → resume đúng stage.

### M3 — Agent adapter (≈3–5 ngày)
- Adapter CLI mặc định: render prompt, spawn, stream log, parse output contract.
- Nối vào stage `implement` & `gates-fix`.
- ✅ **Done when:** một task thật được agent code → build pass → qua `gates`.

### M4 — Git/CI + PR (≈2–3 ngày)
- `git.ts`/`ci.ts`: tạo PR, đọc checks, cập nhật `git`/`ci`/`prNumber`.
- Stage `PR`, `integrate` (xử lý conflict → loop).
- ✅ **Done when:** lane tự tạo PR, dashboard hiện `#PR` + "PR green".

### M5 — QC + evidence (≈2–3 ngày)
- `qc.ts` Playwright chụp ảnh, đếm → thumbnail; định nghĩa evidence cho QC stage.
- Stage `e2e+QC`, `dev/QC`; cờ `passed_no_evidence` hoạt động.
- ✅ **Done when:** stage QC chỉ `done` khi có ảnh; thiếu → node vàng "check it".

### M6 — Human-in-loop + watch PR (≈2 ngày)
- Stage `er gate` (needs_you), `push-dev`, `watch PR` (chờ merge), counters header đúng.
- Nút `reset`/`clear`/`agents`/`creds`.
- ✅ **Done when:** lane dừng đúng ở `er gate`/`watch PR`, "need you" đếm đúng, các nút hoạt động.

### M7 — FE hoàn chỉnh + polish (≈3 ngày)
- Chuyển FE sang React+Vite, tách component (§12), tooltip pipeline, empty/error states, responsive.
- *(Stretch)* SSE realtime.
- ✅ **Done when:** chạy 5 lane song song end-to-end, dashboard mượt, trễ ≤5s.

**Đường tới hạn:** M0 → M1 → M2 → M3 là core; M4–M6 là chiều sâu; M7 là trải nghiệm. Có thể demo "vertical slice" (1 lane chạy hết, dữ liệu thật) sớm nhất sau **M3**.

---

## 16. Chiến lược test
- **Unit:** luật transition state machine (bảng §6.3) — test thuần, không cần agent thật.
- **Integration:** lane-manager tạo/kill worktree+app trên port test.
- **Contract:** snapshot `GET /api/lanes` để FE không vỡ khi đổi shape.
- **E2E (smoke):** chạy 1 lane giả lập agent (stub) suốt pipeline, assert trạng thái cuối.
- **Manual:** kill orchestrator giữa chừng → resume.

---

## 17. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Agent "báo xanh giả" | Bắt buộc **evidence**; thiếu → `passed_no_evidence`, không tự qua. |
| Vòng lặp self-heal vô tận | `MAX_ATTEMPTS` → `blocked`. |
| Cạn tài nguyên/quota khi chạy nhiều lane | `MAX_PARALLEL_LANES` + hàng đợi. |
| Conflict merge liên tục | Loop `integrate` có giới hạn → blocked. |
| Port/DB đụng nhau | Port allocator kiểm tra trống; DB tách theo lane. |
| Mất tiến độ khi crash | Mọi chuyển trạng thái **persist** trước khi tiếp. |
| Lệnh agent treo | `timeoutSec` cho mỗi run. |
| Lộ credentials | `creds` lưu env riêng lane, không log; gitignore `.harness/`. |

---

## 18. Stretch (sau v1)
- SSE/WebSocket realtime thay polling.
- Multi-user + auth + phân quyền lane.
- "Add lane" ngay trên dashboard (form) + chọn agent.
- Bảng timeline event đẹp cho mỗi lane.
- Metrics (thời gian mỗi stage, tỉ lệ self-heal).
- Chạy lane bằng docker để cô lập tuyệt đối.

---

## Phụ lục A — Một vòng đời lane (happy path)
1. Đọc `lanes.yaml` → tạo lane1: worktree `feat/chat-md-tables`, port 3001, db1, app lên.
2. **intake** pass → **implement**: agent code → build ok.
3. **gates**: lint/type/test + criteria PASS (evidence: test report) → **PR** (`gh pr create` → #106).
4. **integrate**: merge development sạch → **e2e+QC**: Playwright xanh + ảnh QC → **review**: hết comment blocking.
5. **er gate**: chờ người approve (needs_you) → người duyệt → **push-dev** → **dev/QC** PASS.
6. **watch PR**: trạng thái `watching-pr`, chờ người merge. Dashboard: card "SHIPPED ✓ … Watching PR".
7. Người merge → **done** → (tuỳ chọn) dọn worktree.

## Phụ lục B — Một vòng đời có self-heal
- **gates** FAIL (test đỏ) → ghi `stage_fail`, `re_enter(1)`, attempt=2 → agent đọc log lỗi, sửa → **gates** lại PASS → tiếp tục. Dashboard hiện "↻ self-resolves & continues".
- Nếu attempt > 3 vẫn fail → `blocked` → header "need you" +1, lane chờ người.
