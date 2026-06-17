# Feature Harness — Tài liệu setup & cách clone
*(Phân tích từ video TikTok @laptrinhviencuoicung — "Agent Harness")*

> ⚠️ **Quan trọng:** Video chỉ quay **phần frontend (dashboard)**. Phần backend — cách thật sự điều phối các AI agent — là code riêng của tác giả và **không hiện trong video**. Mục 1–6 dưới đây là những gì **đọc được trực tiếp** từ màn hình. Mục 7–8 là **kiến trúc hợp lý mình suy luận** để bạn dựng lại, không phải bản sao nguyên gốc.

---

## 1. Cấu trúc thư mục (thấy trong VS Code, frame ~30s)

```
CLINICAL/                       # workspace gốc (dự án clinical / SDTM)
├── cre/
├── edc_envs/
├── harness/          ★         # dashboard + orchestrator nằm ở đây
├── lane1/            ← worktree riêng → app chạy cổng :3001
├── lane2/            ← :3002
├── lane3/            ← :3003
├── lane4/            ← :3004
├── lane5/            ← :3005
├── Stack SDTM for East Agile/
├── stack-clinical/
├── Trial Procedure PDFs/
└── Stack Clinical Standalone.html
```

Trong video, lane1–3 hiển thị màu xanh (git modified) = đang được agent chỉnh sửa. Câu chốt của tác giả:
> *"…database riêng, … chạy trên cái port khác nhau nè, bạn thấy hông?"*
> *"cái dashboard của mình thì nó nằm ở cái folder này"* (folder `harness/`).

---

## 2. Mô hình một "lane"

Mỗi **lane** là một làn việc độc lập, song song:

| Thành phần | Vai trò |
|---|---|
| **git worktree / branch riêng** | `feat/chat-md-tables`, `feat/codebase-quick-wins`, `feat/investigation-panel`… |
| **app instance riêng** | chạy trên port riêng `:3001 … :3005` |
| **database riêng** | để các agent không đụng dữ liệu của nhau |
| **1 AI agent** | làm 1 task từ đầu đến cuối |
| **1 ticket** | `SC-136`, `SC-137`, `SC-138`, `SC-144`… (kiểu Jira) |

Đây là chìa khoá để chạy **nhiều agent cùng lúc** mà không xung đột: cô lập theo *worktree + port + DB*.

---

## 3. Pipeline (state machine) — thấy trên dashboard

```
intake → implement → gates → PR → integrate → e2e+QC → review
       → er gate → push-dev → dev/QC → watch PR → done
```

| Bước | Ý nghĩa |
|---|---|
| **intake** | Nhận task + tiêu chí ("predefined criteria") |
| **implement** | Agent viết code |
| **gates** | Cổng kiểm tra: lint / type / test / đối chiếu tiêu chí |
| **PR** | Tạo pull request |
| **integrate** | Merge vào nhánh tích hợp; conflict → *"re-merge conflicts → re-integrate"* |
| **e2e + QC** | Chạy e2e + QC, **chụp screenshot** (dãy thumbnail `qc-dev`, `qc-local`) |
| **review** | Review tự động + trả lời comment PR |
| **er gate** | Cổng release/error; có thể *"blocked — needs you"* (chờ người duyệt) |
| **push-dev** | Đẩy lên môi trường dev |
| **dev/QC** | QC trên dev |
| **watch PR** | Theo dõi PR chờ người merge → trạng thái `watching-pr` |
| **done** | Xong |

**Cơ chế tự sửa / vòng lặp** (chính là điều tác giả nhấn mạnh):
- `↻ re-enter stage` + `self-resolves & continues` → fail thì agent **tự sửa và quay lại bước trước** ("nó sẽ sửa và nó sẽ quay trở lại cái bước này").
- `fix on branch` → sửa trực tiếp trên nhánh.
- `blocked — needs you` → dừng, chờ con người (đây chính là con số **"need you"** trên header).
- `passed without evidence — check it` → qua nhưng thiếu bằng chứng (screenshot/log) → cần người kiểm.

**Màu trạng thái node:** done (xanh lá) · current (xanh dương) · passed-without-evidence (vàng) · pending (xám).
**Đường nét đứt:** đỏ = fail → gather + fix · xanh dương = re-entry.

---

## 4. Dữ liệu mỗi lane mà FE cần (JSON đề xuất)

