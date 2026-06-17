# BUILD BRIEF — "Feature Harness" (dán nguyên file này vào Claude Code)

> **Cách dùng (cho bạn — người chủ repo):** mở Claude Code tại thư mục gốc dự án, đính kèm 3 file:
> `claude-code-build-brief.md` (file này), `feature-harness-spec.md` (spec chi tiết), `feature-workflow.SKILL.md` (workflow skill).
> Rồi nói: *"Đọc build brief và spec, xác nhận kế hoạch, sau đó build theo từng PHASE. Sau mỗi phase chạy test và cho tôi xem một lát cắt chạy được trước khi đi tiếp."*

---

## 1. NHIỆM VỤ (gửi Claude Code)

Bạn sẽ build một hệ thống local tên **Feature Harness**: chạy **nhiều agent (chính là Claude Code) song song**, mỗi agent làm **một task riêng** trong **một bản copy hoàn chỉnh, cô lập của repo**, được đưa qua **một workflow chuẩn hoá (đóng thành Skill)**, và có **một dashboard live** để theo dõi + điều khiển.

Triết lý: **90% giá trị nằm ở workflow (skill), 10% là harness (công cụ cô lập + giám sát)**. Đừng over-engineer phần harness; tập trung làm workflow chắc.

---

## 2. NGUYÊN TẮC LÀM VIỆC (gửi Claude Code — bắt buộc)

1. **Làm theo phase** ở §8. Sau mỗi phase: chạy test, demo một lát cắt chạy được, dừng lại hỏi tôi trước khi sang phase sau.
2. **Không auto-merge vào `main`.** Luôn dừng ở bước "watch PR" chờ người.
3. **Hỏi trước mọi thao tác phá huỷ** (xoá DB, xoá container, force push).
4. Ưu tiên **một lát cắt dọc chạy được sớm** (1 lane chạy hết flow với dữ liệu thật) hơn là làm đầy đủ mọi tính năng.
5. Khi brief này **mâu thuẫn với** `feature-harness-spec.md`, **brief này thắng** (đặc biệt phần §4 cô lập lane).
6. Viết test cho **luật state machine** trước khi nối agent thật.
7. Mọi chuyển trạng thái phải **persist trước** rồi mới tiếp (resume được sau crash).

---

## 3. KIẾN TRÚC ĐÃ HIỆU CHỈNH (đọc kỹ — khác giả định ngây thơ)

Những điểm dưới đây lấy từ chính lời tác giả, **ghi đè** mọi mô tả "worktree" trong spec:

1. **Mỗi lane = MỘT BẢN COPY HOÀN CHỈNH của repo** (clone độc lập), **KHÔNG dùng `git worktree`** — vì worktree không cho chạy song song thật. Mỗi lane có:
   - **server riêng**, **database riêng**, **port riêng**, chạy trong **Docker**.
2. **Docker tốn RAM** → cần một **global resource lock (mutex)**: tại một thời điểm **chỉ một lane được chạy bước nặng** (e2e / manual-test trong Docker). Các bước nhẹ vẫn chạy song song. Cơ chế: hàng đợi + lock cho stage nặng.
3. **Agent trong mỗi lane CHÍNH LÀ Claude Code** chạy headless. Harness chỉ **ráp xung quanh Claude Code** (spawn, cấp task, đọc output). Thiết kế **adapter** để có thể thay agent khác, nhưng mặc định = Claude Code CLI.
4. **Toàn bộ workflow là một Skill** (`feature-workflow.SKILL.md`). Agent mỗi lane **chạy skill này**. Có thêm **một skill thứ hai: PR Review Loop** (§7).
5. **Dashboard** đặt trong folder `harness/`, chỉ **đọc trạng thái** và vẽ live (đã có bản FE mẫu — dùng làm điểm khởi đầu).

