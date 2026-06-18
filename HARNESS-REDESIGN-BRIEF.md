# HARNESS REDESIGN BRIEF — chuyển sang "harness mỏng / skill dày" (nền Superpowers)

> **Cách dùng (cho bạn):** đặt file này vào repo `manhgg22/lane` (cùng chỗ với `claude-code-build-brief.md`), mở Claude Code ở gốc repo, rồi nói:
> *"Đọc HARNESS-REDESIGN-BRIEF.md và toàn bộ repo hiện tại. Xác nhận hiểu đúng hiện trạng + kiến trúc đích, rồi làm theo từng PHASE. Sau mỗi phase chạy thật + dán output, dừng xin tôi duyệt."*
>
> Brief này **ưu tiên cao hơn** `claude-code-build-brief.md` ở những chỗ mâu thuẫn. Lý do đổi hướng nằm ở §1–§2.

---

## 1. Tư tưởng cốt lõi (đọc kỹ — đây là chỗ bản hiện tại làm sai)

Tác giả gốc nói: **90% giá trị là workflow, 10% là harness**. Workflow của anh ấy là một **Claude Code Skill** xây trên **Superpowers** (framework skill chính thức trong marketplace của Claude Code), KHÔNG phải prompt tĩnh.

Bản code hiện tại sai về kiến trúc gốc:
- Nó để **TS state machine gọi `claude -p` 12 lần theo từng stage**, và nhét workflow tĩnh vào `--append-system-prompt`.
- Hậu quả: mỗi lần gọi là một phiên agent mới → **context bị cắt vụn**, agent không thể chạy một quy trình subagent-driven mạch lạc kéo dài; "skill" chỉ còn là gợi ý, không có enforcement. Đây chính là cái bạn thấy "fix cứng, không dùng được".

**Nguyên tắc mới:** harness KHÔNG điều phối agent theo từng bước. Mỗi lane là **MỘT phiên Claude Code sống lâu**, tự chạy trọn workflow (dùng Superpowers + 2 skill riêng, tự dispatch subagent của nó). Harness chỉ làm 4 việc: **cô lập, khởi chạy, giám sát, và human-in-loop**.

---

## 2. Hiện trạng repo — GIỮ gì / ĐỔI gì

**GIỮ (đã tốt, đã test):**
- `lane-manager.ts`: clone full repo (`git clone --no-hardlinks`), render docker-compose inline, port allocator, health-check, `docker down -v`, `reconcileOnBoot`. ✅ Đây là phần "cô lập" — giữ nguyên.
- `lock.ts` / `semaphore.ts` / `scheduler.ts`: global lock + concurrency cap. ✅ Giữ, nhưng đổi vai trò (xem §6).
- `db.ts` (sql.js, flush ra file), `recovery.ts`, persistence/resume. ✅ Giữ.
- API Fastify + SSE + `web` (Next.js dashboard) + `feature-harness-clone.html`. ✅ Giữ làm tầng hiển thị.
- Bộ test 56/56. ✅ Phải tiếp tục xanh.

**ĐỔI (đây là trọng tâm phiên này):**
- `handlers.ts`: **bỏ mô hình "mỗi stage gọi `claude -p` một lần"**. Thay bằng: khởi một phiên agent sống lâu cho mỗi lane, agent tự chạy skill.
- `prompt-builder.ts` + `skills/feature-workflow.md` (bản markdown tĩnh): thay bằng **skill thật** cài vào lane + Superpowers (xem §5).
- `state-machine.ts`: từ "engine điều khiển" → **read-model** (chỉ phản ánh trạng thái agent báo về, để vẽ pipeline). Xem §6.

---

## 3. Kiến trúc đích

```
                 ORCHESTRATOR (mỏng)
   ┌─────────────────────────────────────────────────┐
   │ lane-manager  → clone + docker + port + db (GIỮ) │
   │ launcher      → khởi 1 phiên `claude` sống lâu / lane │
   │ monitor       → đọc state lane báo về → DB → SSE │
   │ scheduler     → cap concurrency + global heavy-lock (GIỮ) │
   │ human-bridge  → action dashboard → resume agent  │
   └───────────────────────┬─────────────────────────┘
                           │ launch + monitor (KHÔNG điều khiển từng bước)
   ┌───────────┬───────────┼───────────┬───────────┐
 ┌─▼─┐       ┌─▼─┐       ┌─▼─┐       ┌─▼─┐       ┌─▼─┐
 │lane1│     │lane2│     │lane3│     │lane4│     │lane5│
 │full │     │     │     │     │     │     │     │     │
 │clone│     │     │     │     │     │     │     │     │
 │docker│    │     │     │     │     │     │     │     │
 │ + .claude/skills (Superpowers + feature-workflow + pr-review-loop) │
 │ + 1 phiên `claude -p ... --output-format stream-json` chạy SKILL   │
 │ + ghi .harness/state.json mỗi khi đổi bước (qua hook/skill)        │
 └───────────────────────────────────────────────────────────────────┘
        ▲ heavy-lock: skill gọi script `harness-lock acquire` trước bước nặng (e2e/QC)
```

