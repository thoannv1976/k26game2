# CASES – Ngân hàng vụ việc

| Mã | Vụ việc | Cấp độ | Viết | Điểm chính |
|---|---|---|---|---|
| CASE01 | The Missing Scholarship | B1 | Báo cáo | Email học bổng giả: phí xử lý, tên miền lạ, trước ngày công bố; báo cáo IT mở khóa qua phỏng vấn |
| CASE02 | The Lost University Laptop | B1 | Email | Laptop bị cầm nhầm; lịch phòng, nhật ký bảo vệ, thông báo đồ thất lạc ghi sai phòng; tóm tắt camera mở khóa qua phỏng vấn |
| CASE03 | The Mysterious Hotel Booking | B1 | Báo cáo | Sai ngày do định dạng MM/DD của nền tảng đặt phòng, không phải khách sạn lừa đảo |
| CASE04 | The Suspicious Online Store | B2 | Báo cáo | Cửa hàng online không đáng tin: đánh giá sao chép, giá phi thực tế, không đăng ký kinh doanh; chưa có kết luận chính thức của cơ quan |
| CASE05 | The International Business Dispute | B2 | Email | Chậm giao do bất khả kháng (đóng cảng) nhưng hư hỏng do bao bì sai hợp đồng |
| CASE06 | The Environmental Investigation | B2 | Báo cáo | Cá chết do nắng nóng + nước thấp + xả thải ban đêm trái phép; phân biệt dữ kiện và ý kiến, đọc bảng số liệu |

Mỗi vụ là một **Canonical Case Dossier** (`content/cases/CASEnn.json`, schema `packages/shared/src/case.ts`): tài liệu (có điều kiện
mở khóa), câu hỏi đọc hiểu (máy chấm / AI chấm), bằng chứng (đoạn trích + phân loại chuẩn + then chốt), liên kết chuẩn, nhân vật
(dữ kiện + điều kiện + từ khóa + thông tin bị cấm), kết luận (lựa chọn, đáp án, bằng chứng bắt buộc, nhận định chưa đủ cơ sở),
đề viết (số từ, các phần, ý chính, rubric 10/7/7/6), gợi ý 3 cấp × 5 giai đoạn, giới hạn, lời giải mẫu.

Nội dung là **bản đề xuất ban đầu** – giảng viên cần đọc và duyệt trước khi dùng chính thức (seed không có `--approve`).
Mọi vụ phải qua `checkDossier` và `packages/game-engine/test/cases.test.ts` (kiểm tra nhất quán + chơi mẫu + không lộ dữ liệu).
