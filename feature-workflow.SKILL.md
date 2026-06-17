---
name: feature-workflow
description: >
  Quy trình end-to-end để một AI agent (Claude Code) tự thực hiện trọn một feature/task
  trong một lane cô lập: nghiên cứu → lập kế hoạch → code → kiểm thử nhiều tầng → tạo PR →
  tích hợp → manual test + chụp màn hình → đẩy staging → QC → theo dõi PR. Dùng skill này
  cho MỌI task chạy trong một lane của Feature Harness. Đây là phần "90%" giá trị của hệ thống.
---

# Feature Workflow (chạy trong một lane cô lập)

Bạn (agent) đang làm việc trong **một bản copy hoàn chỉnh, cô lập của repo** (có server riêng, DB riêng, port riêng, Docker). Nhiệm vụ: đưa **một task duy nhất** đi trọn vòng đời dưới đây. Mỗi bước chỉ được coi là **PASS khi có bằng chứng (evidence)** — không báo "xanh" suông.

## Nguyên tắc xuyên suốt
- **Evidence-first:** mỗi bước phải để lại artifact chứng minh (kết quả test, ảnh chụp màn hình, log). Không có evidence → đánh dấu `passed_no_evidence` và DỪNG để người kiểm.
- **Self-heal có giới hạn:** fail thì tự đọc lỗi, sửa, quay lại bước trước. Quá `MAX_ATTEMPTS` (mặc định 3) → `blocked`, chờ người.
- **Không tự merge vào `main`.** Luôn dừng ở "watch PR".
- **Ghi log mỗi lần chuyển bước** vào `.harness/logs/` để dashboard hiển thị.
- Kết thúc mỗi lần chạy, in một khối máy-đọc-được:
  `<<HARNESS_RESULT>>{"ok":true|false,"stage":"...","evidence":["..."],"summary":"..."}<<END>>`

---

## Bước 0 — Intake
- Đọc `task-prompt.md`: mục tiêu + **predefined criteria** (tiêu chí nghiệm thu).
- Xác nhận môi trường lane đã sẵn sàng (server lên ở `PORT`, DB kết nối được).
- Tóm tắt lại task và criteria bằng lời của bạn để chắc đã hiểu đúng.

## Bước 1 — Research & Re-plan (đầu tư kỹ ở đây)
Đây là bước tinh chỉnh nhiều nhất; làm cẩn thận sẽ giảm hẳn lỗi về sau.
1. Khảo sát codebase liên quan tới task (file, module, data model, luồng hiện có).
2. Lập **plan** chi tiết: các thay đổi, file đụng tới, rủi ro, cách test.
3. **Blend + Agent-Debate review loop** (quan trọng):
   - Tổng hợp ("blend") plan thành một bản thống nhất.
   - **Spawn một sub-agent** đóng vai phản biện để review bản blend (tìm lỗ hổng, mâu thuẫn, thiếu sót, rủi ro flow/data).
   - Agent chính nhận phản hồi, **blend lại**.
   - Lặp spawn-review → blend cho tới khi sub-agent không còn phản đối đáng kể → plan "chín".
- *Evidence:* lưu `plan.md` (bản cuối) + `plan-debate.md` (các vòng phản biện).

## Bước 2 — Implement
- Code theo plan đã chốt. Commit nhỏ, message rõ ràng.
- Build phải sạch (không lỗi cú pháp/type).
- *Evidence:* build log.

## Bước 3 — Gates (cổng kiểm tra tự động)
Chạy và phải PASS hết: **lint → typecheck → unit test → đối chiếu từng predefined criteria.**
- Fail bất kỳ → quay lại Bước 2 sửa (re-enter, tăng attempt).
- *Evidence:* test report (đường dẫn file).

## Bước 4 — Multi-level Review (nhiều tầng, đây là điểm hay bị thiếu)
Lần lượt:
1. **Logic review:** logic đúng chưa, edge case, lỗi ngầm.
2. **Flow review:** đi qua **user flow** và **data flow** — có hợp lý không? có tự nhiên không? có **user-friendly** không?
3. **Full text-based review:** đọc **toàn bộ diff dưới dạng văn bản một lượt** (không review rải rác trong lúc code) — cách này bắt được nhiều lỗi hơn review xen kẽ.
- Có vấn đề → quay lại bước phù hợp (2 hoặc 1) để sửa.
- *(Khuyến nghị của tác giả: nếu được, nhờ đồng nghiệp/người review thêm.)*
- *Evidence:* `review-notes.md`.

## Bước 5 — Create PR
- `gh pr create --base development --head feat/<slug> --title "<task>" --body "<tóm tắt + criteria + evidence>"`.
- *Evidence:* số PR.

## Bước 6 — Integrate
- Merge/cập nhật nhánh `development` vào nhánh feature.
- **Conflict → re-merge → re-integrate** (lặp tới khi sạch hoặc `blocked`).
- *Evidence:* merge log, CI status sau merge.

## Bước 7 — Manual Test + Screenshots (trên LOCAL)
- Tự thao tác qua các màn hình/chức năng chính của task trên app local (`http://localhost:PORT`).
- **Chụp màn hình** từng bước quan trọng, lưu vào `.harness/qc-local/` (có thể nhiều — ví dụ ~39 ảnh).
- *Evidence:* thư mục `qc-local/*.png`. Thiếu ảnh → `passed_no_evidence`.

## Bước 8 — Push to Staging (dev)
- Đẩy lên môi trường staging/dev.
- Lưu ý: bước chạy nặng (Docker/e2e) phải xin **global lock** — chỉ một lane chạy tại một thời điểm.
- *Evidence:* deploy log.

## Bước 9 — QC trên Staging + Screenshots
- Manual test lại lần nữa trên staging (gọi là **QC**).
- **Chụp màn hình** lưu vào `.harness/qc-dev/` (ví dụ ~14 ảnh).
- *Evidence:* thư mục `qc-dev/*.png`.

## Bước 10 — Watch PR (vòng chờ + tự sửa)
- Vào trạng thái `watching-pr`, **poll định kỳ**:
  - Có ai **comment** vào PR? → đọc, sửa theo, **quay lại** bước phù hợp rồi đi tiếp một vòng.
  - **Base branch** (`development`) có thay đổi gây **conflict**? → cập nhật, re-integrate.
- Không tự merge — chờ **người** merge. Khi người merge → Bước 11.

## Bước 11 — Done
- (Tuỳ chọn) dọn dẹp, báo cáo tổng kết task + toàn bộ evidence.

---

## Bảng quyết định nhanh
| Tình huống | Hành động |
|---|---|
| Bước PASS + có evidence | sang bước sau |
| Bước PASS nhưng thiếu evidence | `passed_no_evidence` → dừng cho người kiểm |
| Bước FAIL | self-heal: đọc lỗi → sửa → re-enter bước trước (attempt++) |
| attempt > MAX_ATTEMPTS | `blocked` → needs-you |
| conflict khi integrate | re-merge → re-integrate (loop có giới hạn) |
| có comment PR / base đổi | quay lại bước phù hợp, đi thêm một vòng |
| tới watch PR | giữ `watching-pr`, chờ người merge |

## Liên quan
- Skill chị em **`pr-review-loop`**: poll và review tất cả PR đang mở (kể cả của chính mình); khi PR do harness tạo có comment/blocking thì kích hoạt lane tương ứng quay lại sửa.
