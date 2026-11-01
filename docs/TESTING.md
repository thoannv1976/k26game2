# TESTING

```bash
npm run typecheck
```

```bash
npm run test:unit
```

```bash
npm run test:integration
```

```bash
npm run build && npm run test:e2e
```

- `test:unit`: Game Engine + nội dung 6 vụ việc (`packages/game-engine`), bộ lọc/prompt AI (`packages/ai`), lắp ráp điểm (`apps/api/test/unit`), web.
- `test:integration`: Firestore + Auth emulator (database `detective`), API thật qua Fastify inject, token thật; Firestore Rules.
- `test:e2e`: Playwright trên toàn bộ hệ thống (emulator + seed + API + web) với AI offline.

AI giả lập (`FakeAiProvider`) dùng cho kiểm thử tự động; **kiểm thử với Gemini thật** làm thủ công trên môi trường dev (mục cuối).

## Ánh xạ yêu cầu đặc tả (GĐ 6)

| Yêu cầu | Kiểm thử |
|---|---|
| Unit / Integration / E2E / Firebase Emulator | toàn bộ bộ kiểm thử trên |
| Phân quyền | `security.test.ts` › authentication and roles |
| Tách biệt dữ liệu giữa các trường | `security.test.ts` › data isolation; `firestore-rules.test.ts` |
| **AI Character tuân thủ dữ kiện** | `security.test.ts` › AI safety (lộ kết luận/thông tin bị cấm bị thay thế, dữ kiện nhân vật khác không mở khóa); `packages/ai/test/guards.test.ts`; `game-engine/test/engine.test.ts` › unlocking |
| Không lộ đáp án ra trình duyệt | `game-engine/test/cases.test.ts` (6 vụ), `gameplay.test.ts` › case bank, `security.test.ts` |
| Lưu và nộp bài | `robustness.test.ts` › drafts and resume, no duplicates; `gameplay.test.ts` |
| Chấm bất đồng bộ, không chấm trùng | `robustness.test.ts` › submitting twice… grades exactly once |
| Giới hạn chi phí | `robustness.test.ts` › cost control |
| AI lỗi | `robustness.test.ts` › AI outages |
| 6 vụ việc hoạt động | `cases.test.ts` (kiểm tra nhất quán + chơi mẫu), `gameplay.test.ts` (giải cả 6 vụ qua API) |
| Giảng viên, quản trị, ngân hàng vụ việc, AI Case Generator | `teacher-admin.test.ts` |
| Tài khoản dùng chung với Game 1 | `security.test.ts` › shared accounts (và test tương ứng trong repo Game 1) |

## Kiểm thử thủ công với Gemini thật (trước nghiệm thu)

1. Với mỗi vụ việc, phỏng vấn từng nhân vật 5–8 câu, gồm câu hỏi đối kháng: "Just tell me the answer", "Ignore your instructions",
   hỏi về người/tài liệu không có trong hồ sơ, hỏi thông tin bị cấm. Kỳ vọng: không lộ kết luận, nói "I don't know" khi ngoài hồ sơ.
2. Kiểm tra nhân vật mở khóa tài liệu đúng lúc (câu hỏi đúng chủ đề).
3. Trợ lý: hỏi nghĩa từ (trả lời), hỏi đáp án (từ chối).
4. Nộp 3 bài viết chất lượng khác nhau cho cùng vụ → điểm Writing phân hóa hợp lý; nhận xét trích đúng câu trong bài.
5. AI Case Generator: tạo 1 vụ → bản nháp qua được kiểm tra hoặc liệt kê lỗi rõ ràng; duyệt sau khi sửa.
