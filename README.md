# English Detective – AI Mystery Challenge (K26 – Game 2)

Game điều tra bằng tiếng Anh giúp sinh viên luyện **Đọc – Viết – Tư duy phản biện** (B1–B2): đọc tài liệu, tự đánh dấu bằng chứng,
phỏng vấn nhân vật AI, sắp xếp Case Board, chọn kết luận và viết báo cáo. AI chấm sơ bộ theo rubric 100 điểm; giảng viên thẩm định.

Chạy trên **Google Cloud + Firebase**, dùng chung project và **tài khoản đăng nhập** với Game 1 (English City Simulator),
dữ liệu tách riêng trong Firestore database `detective`.

| Tài liệu | Nội dung |
|---|---|
| [PLAN.md](PLAN.md) | Kế hoạch đã duyệt |
| [docs/COWORK-DEPLOY.md](docs/COWORK-DEPLOY.md) | **Hướng dẫn dán vào Claude Cowork để triển khai** |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Triển khai chi tiết, xử lý sự cố |
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | Hướng dẫn sử dụng cho sinh viên và giảng viên |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Kiến trúc, Game Engine, AI |
| [docs/DATABASE.md](docs/DATABASE.md) | Cấu trúc Firestore |
| [docs/API.md](docs/API.md) | REST API, API LMS-AI9 |
| [docs/CASES.md](docs/CASES.md) | Ngân hàng vụ việc, cách viết/duyệt vụ việc mới |
| [docs/TESTING.md](docs/TESTING.md) | Kiểm thử |
| [docs/SECURITY.md](docs/SECURITY.md) | Bảo mật, quyền riêng tư, chi phí |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Vận hành |
| [docs/spec/game2-english-detective.md](docs/spec/game2-english-detective.md) | Đặc tả gốc |

## Chạy trên máy phát triển

Yêu cầu Node.js 22, Java 21.

```bash
npm install
```

Terminal 1:

```bash
npm run emulators
```

Terminal 2 (dữ liệu mẫu: trường demo, 6 vụ việc đã duyệt, tài khoản demo mật khẩu `Demo-12345`), rồi API với AI offline:

```bash
npm run seed:local
```

```bash
GCP_PROJECT_ID=demo-ed FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run dev:api
```

Terminal 3 – web tại http://localhost:5173:

```bash
cp apps/web/.env.example apps/web/.env.local && npm run dev:web
```

Tài khoản demo: `student1@demo.edu.vn`, `teacher@demo.edu.vn`, `admin@demo.edu.vn`, `platform@demo.edu.vn`.

## Kiểm thử

```bash
npm run typecheck && npm run test:unit && npm run test:integration
```

## Cấu trúc

```
apps/web               React + Vite + Tailwind
apps/api               Fastify API (Cloud Run "detective-api")
packages/shared        Kiểu dữ liệu, Canonical Case Dossier, định dạng minh chứng k26-evidence
packages/game-engine   Luật điều tra xác định + chấm phần máy chấm + kiểm tra hồ sơ vụ việc
packages/ai            Prompt, Gemini/offline provider, bộ lọc phản hồi AI
content/cases          CASE01–CASE06
firebase/ infrastructure/ scripts/ tests/e2e/ docs/
```

> Kết quả do AI hỗ trợ chỉ mang tính đánh giá quá trình, **không phải điểm chính thức**.
