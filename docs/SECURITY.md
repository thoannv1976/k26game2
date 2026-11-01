# SECURITY – Bảo mật, quyền riêng tư, chi phí

## Danh tính & phân quyền
- Firebase Authentication **dùng chung với English City Simulator**; claims `{tenantId, role}` do backend gán. Đổi vai trò/khóa
  tài khoản ở game nào cũng có hiệu lực ở cả hai game (token bị thu hồi ngay, API kiểm tra `checkRevoked`).
- Sinh viên chỉ thấy phiên/báo cáo/kết quả của mình; giảng viên chỉ thấy sinh viên lớp mình; quản trị trường thấy dữ liệu trường mình;
  quản trị nền tảng không xem dữ liệu học tập. Mọi truy vấn dựa trên `tenantId` trong token.
- Firestore Rules (database `detective`): cấm mọi thao tác ghi từ client; **cấm đọc hồ sơ vụ việc** (`cases/*/versions`).
- Service account `detective-api` chỉ được quyền Firestore trên database `detective` (IAM condition).

## Không lộ đáp án
- Trình duyệt chỉ nhận dữ liệu qua `game-engine/src/view.ts`: không có đáp án, phân loại bằng chứng, dữ kiện nhân vật, kết luận,
  lời giải mẫu. Tài liệu bị khóa không gửi nội dung. Có kiểm thử tự động cho cả 6 vụ việc.
- Lời giải chỉ hiển thị **sau khi nộp bài**.

## Kiểm soát AI
- Prompt riêng cho từng chức năng (Character, Assistant, Grader, Case Generator); đầu ra JSON có schema + kiểm tra zod.
- Nhân vật chỉ nhận dữ kiện đủ điều kiện tại thời điểm hỏi; engine chỉ chấp nhận dữ kiện thuộc nhân vật đó; bộ lọc thay thế câu trả lời
  chứa cụm từ bị cấm, nội dung dữ kiện chưa mở khóa hoặc kết luận đúng.
- Trợ lý không nhận dữ liệu ẩn, từ chối giải hộ; câu trả lời chứa kết luận bị thay thế.
- Bộ chấm: chỉ giữ nhận xét/sửa lỗi trích dẫn đúng từ bài viết; điểm bị giới hạn theo rubric; AI lỗi → "chưa đánh giá".
- Nội dung tài liệu và lời sinh viên là dữ liệu không tin cậy (khối dữ liệu có ký hiệu riêng; lọc ký tự phân cách).
- AI không thể đổi điểm, dữ kiện hay quyền: mọi thay đổi trạng thái do engine quyết định.

## Quyền riêng tư
- Chỉ lưu dữ liệu học tập cần thiết (không ghi âm). Xóa dữ liệu theo yêu cầu (Quản trị → Người dùng) – lưu ý tài khoản đăng nhập dùng chung.
- Không dùng bài làm của sinh viên để huấn luyện mô hình. Xuất CSV có chống formula injection.

## Chi phí
Hạn mức theo trường: lượt AI/sinh viên/ngày, số lần bắt đầu vụ/ngày, câu hỏi phỏng vấn/phiên (và theo nhân vật), lượt trợ lý/phiên,
số lần chấm/phiên, token tối đa, ngân sách tháng của trường/học phần, ngưỡng cảnh báo, chính sách khi vượt. Mỗi lời gọi ghi `usage_logs`
kèm chi phí ước tính. Budget Alert của Google Cloud chỉ là cảnh báo – hạn mức nội bộ mới chặn.

## Khác
Helmet, rate limit (mặc định 240 request/phút/người), giới hạn kích thước request, container chạy user `node`, audit log cho thao tác quản trị
(người dùng, lớp, vụ việc, cấu hình, thẩm định, xuất dữ liệu).