Sơ đồ cô lập:
```
repo gốc ──clone──> lanes/lane1/ (full copy)  docker: server+db, port 3001  ← Claude Code agent #1
          ──clone──> lanes/lane2/ (full copy)  docker: server+db, port 3002  ← agent #2
          ...
   [GLOBAL LOCK] ─── chỉ 1 lane chạy stage nặng (e2e/manual-test) tại một thời điểm
```

---

## 4. THÀNH PHẦN CẦN BUILD (chi tiết xem `feature-harness-spec.md`)

- **orchestrator**: lane-manager (clone repo, docker up/down, cấp port+db), scheduler + **global lock**, state-machine runner, **agent adapter (Claude Code headless)**, git/CI poller, QC capturer, persistence (SQLite).
- **api** (Fastify): `GET /api/lanes`, `GET /api/lanes/:id`, các action `up/down/clear/agents/creds/reset`, `POST /api/lanes`. Hợp đồng JSON đúng như spec §11.2.
- **web** (React+Vite): header counters · pipeline SVG · lane cards (đã có bản vanilla mẫu để port sang).
- **skills**: `feature-workflow` (workflow chính) + `pr-review-loop`.

---

## 5. CÁCH TẠO & CHẠY MỘT LANE (contract cụ thể)

```bash
# 1) Tạo bản copy hoàn chỉnh (KHÔNG worktree)
git clone --no-hardlinks <repo> lanes/lane1
git -C lanes/lane1 checkout -b feat/<slug> development

# 2) Cấp port + db riêng, chạy bằng docker
#    orchestrator render docker-compose.lane.yml với PORT/DATABASE_URL riêng
PORT=3001 DATABASE_URL=<per-lane> docker compose -f lanes/lane1/docker-compose.lane.yml up -d

# 3) Health-check
curl -fsS http://localhost:3001/health

# 4) Spawn agent = Claude Code headless trong thư mục lane, chạy skill workflow
#    (adapter pattern: AGENT_CMD đọc từ env; mặc định 'claude')
(cd lanes/lane1 && $AGENT_CMD -p "$(cat .harness/task-prompt.md)" --skill feature-workflow ... )
```

**Global lock cho stage nặng** (e2e / manual-test trong Docker):
```ts
// chỉ 1 lane được vào vùng nặng cùng lúc → kiểm soát RAM
await heavyLock.acquire(laneId);
try { await runE2EInDocker(lane); } finally { heavyLock.release(laneId); }
```

---

## 6. WORKFLOW (cái 90%) — chạy bằng skill

Agent mỗi lane chạy `feature-workflow.SKILL.md`. Tóm tắt flow (chi tiết trong file skill):

```
research & re-plan (blend + agent-debate review loop)
 → implement
 → gates (lint/type/unit + đối chiếu criteria)
 → multi-level review (logic review + flow review: user-flow & data-flow; + full text-based review)
 → create PR
 → integrate (merge development; conflict → re-merge → re-integrate)
 → manual test + screenshots (local)        [evidence ~39 ảnh → qc-local]
 → push to staging
 → QC manual test + screenshots (staging)    [evidence ~14 ảnh → qc-dev]
 → watch PR (poll comment PR / conflict base branch → sửa → quay lại vòng)
```
Luật: stage chỉ `done` khi **có evidence** (test report / ảnh QC); thiếu → `passed_no_evidence` (vàng, "check it"). Fail → self-heal/re-enter; quá `MAX_ATTEMPTS` → `blocked` (needs-you).

---

## 7. SKILL THỨ HAI — PR Review Loop (`pr-review-loop`)

- Một skill chạy **polling liên tục**: liệt kê **tất cả PR đang mở** (kể cả PR của chính mình), review từng cái.
- Với mỗi PR: kiểm tra CI, đọc diff, để lại review/comment; nếu là PR do harness tạo và có comment/blocking → kích hoạt lane tương ứng quay lại sửa.
- Đây là một **lane đặc biệt** (mode `review-loop`) trên dashboard.