Điểm mấu chốt: **agent tự đi qua pipeline**; harness chỉ *đọc* `state.json` agent ghi ra rồi vẽ. Pipeline 12 node trên dashboard = **projection của state.json**, không phải thứ TS điều khiển.

---

## 4. Cơ chế Claude Code thật cần dùng (đã đối chiếu tài liệu)

- Headless: `claude -p "<prompt>"` (alias `--print`). Output máy đọc: `--output-format json` hoặc `stream-json` (NDJSON realtime). JSON trả `session_id`, `is_error`, `result`, `total_cost_usd`, `duration_ms`.
- Phiên sống lâu / nhiều lượt: lưu `session_id` rồi `claude -p "..." --resume "<id>"` (hoặc `--continue`). Dùng cho **watch-PR** và **human-in-loop** (resume khi người duyệt).
- Quyền: chạy trong Docker nên dùng `--dangerously-skip-permissions` an toàn; hoặc `--permission-mode acceptEdits` + `--allowedTools`.
- Guard bắt buộc: `timeout 30m` quanh mỗi lần gọi, `--max-budget-usd`, kiểm `is_error` + exit code.
- Skill: cài vào `.claude/skills/` của mỗi lane (`npx skills add ...`) hoặc cài Superpowers dạng plugin. Skill được nạp tự động theo `description`.
- Hooks: `.claude/settings.json` của lane có thể đặt `PostToolUse` hook để **emit state** ra `.harness/state.json` (dùng cho monitor). Đây là cách giám sát ổn định nhất.
- Subagent: Claude Code có native subagent (lead dispatch nhiều subagent context cô lập) — chính là cái Superpowers `subagent-driven-development` dùng.

---

## 5. Tầng SKILL (cái 90%) — việc quan trọng nhất

### 5.1 Cài Superpowers vào mỗi lane
Trong bước tạo lane (sau clone), cài Superpowers + 2 skill riêng vào `.claude/` của clone, để agent của lane nạp được. Đừng tự viết lại TDD/brainstorm/subagent — **xây TRÊN** Superpowers.

### 5.2 Skill riêng `feature-workflow` (compose Superpowers)
Viết `SKILL.md` (progressive disclosure) định nghĩa flow, mỗi pha map vào một skill Superpowers:

| Pha | Dùng skill | Ghi chú |
|---|---|---|
| Research & plan | `superpowers:brainstorming` → `superpowers:writing-plans` | "blend" = brainstorm; lưu design + plan |
| Implement + review | `superpowers:subagent-driven-development` | "agent debate" = 2-stage review (spec → quality) + whole-branch review |
| Debug khi fail | `superpowers:systematic-debugging` | self-heal |
| Verify | `superpowers:verification-before-completion` | **evidence bắt buộc** |
| PR / integrate | git + `gh` | conflict → re-integrate |
| Manual test (local) | (skill riêng) chụp ảnh → `.harness/qc-local/` | ~nhiều ảnh |
| Push staging + QC | (skill riêng) chụp ảnh → `.harness/qc-dev/` | |
| Watch PR | (skill riêng) poll comment/conflict → sửa → vòng lại; KHÔNG tự merge | |

Mỗi khi chuyển pha, skill gọi script báo trạng thái (5.4). Giữ luật **evidence-first**: thiếu bằng chứng → `passed_no_evidence`.

### 5.3 Skill riêng `pr-review-loop`
Poll tất cả PR mở (kể cả của mình), review; PR do harness tạo mà có comment/blocking → kích hoạt lane tương ứng quay lại sửa. Chạy như một lane chế độ `review-loop`.

### 5.4 Hợp đồng báo trạng thái — script `harness-report`
Đặt một CLI nhỏ trong mỗi lane mà skill gọi để ghi state (đây là cầu nối skill ↔ harness):
```
harness-report --stage implement --status running
harness-report --stage e2e+QC --status passed_no_evidence --evidence ./.harness/qc-dev
harness-report --stage "watch PR" --status needs_you --note "đợi người merge #106"
```
Ghi/append vào `.harness/state.json`:
```json
{
  "laneSlug": "chat-md-tables",
  "stage": "e2e+QC",
  "stageIndex": 5,
  "status": "running",            // running | passed_no_evidence | blocked | needs_you | done | fail
  "attempt": 1,
  "evidence": ["./.harness/qc-dev/01.png"],
  "note": "...",
  "sessionId": "<claude session id>",
  "updatedAt": "ISO"
}
```
Và một script lock cho bước nặng:
```
harness-lock acquire <laneSlug>   # block tới khi tới lượt (gọi API orchestrator / file-lock)
harness-lock release <laneSlug>
```

---

## 6. Refactor harness (tầng 10%)

