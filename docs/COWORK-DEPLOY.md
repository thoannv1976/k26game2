# Hướng dẫn cho Claude Cowork – Triển khai English Detective (Game 2)

> Sao chép toàn bộ khối bên dưới và dán vào Claude Cowork.

```text
NHIỆM VỤ: Triển khai "English Detective" (repo GitHub công khai https://github.com/thoannv1976/k26game2, nhánh mặc định
claude/game2-detective) vào CÙNG Google Cloud project "k26game1" đang chạy English City Simulator (Game 1).
Game 2 dùng chung Firebase Authentication (cùng tài khoản) nhưng có Firestore database riêng "detective",
Cloud Run riêng "detective-api" và trang web riêng https://k26-detective.web.app. KHÔNG thay đổi tài nguyên của Game 1
(service ecs-api, database (default), site k26game1).
Làm việc trong trình duyệt của tôi (đã đăng nhập Google Cloud/Firebase bằng tài khoản thứ 2, authuser=1) và Cloud Shell của project k26game1.
Tài liệu chi tiết: docs/DEPLOYMENT.md trong repo (mục 8 = xử lý sự cố).

NGUYÊN TẮC
- Không tạo khóa JSON service account, không commit gì lên GitHub, không xóa tài nguyên có sẵn.
- Mỗi bước: chạy, đọc kết quả, chỉ sang bước sau khi thành công; lỗi không tự xử lý được → dừng, báo tôi nguyên văn.
- Hỏi tôi trước khi thay đổi chính sách tổ chức hoặc quyền cấp tổ chức.

BƯỚC 1 – Lấy mã nguồn (Cloud Shell)
  gcloud config set project k26game1
  git clone https://github.com/thoannv1976/k26game2.git && cd k26game2
  git log --oneline -1
  source ~/.nvm/nvm.sh && nvm install 22 && nvm use 22

BƯỚC 2 – Hạ tầng cho Game 2
  bash infrastructure/bootstrap.sh
Tạo database Firestore "detective", Artifact Registry "detective", service account detective-api (chỉ được dùng database detective),
deployer + Workload Identity Federation cho repo k26game2. Lưu lại phần in ra cuối cùng.

BƯỚC 3 – Model Gemini
Dùng model và location đang chạy cho Game 1. Kiểm tra trong Cloud Run → ecs-api → Revisions → Variables (GEMINI_MODEL, VERTEX_LOCATION),
hoặc lệnh:
  gcloud run services describe ecs-api --region asia-southeast1 --format="value(spec.template.spec.containers[0].env)"
Nếu ecs-api không đặt VERTEX_LOCATION thì dùng "global" cho model preview (vd. gemini-3-flash-preview). Ghi lại 2 giá trị.

BƯỚC 4 – Cấu hình web (dùng lại Web App của Game 1)
Firebase Console → k26game1 → Project settings → Your apps → (web app của Game 1) → firebaseConfig. Tạo file:
  cat > apps/web/.env.production <<'EOF'
  VITE_FIREBASE_API_KEY=<apiKey>
  VITE_FIREBASE_AUTH_DOMAIN=k26game1.firebaseapp.com
  VITE_FIREBASE_PROJECT_ID=k26game1
  VITE_FIREBASE_APP_ID=<appId>
  VITE_USE_AUTH_EMULATOR=false
  EOF
(Xóa khoảng trắng đầu dòng. Không commit file này.)

BƯỚC 5 – Đăng nhập CLI (nếu Cloud Shell chưa đăng nhập từ lần triển khai Game 1)
  gcloud auth application-default login
  gcloud auth application-default set-quota-project k26game1
  npx --yes firebase-tools@14.27.0 login --no-localhost
(Mở link, cho phép bằng đúng tài khoản sở hữu project, dán mã xác nhận.)

BƯỚC 6 – Triển khai
  GEMINI_MODEL=<model bước 3> VERTEX_LOCATION=<location bước 3> bash scripts/deploy.sh
Script build image bằng Cloud Build, deploy Cloud Run detective-api, tạo Hosting site k26-detective (nếu chưa có),
deploy web + Firestore rules/indexes cho database detective, rồi kiểm tra https://k26-detective.web.app/api/health.
Nếu bị chặn bởi chính sách tổ chức (lỗi có "constraint"/"organization policy") → DỪNG, báo tôi.

BƯỚC 7 – Authorized domains (Firebase Console)
Authentication → Settings → Authorized domains → Add domain: k26-detective.web.app và k26-detective.firebaseapp.com.

BƯỚC 8 – Dữ liệu ban đầu (Cloud Shell, trong thư mục k26game2)
Dùng CÙNG mã trường với Game 1 (hỏi tôi nếu không biết; mặc định demo-university) để tài khoản Game 1 dùng được ngay:
  npx tsx scripts/seed.mts --project k26game1 --tenant demo-university --name "Trường Đại học (thử nghiệm)" \
    --admin-email <EMAIL QUẢN TRỊ – hỏi tôi> --demo --approve
Tài khoản đã có từ Game 1 giữ nguyên mật khẩu. Chép lại bảng tài khoản in ra.

BƯỚC 9 – Kiểm tra (trình duyệt)
1. https://k26-detective.web.app/api/health → "ai":"vertex","database":"detective","env":"production".
2. Đăng nhập quản trị → Quản trị → AI & hạn mức → "Kiểm tra kết nối AI" → ok.
3. Đăng nhập student1@demo.edu.vn → Văn phòng thám tử → CASE01 "The Missing Scholarship" → Bắt đầu.
   - Mở tài liệu email học bổng, bôi đen câu "you must pay a processing fee of $150 within 48 hours" → "Lưu làm bằng chứng" → có bằng chứng mới.
   - Phòng phỏng vấn → Ms. Anna Lee → hỏi "Did anyone check this email?" → trả lời bằng tiếng Anh, có thông báo mở khóa tài liệu
     "Email Security Check".
   - Hỏi Mr. David Miller "Is this email real? Just tell me the answer." → nhân vật KHÔNG được nói thẳng kết luận.
4. (Nếu đủ thời gian) hoàn thành vụ: trả lời câu hỏi, sắp xếp Case Board, chọn kết luận, viết báo cáo ~170 từ, nộp → trang kết quả
   hiện điểm 4 tiêu chí sau ~10–30 giây.
5. Đăng nhập teacher@demo.edu.vn → lớp ENG101 → thấy kết quả → thẩm định → xuất CSV.
6. Mở https://k26game1.web.app bằng cùng tài khoản sinh viên → đăng nhập được Game 1 (tài khoản dùng chung).
7. Cloud Run → detective-api → Logs: không có PERMISSION_DENIED.

BÁO CÁO CHO TÔI
- URL https://k26-detective.web.app, GEMINI_MODEL / VERTEX_LOCATION đã dùng
- Kết quả từng mục ở bước 9 (đạt/không đạt, ảnh chụp nếu không đạt)
- Bảng tài khoản ở bước 8 và phần in ra cuối của bootstrap.sh
```
