# OPERATIONS – Vận hành

| Việc | Ai | Ở đâu |
|---|---|---|
| Tài khoản, lớp (dùng chung danh tính với Game 1) | Quản trị trường | Quản trị → Người dùng / Lớp |
| Duyệt, sửa, tạo vụ việc (kể cả bằng AI) | Giảng viên, quản trị | Ngân hàng vụ việc |
| Giao vụ, theo dõi quá trình điều tra, thẩm định, chấm lại, xuất CSV | Giảng viên | Giảng viên → Lớp |
| Cấu hình AI, hạn mức, chi phí, nhật ký | Quản trị trường | Quản trị |

## Quy trình vụ việc mới
1. Tạo bằng **AI Case Generator** hoặc sửa JSON của vụ có sẵn (Lưu → phiên bản nháp mới).
2. Xem phần **Kiểm tra nhất quán**: phải không còn lỗi (đoạn trích phải có trong tài liệu, dữ kiện tham chiếu đúng, có lời giải mẫu…).
3. Đọc bản xem trước: tài liệu, nhân vật và dữ kiện, bằng chứng và phân loại, câu hỏi và đáp án, kết luận, đề viết.
4. Chơi thử bằng tài khoản giảng viên (sau khi duyệt) hoặc trên môi trường dev.
5. **Duyệt** → sinh viên thấy. Phiên đang chơi giữ phiên bản cũ.

## Theo dõi
- Cloud Run `detective-api`: lỗi 5xx, độ trễ. Log `AI character failed`, `AI grading failed`.
- Quản trị → Sử dụng: lượt và chi phí theo loại (character / assistant / grade / generate), theo ngày, theo sinh viên; tỉ lệ lỗi.
- Assessment `qualityChecks.removedUnverifiableQuotes` cao bất thường → xem lại model/prompt chấm.

## Sự cố
| Triệu chứng | Kiểm tra |
|---|---|
| Kết quả "đang chấm" quá 3 phút | Khóa chấm tự hết hạn sau 3 phút; tải lại trang kết quả. Giảng viên có thể "Chấm lại" |
| Writing "chưa đánh giá" | AI lỗi hoặc hết hạn mức → giảng viên chấm tay (thẩm định) hoặc "Chấm lại" |
| Sinh viên báo mất bài viết | Bản nháp lưu server (drafts/current, có phiên bản) + bản sao trong trình duyệt; xem trong quá trình điều tra của giảng viên |
| Nhân vật nói sai dữ kiện | Ghi lại câu hỏi/trả lời (interview_messages), sửa dữ kiện/cụm từ cấm trong hồ sơ → phiên bản mới → duyệt |

Sao lưu: `gcloud firestore databases update --database=detective --enable-pitr`. Quay lui: Cloud Run revisions / Hosting release history.