1. **launcher**: thay vòng "gọi `claude -p` từng stage" bằng MỘT lần khởi phiên/lane:
   ```
   timeout 8h claude -p "Use the feature-workflow skill to deliver this task.\nTitle: <title>\nCriteria:\n- ...\nReport each stage via `harness-report`. Do NOT push to main; stop at watch PR." \
     --output-format stream-json --verbose \
     --dangerously-skip-permissions \
     --max-budget-usd <n>  > .harness/logs/agent.ndjson
   ```
   Lưu `session_id` từ NDJSON để `--resume` về sau.
2. **monitor**: watch `.harness/state.json` (fs.watch) **hoặc** parse `agent.ndjson` → cập nhật DB → phát SSE → dashboard. `state-machine.ts` trở thành **read-model** (validate transition hợp lệ, không điều khiển).
3. **global lock**: giữ `lock/semaphore`, nhưng nay **agent chủ động xin** qua `harness-lock acquire` trước bước nặng (e2e/QC trong Docker). Orchestrator cấp lock.
4. **human-in-loop**: khi state = `needs_you` (er gate / watch PR / quá attempt) → dashboard hiện nút; người bấm → orchestrator `claude --resume <sessionId> "<chỉ thị>"` để agent đi tiếp.
5. **scheduler**: vẫn cap `MAX_PARALLEL_LANES`; lane mới chờ slot.

---

## 7. Plan theo PHASE (dừng + chứng minh thật sau mỗi phase)

**PHASE A — Spike: agent + Superpowers chạy được trong 1 lane.**
Cài Superpowers vào `fixtures/sample-target-app` clone; chạy thật `claude -p "dùng brainstorming skill cho task X" --output-format stream-json --dangerously-skip-permissions` trong Docker lane. **Dán NGUYÊN output NDJSON + session_id.** Nếu auth/permission lỗi → báo, đừng đi tiếp.
✅ Done: thấy agent thật gọi được skill Superpowers trong lane.

**PHASE B — Skill riêng + báo trạng thái.**
Viết `feature-workflow` + `pr-review-loop` (SKILL.md) compose Superpowers; viết CLI `harness-report` + `harness-lock`; cài hook `.claude/settings.json` của lane để emit state.
✅ Done: chạy 1 lane, `.harness/state.json` cập nhật qua từng pha, có file evidence thật trong qc-local/qc-dev.

**PHASE C — Refactor launcher + monitor.**
Bỏ per-stage agent calls; khởi 1 phiên sống lâu/lane; monitor đọc state.json → DB → SSE → dashboard. `state-machine.ts` thành read-model. Bộ test cũ vẫn xanh (sửa cho hợp read-model).
✅ Done: dashboard phản ánh đúng pipeline của 1 lane chạy thật, trễ ≤5s.

**PHASE D — Global lock thật + human-in-loop.**
Agent xin lock trước e2e/QC; `needs_you` → nút trên dashboard → `--resume` agent đi tiếp.
✅ Done: chứng minh chỉ 1 lane vào bước nặng cùng lúc; bấm duyệt resume được agent.

**PHASE E — 2 lane song song end-to-end.**
Chạy ĐÚNG 2 lane thật trên fixture. Ghi `RUN_REPORT.md`: `docker ps` (2 container/2 port), state.json từng lane, log lock serialize bước nặng, evidence.
✅ Done: 2 task chạy song song, mỗi lane tự đi tới watch PR, có bằng chứng commit.

**PHASE F — Tổng vệ sinh.** Cập nhật README/ARCHITECTURE phản ánh kiến trúc mới; ghi rõ Next.js/SSE/sql.js là quyết định cố ý.

---

## 8. Nguyên tắc làm việc (bắt buộc)
- KHÔNG thêm tính năng ngoài phase đang làm; KHÔNG tự đổi kiến trúc ngoài brief này mà không hỏi.
- DỪNG sau mỗi phase, **dán output chạy thật** (không nhận "đã ok").
- KHÔNG auto-merge `main`; luôn dừng ở watch PR.
- Mọi lần gọi agent có `timeout` + budget; kiểm `is_error` + exit code; lưu `session_id`.
- Mọi chuyển trạng thái persist trước rồi mới tiếp (resume sau crash).

## 9. Khuyến nghị / quyết định
- Monitor: ưu tiên **state.json qua hook** (ổn định) hơn parse NDJSON; có thể làm cả hai (NDJSON để log, state.json để pipeline).
- Model tier cho subagent: chỉ định model rõ ràng (rẻ cho task transcription, mid-tier cho reviewer) — tránh đốt token.
- Superpowers cài per-lane (trong clone) để mỗi agent độc lập; cập nhật qua plugin.
- Giữ sql.js + Next.js + SSE (đã có), chỉ refactor tầng điều khiển.

---

## 10. Một câu chốt cho agent
> Đừng để TypeScript "đóng vai" workflow. Hãy để **một phiên Claude Code sống lâu trong mỗi lane tự chạy trọn workflow bằng Superpowers + skill riêng**, báo trạng thái qua `harness-report`; phần TypeScript chỉ **cô lập (clone+docker), khởi chạy, giám sát state.json, cấp lock, và resume khi người duyệt**. Đó là "harness mỏng / skill dày".
