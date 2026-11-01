# DEPLOYMENT – Triển khai English Detective

English Detective chạy **trong cùng project GCP/Firebase với English City Simulator** (`k26game1`):

| Thành phần | Game 1 (đã có) | Game 2 (mới) |
|---|---|---|
| Firebase Auth | dùng chung | dùng chung (cùng tài khoản) |
| Firestore | database `(default)` | database **`detective`** |
| Cloud Run | `ecs-api` | **`detective-api`** |
| Hosting | `k26game1.web.app` | **`k26-detective.web.app`** |
| Service account | `ecs-api@…` | **`detective-api@…`** (chỉ được truy cập database `detective`) |

## 0. Điều kiện

- Game 1 đã triển khai trên `k26game1` (billing, Firebase, Authentication Email/Password đã bật).
- Biết model Gemini đang chạy được cho Game 1 (khi triển khai Game 1: `gemini-3-flash-preview`; `gemini-2.5-flash` trả 404).
- Có cấu hình Web App Firebase của Game 1 (`apiKey`, `appId`) – dùng lại cho Game 2.

## 1. Lấy mã nguồn

```bash
git clone https://github.com/thoannv1976/k26game2.git && cd k26game2
```

## 2. Hạ tầng (một lần)

```bash
bash infrastructure/bootstrap.sh
```

Tạo database `detective` (asia-southeast1), Artifact Registry `detective`, service account `detective-api` (quyền Firestore có
điều kiện chỉ database `detective`, Vertex AI, Firebase Auth admin), deployer `gh-detective-deployer` + Workload Identity Federation
cho repo `thoannv1976/k26game2`. An toàn khi chạy lại.

## 3. Cấu hình web

```bash
cp apps/web/.env.example apps/web/.env.production
```

Điền **giống Game 1**: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN=k26game1.firebaseapp.com`, `VITE_FIREBASE_PROJECT_ID=k26game1`,
`VITE_FIREBASE_APP_ID`, `VITE_USE_AUTH_EMULATOR=false`.

## 4. Triển khai

Đăng nhập (một lần trong Cloud Shell):

```bash
gcloud auth application-default login && gcloud auth application-default set-quota-project k26game1
```

```bash
npx --yes firebase-tools@14.27.0 login --no-localhost
```

```bash
GEMINI_MODEL=gemini-3-flash-preview VERTEX_LOCATION=global bash scripts/deploy.sh
```

Script: cài thư viện → unit test → Cloud Build image → Cloud Run `detective-api` → (tự tắt invoker IAM check nếu tổ chức chặn
truy cập công khai) → build web → tạo Hosting site `k26-detective` nếu chưa có → deploy Hosting + rules/indexes database `detective`
→ kiểm tra `https://k26-detective.web.app/api/health`.

**Firebase Console → Authentication → Settings → Authorized domains:** thêm `k26-detective.web.app` và `k26-detective.firebaseapp.com`.

## 5. Dữ liệu ban đầu

Dùng **cùng mã trường** với Game 1 (ví dụ `demo-university`) để tài khoản hiện có dùng được ngay:

```bash
npx tsx scripts/seed.mts --project k26game1 --tenant demo-university --name "Trường Đại học (thử nghiệm)" --admin-email <email-quan-tri> --demo --approve
```

- Tài khoản đã có từ Game 1 giữ nguyên mật khẩu; tài khoản mới in mật khẩu tạm.
- Bỏ `--approve` để 6 vụ việc ở trạng thái nháp cho giảng viên duyệt (Quản trị → Vụ việc).

## 6. Kiểm tra

1. `https://k26-detective.web.app/api/health` → `{"ok":true,"app":"english-detective","ai":"vertex","database":"detective","env":"production"}`.
2. Đăng nhập quản trị → AI & hạn mức → **Kiểm tra kết nối AI** → ok.
3. Sinh viên demo: Văn phòng → CASE01 → đọc tài liệu, bôi đen bằng chứng, phỏng vấn Anna ("Did anyone check this email?") → tài liệu mới mở khóa;
   nhân vật trả lời đúng hồ sơ, không tiết lộ kết luận.
4. Hoàn thành Case Board, kết luận, viết báo cáo 150–200 từ → nộp → kết quả xuất hiện sau ~10–30 giây.
5. Giảng viên: lớp ENG101 → thấy kết quả → thẩm định → xuất CSV. Tài khoản này cũng đăng nhập được Game 1.
6. Cloud Run → `detective-api` → Logs không có `PERMISSION_DENIED`.

## 7. GitHub Actions (tùy chọn)

Environment `development` trong repo `k26game2` với các biến bootstrap in ra (`GCP_PROJECT_ID`, `GCP_REGION`, `WIF_PROVIDER`,
`DEPLOYER_SA`, `RUNTIME_SA`, `HOSTING_SITE`, `GEMINI_MODEL`, `VERTEX_LOCATION`, `VITE_FIREBASE_*`). Push `main` + CI xanh → deploy dev;
**Deploy production** chạy tay và cần người duyệt.

## 8. Sự cố thường gặp

| Hiện tượng | Xử lý |
|---|---|
| `/api/**` 404 trên k26-detective.web.app | Cloud Run `detective-api` chưa có ở asia-southeast1 |
| 403 khi Hosting gọi Cloud Run | `gcloud run services update detective-api --region asia-southeast1 --no-invoker-iam-check` (hoặc chính sách tổ chức – xem Game 1 docs/DEPLOYMENT.md mục 4) |
| `NOT_PROVISIONED … not been set up in English Detective` | Chưa seed trường (mục 5) hoặc mã trường khác Game 1 |
| Nhân vật luôn trả "seems busy" / chấm bài "not assessed" | Sai `GEMINI_MODEL`/`VERTEX_LOCATION`; xem log `AI character failed` |
| `PERMISSION_DENIED` Firestore | Sai `FIRESTORE_DATABASE` (phải là `detective`) hoặc thiếu IAM có điều kiện – chạy lại bootstrap |
| `requires an index` | `npx firebase-tools@14.27.0 deploy --only firestore --project k26game1`, đợi index build |
| Đăng nhập Google lỗi domain | Thêm domain Hosting vào Authorized domains |