---

## 8. LỘ TRÌNH BUILD (PHASE + CHECKPOINT) — gửi Claude Code

> Sau **mỗi** phase: chạy test, demo lát cắt chạy được, **dừng hỏi tôi**.

**PHASE 0 — Khung & data** (DB SQLite, types, `GET /api/lanes` đọc DB, seed 1 lane giả).
✅ *Done when:* FE mẫu hiển thị 1 lane đọc từ API thật.

**PHASE 1 — Lane isolation (FULL COPY + Docker)**
clone repo → render `docker-compose.lane.yml` (port+db riêng) → up → health-check; API `POST /api/lanes`, `/up`, `/down`.
✅ *Done when:* tạo 1 lane từ `lanes.yaml`, app chạy `:3001` trong Docker, `/down` gỡ sạch container.

**PHASE 2 — State machine + global lock** (runner, scheduler concurrency, **heavy-lock**, stage handlers stub, luật advance/re-enter/blocked/passed_no_evidence, persist+resume).
✅ *Done when:* 1 lane stub tự chạy hết flow, FE đổi màu node realtime, chỉ 1 lane vào vùng "nặng" cùng lúc, kill orchestrator → resume đúng stage.

**PHASE 3 — Agent adapter = Claude Code headless** (render task-prompt, gọi `claude` headless với skill, stream log, parse output contract). Nối vào `implement` + sửa lỗi ở `gates`.
✅ *Done when:* 1 task thật được Claude Code code → build pass → qua `gates`.

**PHASE 4 — Git/CI + PR + integrate** (`gh pr create`, đọc checks, merge development, xử lý conflict loop).
✅ *Done when:* lane tự tạo PR, dashboard hiện `#PR` + "PR green".

**PHASE 5 — Manual test + screenshots + staging QC** (Playwright chụp ảnh local→`qc-local`, push staging, QC chụp→`qc-dev`; evidence bắt buộc cho stage QC).
✅ *Done when:* stage QC chỉ `done` khi có ảnh; thiếu → node vàng.

**PHASE 6 — Watch PR loop + PR Review Loop skill + human-in-loop** (stage `watch PR` poll comment/conflict → quay vòng; lane `review-loop`; counters header; nút reset/clear/agents/creds).
✅ *Done when:* lane dừng đúng ở watch PR, PR review loop review được PR mở, "need you" đếm đúng.

**PHASE 7 — FE hoàn chỉnh** (port bản mẫu sang React+Vite, tooltip pipeline, empty/error state, responsive; *stretch* SSE).
✅ *Done when:* 5 lane chạy song song end-to-end, dashboard mượt, trễ ≤5s.

---

## 9. ĐỊNH NGHĨA "XONG" TỔNG
- Khởi tạo ≥3 lane từ `lanes.yaml` bằng 1 lệnh; mỗi lane là **full copy + Docker + port/db riêng**.
- 1 task happy-path tự chạy tới `watch PR` không cần can thiệp; evidence (ảnh QC) được tạo.
- Global lock đảm bảo chỉ 1 lane chạy bước nặng tại một thời điểm.
- Dashboard live phản ánh đúng, trễ ≤5s; các nút action hoạt động.
- Crash giữa chừng → resume đúng.

---

## 10. GHI CHÚ
- Agent = **Claude Code** (sản phẩm chính thức, gọi qua CLI headless). Không cần và không dùng bất kỳ "bản leak" nào — chỉ wrap CLI hợp lệ; muốn đổi agent thì viết adapter mới.
- File `feature-harness-spec.md` đi kèm chứa data model, DDL, API contract, FE component tree, bảng state machine — dùng làm tham chiếu sâu. **Chỗ nào nói "worktree" thì thay bằng "full copy + Docker" theo brief này.**
- Có thể tinh chỉnh brief khi có thêm transcript/video khác về harness & workflow.