```json
{
  "n": 1,
  "title": "Chat bubble tables: scroll + sticky header",
  "branch": "feat/chat-md-tables",
  "mode": "watching-pr",
  "stage": 10,                       // index trong pipeline (0..11)
  "progress": 94,
  "tags": ["api", "fe", "GO"],
  "status": ["STALLED", "RUNNING"],  // dùng để đếm header
  "updatedAt": "2025-06-17T03:00:00Z",
  "git": {
    "commit": "ae15a09",
    "subject": "Merge branch 'feat/chat-md-tables' into development",
    "ci": "PR green; dev green"
  },
  "links": { "pr": 106, "ticket": "SC-138", "port": 3001 },
  "note": "SHIPPED ✓ PR#106 green, dev green, SC-138, dev-QC PASS. Watching PR for feedback.",
  "qc": { "dev": 14, "local": 39 }
}
```

---

## 5. Header đếm số

```
5 lanes · 5 running · 1 need you · 3 stalled · [+ Add lane]
```
Chỉ là **đếm theo `status`** của tất cả lane (running / need-you / stalled).

---

## 6. FE hoạt động thế nào (xem file `feature-harness-clone.html` kèm theo)

- Trang tĩnh, **poll API mỗi ~4s** (live watch) → vẽ lại toàn bộ.
- 3 khối: **header counters** → **panel pipeline (SVG)** của lane đang chọn → **grid các card**.
- **Click 1 card** = chọn lane đó để xem pipeline ở trên ("click a card to map another lane").
- Mỗi card có **6 nút**: `up` (chạy) · `down` (dừng) · `clear` · `agents` (mở cấu hình agent) · `creds` (credentials) · `reset` (reset lane).
- Card còn có: progress bar, chip `watching-pr`, tag `api/fe/GO`, thời gian, **log git** (commit + CI), link `#PR / ticket / :port`, và 1 ô **note** trạng thái.
- Phần dưới panel: **branch selector** + `task report`, và 2 dãy **QC thumbnail** (`qc-dev`, `qc-local`) — ảnh chụp QC tự động.

File clone đã tách sẵn `const LANES = [...]` ở đầu `<script>` → bạn chỉ việc thay bằng `fetch('/api/lanes')` (đã để sẵn đoạn `poll()` mẫu ở cuối file).

---

## 7. Backend cần gì để chạy thật (gợi ý kiến trúc để clone)

Một **orchestrator** (Node / Go / Python) quản lý N lane:

1. **Tạo lane:** `git worktree add ../laneN feat/<task>` cho mỗi task.
2. **Khởi động app cô lập:** mỗi lane 1 port + 1 DB
   `PORT=3001 DATABASE_URL=postgres://…/lane1 npm run dev` (hoặc docker-compose theo profile/port).
3. **Spawn agent:** gọi CLI agent (ví dụ Claude Code / Cursor / aider) trong thư mục worktree, truyền **task + predefined criteria**.
4. **Chạy state machine:** mỗi *stage* (mục 3) là một job; lưu trạng thái vào file JSON hoặc DB. Khi job fail → áp luật `re-enter` / `fix on branch` / `blocked`.
5. **Đọc trạng thái git/CI:** `gh pr view <n> --json …`, `gh run list` → cập nhật field `ci` ("PR green; dev green").
6. **Chụp QC:** dùng Playwright chụp các màn hình chính → lưu `qc-dev/*.png`, `qc-local/*.png` → đếm số lượng hiển thị lên thumbnail.
7. **Expose API:** `GET /api/lanes` trả mảng JSON như **mục 4** → FE poll và vẽ.

Sơ đồ gọn:
```
orchestrator ──┬─ lane1 (worktree + agent + app:3001 + db1) ─┐
               ├─ lane2 (… :3002 …)                          │ thu trạng thái
               ├─ lane3 (… :3003 …)                          ├──────────────► GET /api/lanes ──► Dashboard (FE)
               ├─ lane4 (… :3004 …)                          │                                   (poll 4s, live watch)
               └─ lane5 (… :3005 …) ─────────────────────────┘
```

---

## 8. Stack đoán được từ video (không chắc 100%)

- **Lĩnh vực:** clinical / **SDTM** (Study Data Tabulation Model — chuẩn dữ liệu thử nghiệm lâm sàng). Thấy "Stack SDTM for East Agile", "stack-clinical".
- **Browser:** có nút "Ask Gemini" → Chrome (hoặc trình duyệt AI như Comet).
- **Tag `api / fe / GO`** → có thể backend Go + frontend tách riêng.
- **Ticket dạng `SC-xxx`** → tracker kiểu Jira.
- **Dashboard** chạy local `127.0.0.1:8090` (và một cổng :8080).

---

## Tóm tắt 1 dòng
Mỗi task chạy trong **một worktree + port + DB riêng**, có **một AI agent** đưa nó qua một **pipeline 12 bước có vòng tự sửa**; **dashboard `harness/` chỉ đọc trạng thái và vẽ live** — và đó là toàn bộ thứ bạn thấy trong video.
