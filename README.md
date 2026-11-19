# Order QR API

Backend cho hệ thống đặt món qua mã QR, xây dựng bằng **Node.js (>= 20) + ExpressJS 5 + TypeScript + Mongoose (MongoDB)**.

## Yêu cầu

- Node.js >= 20, npm
- MongoDB (local, Docker hoặc MongoDB Atlas)

## Cài đặt

```bash
npm install
cp .env.example .env
```

Sau đó mở `.env` và điền các giá trị (đặc biệt là `DATABASE_URL`).

## Cấu hình `.env`

Tất cả biến được validate bằng zod khi khởi động (`src/config/env.ts`); nếu thiếu hoặc sai, server sẽ dừng và in ra danh sách lỗi.

| Biến                               | Bắt buộc | Mô tả                                                                                                             | Ví dụ                                |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `PORT`                             | Không    | Cổng HTTP (mặc định `4000`)                                                                                       | `4000`                               |
| `NODE_ENV`                         | Không    | `development` \| `production` \| `test` (mặc định `development`)                                                  | `development`                        |
| `DATABASE_URL`                     | **Có**   | Chuỗi kết nối MongoDB (`mongodb://` hoặc `mongodb+srv://`)                                                        | `mongodb://localhost:27017/order-qr` |
| `JWT_ACCESS_SECRET`                | **Có**   | Secret ký access token, tối thiểu 32 ký tự                                                                        | chuỗi ngẫu nhiên                     |
| `JWT_REFRESH_SECRET`               | **Có**   | Secret ký refresh token, tối thiểu 32 ký tự                                                                       | chuỗi ngẫu nhiên                     |
| `JWT_ACCESS_EXPIRES`               | Không    | Thời hạn access token (mặc định `15m`)                                                                            | `15m`                                |
| `JWT_REFRESH_EXPIRES`              | Không    | Thời hạn refresh token (mặc định `7d`)                                                                            | `7d`                                 |
| `BCRYPT_SALT_ROUNDS`               | Không    | Số vòng băm bcrypt (4-15, mặc định `10`)                                                                          | `10`                                 |
| `LOGIN_RATE_LIMIT_MAX`             | Không    | Số lần đăng nhập **thất bại** tối đa / IP trong một cửa sổ (mặc định `10`)                                        | `10`                                 |
| `LOGIN_RATE_LIMIT_WINDOW_MINUTES`  | Không    | Độ dài cửa sổ rate limit đăng nhập, phút (mặc định `15`)                                                          | `15`                                 |
| `PUBLIC_RATE_LIMIT_WINDOW_SECONDS` | Không    | Cửa sổ rate limit cho route `/public`, giây (mặc định `60`)                                                       | `60`                                 |
| `PUBLIC_RATE_LIMIT_MAX`            | Không    | Số request tối đa / IP / cửa sổ cho mọi route `/public` (mặc định `600`)                                          | `600`                                |
| `PUBLIC_WRITE_RATE_LIMIT_MAX`      | Không    | Số thao tác ghi tối đa / cửa sổ: mở phiên (theo IP), quote/đặt/huỷ đơn (theo phiên bàn) (mặc định `30`)           | `30`                                 |
| `EMPTY_SESSION_TIMEOUT_MINUTES`    | Không    | Tự đóng phiên `open` không có món sau N phút không hoạt động (`closeReason: expired`); `0` = tắt (mặc định `120`) | `120`                                |
| `SEED_ADMIN_EMAIL`                 | Seed     | Email tài khoản đầu tiên (chỉ dùng cho `npm run seed:admin`)                                                      | `admin@example.com`                  |
| `SEED_ADMIN_PASSWORD`              | Seed     | Mật khẩu tài khoản đầu tiên (8-72 ký tự)                                                                          | chuỗi mạnh                           |
| `SEED_ADMIN_FULLNAME`              | Không    | Họ tên tài khoản đầu tiên (mặc định `Quản trị viên`)                                                              | `Chủ quán`                           |
| `SEED_DEMO_PASSWORD`               | Không    | Mật khẩu cho tài khoản nhân viên demo do `npm run seed:demo` tạo (mặc định `Demo@123456`)                         | chuỗi mạnh                           |
| `CLIENT_URL`                       | **Có**   | URL web dành cho khách, được in vào mã QR                                                                         | `http://localhost:3000`              |
| `CLOUDINARY_CLOUD_NAME`            | Không    | Cloud name Cloudinary (để trống → API upload ảnh trả 503)                                                         | `my-cloud`                           |
| `CLOUDINARY_API_KEY`               | Không    | API key Cloudinary                                                                                                |                                      |
| `CLOUDINARY_API_SECRET`            | Không    | API secret Cloudinary                                                                                             |                                      |
| `CLOUDINARY_FOLDER`                | Không    | Thư mục gốc chứa ảnh trên Cloudinary (mặc định `order-qr`)                                                        | `order-qr`                           |

Tạo secret ngẫu nhiên: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## Chạy dự án

```bash
npm run dev      # chạy dev với tsx watch (tự reload)
npm run build    # biên dịch TypeScript ra dist/
npm start        # chạy bản build (dist/server.js)
```

Tạo tài khoản đầu tiên (đọc `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` trong `.env`; chạy lại nhiều lần an toàn — email đã tồn tại thì bỏ qua, không đổi mật khẩu):

```bash
npm run seed:admin
```

### Dữ liệu demo (`npm run seed:demo`)

```bash
npm run seed:demo              # idempotent: chỉ thêm phần còn thiếu, không ghi đè dữ liệu đã có
npm run seed:demo -- --reset   # XOÁ dữ liệu nghiệp vụ rồi seed lại (production: cần thêm --yes)
npm run seed:demo -- --no-images  # không gắn ảnh (vd. máy không có mạng)
```

Tạo dữ liệu mẫu theo thiết kế cho nhà hàng **Le Bistro & Grill** trên `DATABASE_URL`:

- Cài đặt nhà hàng (giờ mở cửa 10:00–22:30, T6/T7 tới 23:30; VAT 8%, phí phục vụ 5%; tiền mặt/chuyển khoản/thẻ). Chỉ áp khi nhà hàng còn tên mặc định — không ghi đè cài đặt đã sửa.
- 3 khu vực, 20 bàn (`A01–A08` sảnh, `V01–V06` VIP, `S01–S06` sân vườn), 5 danh mục, 22 món giá VND (có món nhiều lựa chọn như mức chín bít tết, size pizza; 1 món đang hết).
- 4 tài khoản nhân viên `minhanh|quocbao|thuha|duclong@lebistro.example`, mật khẩu `SEED_DEMO_PASSWORD` (mặc định `Demo@123456`). Không có vai trò — ai đăng nhập cũng toàn quyền. Tài khoản đã tồn tại không bị đổi mật khẩu.
- Lịch sử 14 ngày + hôm nay: ~200 phiên đã thanh toán, ~300 đơn (ngày cuối tuần đông hơn, giờ cao điểm trưa/tối) để dashboard có số liệu; 5 bàn đang có khách (đơn ở các trạng thái pending → served, 1 bàn đã yêu cầu thanh toán, vài yêu cầu nhanh đang chờ) và 1 bàn `reserved`. Dữ liệu sinh bằng PRNG có seed cố định, tính tiền bằng `calculateBillTotals` như luồng thật, số đơn `ORD-xxxx` liên tục với bộ đếm theo ngày.
- Ảnh cho mọi tài nguyên có ảnh: logo + ảnh bìa nhà hàng, 5 danh mục, 22 món (`src/scripts/demoImages.ts`, nguồn Wikimedia Commons giấy phép mở — CC0/PD/CC BY/CC BY-SA, chỉ dùng cho demo). Có `CLOUDINARY_*` → tải ảnh về rồi upload vào `<CLOUDINARY_FOLDER>/{restaurant,categories,menu-items}/demo-<slug>` (tên cố định, `overwrite: false` → chạy lại/`--reset` không sinh ảnh trùng); chưa cấu hình → lưu thẳng URL Wikimedia (`publicId: null`). Chỉ điền chỗ đang **trống** (không ghi đè ảnh đã đặt); logo/ảnh bìa chỉ gắn khi tên nhà hàng là `Le Bistro & Grill`. Ảnh lỗi (mạng, Cloudinary) chỉ ghi cảnh báo, chạy lại seed sẽ thử lại.
- Chạy lại không `--reset`: danh mục/bàn/món/tài khoản thiếu thì thêm; lịch sử chỉ sinh khi DB **chưa có** phiên/đơn/thanh toán nào.
- `--reset` xoá: khu vực, bàn, danh mục, món, phiên, đơn, bộ đếm đơn, thanh toán, yêu cầu nhanh, cài đặt nhà hàng và tài khoản demo. **Giữ** các tài khoản khác (vd. tài khoản từ `seed:admin`). Ảnh trên Cloudinary không bị xoá (ảnh `demo-*` được dùng lại khi seed lại).

- Health check: `GET http://localhost:4000/api/v1/health` (trả `503` nếu mất kết nối DB)
- Swagger UI: `http://localhost:4000/api/docs` (JSON: `/api/docs.json`)
- File OpenAPI tĩnh: [`docs/openapi.json`](docs/openapi.json) — sinh lại bằng `npm run docs:openapi` mỗi khi đổi route/comment `@openapi` (`npm run docs:openapi -- --check` để kiểm tra; test `tests/openapi.test.ts` cũng báo lỗi nếu file lệch với code).

## Kiểm thử & chất lượng mã

```bash
npm test             # Vitest + supertest + mongodb-memory-server
npm run test:watch
npm run lint         # ESLint
npm run format       # Prettier (ghi file); format:check để chỉ kiểm tra
npm run typecheck
npm run docs:contract # chạy lại toàn bộ test, đối chiếu MỌI response JSON với docs OpenAPI
```

Ngoài test từng module, `tests/e2e.test.ts` chạy trọn luồng qua HTTP: admin tạo món & bàn → khách quét QR → mở phiên → đặt món → nhân viên xác nhận → bếp chuẩn bị → phục vụ → khách yêu cầu thanh toán → thu tiền → bàn trống → dashboard có doanh thu. `tests/openapi.test.ts` kiểm tra spec (route đăng ký trong Express ⇄ path trong docs khớp hai chiều, tham số path/query và field body khớp schema zod của `validate()`, route có validate phải khai báo 400, security đúng nhóm), `npm run docs:contract` (`tests/contract/`) kiểm tra response thật: mã HTTP đã khai báo, đúng kiểu/enum/nullable và không có field chưa mô tả — chạy khi đổi DTO, `tests/hardening.test.ts` kiểm tra bảo mật HTTP, `tests/seed-demo.test.ts` kiểm tra seed.

Test dùng MongoDB in-memory (`mongodb-memory-server`), không cần DB thật. Lần chạy đầu tiên sẽ tải binary MongoDB (cần mạng). Biến môi trường cho test được đặt sẵn trong `tests/setup-env.ts`.

Dùng DB test trong file test:

```ts
import { setupTestDb } from './helpers/db';
import { createTestClient } from './helpers/app';

setupTestDb(); // khởi động Mongo in-memory, xoá dữ liệu sau mỗi test

it('...', async () => {
  const res = await createTestClient().get('/api/v1/health');
});
```

## Kiến trúc

```
src/
  app.ts                 # tạo Express app (không listen): helmet, CORS, body limit, sanitize, Swagger, router
  server.ts              # kết nối DB rồi listen, graceful shutdown (utils/gracefulShutdown.ts)
  routes.ts              # router /api/v1: /health, /auth, /admin/* (authenticate), /public/* (rate limit)
  config/                # env (zod), database, swagger*.ts (schema OpenAPI dùng chung)
  middlewares/           # validate (zod), sanitize (NoSQL injection), rateLimit, authenticate, errorHandler...
  utils/                 # AppError, response, pagination, logger, openingHours, zonedDate, gracefulShutdown
  scripts/               # seed-admin, seed-demo, export-openapi
  modules/<module>/
    <module>.model.ts       # Mongoose model
    <module>.schema.ts      # zod schema cho request
    <module>.service.ts     # nghiệp vụ
    <module>.controller.ts  # xử lý request/response
    <module>.routes.ts      # khai báo route + comment @openapi
tests/
  setup-env.ts           # biến môi trường cho test
  helpers/               # db (mongodb-memory-server), app (supertest), auth
docs/openapi.json        # spec OpenAPI xuất sẵn cho frontend
```

| Module            | Trách nhiệm                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `health`          | Kiểm tra server + kết nối DB                                                                                     |
| `auth`, `users`   | Đăng nhập JWT (access + refresh xoay vòng), quản lý tài khoản nhân viên (không phân quyền)                       |
| `settings`        | Cài đặt nhà hàng singleton: thông tin, giờ mở cửa, VAT/phí, cấu hình gọi món, phương thức thanh toán             |
| `areas`, `tables` | Khu vực, bàn, trạng thái bàn, mã QR (PNG/SVG/ZIP), resolve QR cho khách                                          |
| `menu`, `uploads` | Danh mục, món (lựa chọn, còn/hết món), thực đơn công khai; upload ảnh Cloudinary                                 |
| `sessions`        | Phiên bàn của khách (`X-Session-Token`), mỗi bàn tối đa 1 phiên chưa đóng                                        |
| `orders`          | Đặt món/quote/huỷ của khách, điều phối đơn cho nhân viên/bếp, state machine, `pricing.ts` (tính tiền dùng chung) |
| `serviceRequests` | Yêu cầu nhanh tại bàn (gọi nhân viên, xin nước, xin thanh toán...)                                               |
| `payments`        | Hoá đơn, ghi nhận thanh toán thủ công, đóng/chuyển/huỷ phiên                                                     |
| `dashboard`       | Báo cáo: doanh thu, đơn, món bán chạy, phương thức thanh toán (giờ Asia/Ho_Chi_Minh)                             |

Phụ thuộc giữa module đi một chiều qua service (vd. `orders` → `settings.getPricingConfig()`, `payments` → `orders/pricing.ts`, `sessions` → `tables.setTableStatus()`); controller không gọi model của module khác.

## Danh sách endpoint

Tiền tố chung `/api/v1`. Chi tiết request/response: Swagger UI hoặc `docs/openapi.json`.

**Công khai** (không cần đăng nhập)

| Method | Path                                     | Mô tả                                               |
| ------ | ---------------------------------------- | --------------------------------------------------- |
| GET    | `/health`                                | Health check                                        |
| POST   | `/auth/login`, `/auth/refresh`           | Đăng nhập, làm mới token (rate limit đăng nhập sai) |
| POST   | `/auth/logout`                           | Thu hồi refresh token                               |
| GET    | `/public/restaurant`                     | Thông tin nhà hàng, `isOpenNow`, `canOrderNow`      |
| GET    | `/public/tables/resolve/:qrToken`        | Khách quét QR → bàn + nhà hàng                      |
| GET    | `/public/menu`, `/public/menu-items/:id` | Thực đơn (lọc `search`, `category`, `tag`)          |
| POST   | `/public/sessions`                       | Mở / tham gia phiên bàn → `sessionToken`            |

**Khách đã mở phiên** (header `X-Session-Token`)

| Method    | Path                                     | Mô tả                                         |
| --------- | ---------------------------------------- | --------------------------------------------- |
| GET/PATCH | `/public/sessions/current`               | Xem / cập nhật phiên (số khách, tên, ghi chú) |
| GET       | `/public/sessions/current/orders`        | Đơn của phiên (`updatedSince` để polling)     |
| POST      | `/public/sessions/current/request-bill`  | Yêu cầu thanh toán                            |
| GET       | `/public/sessions/current/bill`          | Hoá đơn tạm tính                              |
| POST      | `/public/orders/quote`, `/public/orders` | Báo giá giỏ hàng, đặt món                     |
| POST      | `/public/orders/:id/cancel`              | Huỷ đơn còn `pending`                         |
| GET/POST  | `/public/service-requests`               | Yêu cầu nhanh tại bàn                         |

**Quản trị** (header `Authorization: Bearer <accessToken>`, mọi tài khoản toàn quyền)

| Nhóm               | Endpoint                                                                                                                                                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tài khoản          | `GET /auth/me`, `PATCH /auth/me/password`, `GET/POST /admin/users`, `GET/PATCH/DELETE /admin/users/:id`                                                                                                                                                                                                          |
| Cài đặt            | `GET/PUT/PATCH /admin/settings`                                                                                                                                                                                                                                                                                  |
| Khu vực & bàn      | `CRUD /admin/areas`, `CRUD /admin/tables`, `GET /admin/tables/stats`, `PATCH /admin/tables/:id/status`, `GET /admin/tables/:id/qr`, `POST /admin/tables/:id/qr/regenerate`, `GET /admin/tables/qr/export`                                                                                                        |
| Thực đơn           | `CRUD /admin/categories` (+ `PATCH /reorder`), `CRUD /admin/menu-items` (+ `GET /stats`, `PATCH /reorder`, `PATCH /:id/availability`), `POST /admin/uploads`, `DELETE /admin/uploads/:publicId`                                                                                                                  |
| Đơn hàng           | `GET /admin/orders`, `GET /admin/orders/board`, `GET /admin/orders/:id`, `PATCH /admin/orders/:id/status`, `PATCH /admin/orders/:id/items/:itemId`, `POST /admin/tables/:id/orders`                                                                                                                              |
| Yêu cầu nhanh      | `GET /admin/service-requests`, `PATCH /admin/service-requests/:id`                                                                                                                                                                                                                                               |
| Thanh toán & phiên | `GET /admin/sessions`, `GET/PATCH /admin/sessions/:id`, `GET /admin/tables/:id/bill`, `GET /admin/sessions/:id/bill`, `POST /admin/sessions/:id/payments`, `POST /admin/sessions/:id/move`, `POST /admin/sessions/:id/cancel`, `GET /admin/payments`, `GET /admin/payments/:id`, `POST /admin/payments/:id/void` |
| Dashboard          | `GET /admin/dashboard/summary`, `/revenue`, `/top-items`, `/recent-orders`, `/payment-methods`                                                                                                                                                                                                                   |

## Luồng trạng thái

**Phiên bàn & bàn**

```
Khách quét QR ──POST /public/sessions──► phiên open            bàn available → occupied
   khách gọi món, nhân viên phục vụ (có thể chuyển bàn: POST /admin/sessions/:id/move)
Khách yêu cầu thanh toán ─────────────► phiên payment_requested bàn → needs_payment (không gọi thêm món)
Nhân viên thu tiền (POST .../payments)► phiên closed (paid)     bàn → available, yêu cầu nhanh → done
Nhân viên huỷ phiên trống (.../cancel)► phiên closed (cancelled) bàn → available
Phiên trống bỏ quên quá timeout ───────► phiên closed (expired)   bàn → available (job tự động)
```

Mỗi bàn tối đa một phiên chưa đóng; khách khác quét cùng QR dùng chung phiên (cả khi `payment_requested`). Token phiên đã đóng → `401 SESSION_CLOSED`, quét lại QR để mở phiên mới. `reserved` là trạng thái bàn tuỳ chọn.

**Đơn hàng**

```
pending ──► confirmed ──► preparing ──► ready ──► served
   │            │
   └────────────┴──► cancelled (nhân viên huỷ cần reason; khách chỉ huỷ được khi pending)
```

Nếu `settings.ordering.requireStaffConfirm = false`, đơn khách tạo ra ở `confirmed` luôn; đơn do nhân viên tạo luôn `confirmed`. Món trong đơn có `itemStatus` riêng, chỉ tiến lên hoặc huỷ (huỷ hết món → đơn `cancelled`). Thu tiền khi còn đơn `pending/confirmed/preparing` → `409 UNFINISHED_ORDERS` (trừ khi `force: true`).

**Yêu cầu nhanh**: `pending → acknowledged → done` (hoặc `pending → done`); đóng phiên tự chuyển mọi yêu cầu còn mở sang `done`.

## Hướng dẫn polling cho frontend

API không có WebSocket; frontend polling định kỳ với `updatedSince` để chỉ nhận dữ liệu thay đổi:

1. Lần đầu gọi **không** có `updatedSince` → nhận toàn bộ danh sách + `meta.serverTime`.
2. Các lần sau gửi `updatedSince=<meta.serverTime của lần trước>` (ISO 8601, nhớ `encodeURIComponent`) → chỉ nhận bản ghi có `updatedAt` sau mốc đó; gộp vào state theo `id`. Luôn dùng `serverTime` của server, không dùng đồng hồ máy khách.
3. Khi tab bị ẩn (`document.visibilityState === 'hidden'`) thì giãn chu kỳ hoặc dừng; quay lại thì gọi ngay một lần.

| Màn hình                    | Endpoint                                                                   | Chu kỳ đề xuất |
| --------------------------- | -------------------------------------------------------------------------- | -------------- |
| Khách theo dõi đơn          | `GET /public/sessions/current/orders?updatedSince=`                        | 5–10 giây      |
| Khách xem phiên/hoá đơn     | `GET /public/sessions/current` (phát hiện `closed` → `401 SESSION_CLOSED`) | 15–30 giây     |
| Live Orders (nhân viên/bếp) | `GET /admin/orders?status=pending,confirmed,preparing,ready&updatedSince=` | 3–5 giây       |
| Yêu cầu nhanh tại bàn       | `GET /admin/service-requests?status=pending,acknowledged&updatedSince=`    | 5 giây         |
| Sơ đồ bàn                   | `GET /admin/tables/stats`, `GET /admin/tables`                             | 10–15 giây     |
| Dashboard                   | `GET /admin/dashboard/*`                                                   | 30–60 giây     |

Rate limit `/public` mặc định 600 request/phút/IP (khách cùng Wi-Fi dùng chung IP) — với chu kỳ 5 giây mỗi thiết bị tốn 12 request/phút. Khi nhận `429`, đợi theo header `Retry-After` rồi tiếp tục. Đơn bị đổi trạng thái/huỷ cũng cập nhật `updatedAt` nên sẽ có trong kết quả polling.

## Bảo mật

- `helmet` (CSP, nosniff, HSTS...; `Cross-Origin-Resource-Policy: cross-origin` để frontend nhúng ảnh QR). Swagger UI nới CSP riêng tại `/api/docs`.
- CORS cho phép mọi origin (phản chiếu `Origin`, có `credentials`) — dự án học tập nên không giới hạn domain. Header cho phép: `Content-Type`, `Authorization`, `X-Session-Token`; frontend đọc được `RateLimit`, `Retry-After`, `Content-Disposition`.
- Rate limit: `/public/*` theo IP; thao tác ghi của khách theo phiên bàn; đăng nhập sai theo IP.
- Giới hạn body JSON/form `100kb` (`413 PAYLOAD_TOO_LARGE`); upload ảnh tối đa 5MB.
- Chống NoSQL injection: middleware `sanitize` loại key bắt đầu bằng `$` hoặc chứa `.` khỏi body/query (tự viết vì `express-mongo-sanitize` không chạy với Express 5), cộng với zod validate mọi input và `mongoose.set('strictQuery', true)`.
- Graceful shutdown: SIGINT/SIGTERM → ngừng nhận kết nối, đóng keep-alive rảnh, đợi request đang chạy (tối đa 10 giây, sau đó đóng cưỡng bức) rồi ngắt MongoDB; `unhandledRejection`/`uncaughtException` cũng tắt an toàn với mã 1.

## Quy ước API

Thành công:

```json
{ "success": true, "data": {}, "meta": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 } }
```

Lỗi:

```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "Dữ liệu không hợp lệ", "details": [] }
}
```

- Ném lỗi nghiệp vụ bằng `AppError` (ví dụ `throw AppError.notFound('Không tìm thấy món')`); Express 5 tự bắt lỗi từ handler async.
- Validate request: `router.post('/', validate({ body: createSchema, query, params }), controller)`.
- Phân trang: `paginationQuerySchema` + `getPaginationOptions(req.query, { allowedSortFields })` + `buildPaginationMeta(total, page, limit)`; sort dạng `?sort=-createdAt,name`.
- Xác thực: `POST /api/v1/auth/login` → `accessToken` (Bearer, `JWT_ACCESS_EXPIRES`) + `refreshToken` (`JWT_REFRESH_EXPIRES`). Refresh token xoay vòng (dùng 1 lần), DB chỉ lưu SHA-256 (collection `refreshtokens`).
- **Không phân quyền theo vai trò**: mọi route dưới `/api/v1/admin/*` đều qua middleware `authenticate` (đăng ký sẵn trong `src/routes.ts`), mọi tài khoản đăng nhập đều có toàn quyền. Route cho khách đặt dưới `/api/v1/public/*` (không cần đăng nhập). Lấy user hiện tại trong controller: `getAuthUser(req)`.
- Tài liệu API: thêm comment `@openapi` trong `*.routes.ts`, Swagger tự quét; `finalizeSpec()` (`src/config/swagger.ts`) tự bổ sung `bearerAuth` + 401 cho `/admin/*`, 429 cho `/public/*`, 413 cho route có body. Sau đó chạy `npm run docs:openapi`.
- Cài đặt nhà hàng (singleton, tự tạo mặc định): `GET/PUT/PATCH /api/v1/admin/settings`, công khai `GET /api/v1/public/restaurant` (kèm `isOpenNow`, `ordering.canOrderNow`, múi giờ `Asia/Ho_Chi_Minh`). Module khác đọc cấu hình qua `settings.service.ts` (`getPricingConfig()`, `getSettings()`, `canOrderAt()`), tiện ích giờ mở cửa ở `src/utils/openingHours.ts`.
- Khu vực & bàn: `CRUD /api/v1/admin/areas` (xoá khu vực còn bàn → `409 AREA_HAS_TABLES`), `CRUD /api/v1/admin/tables` (lọc `areaId` — `none` = chưa gán khu vực —, `status`, `isActive`, `search`), thống kê đầu màn hình `GET /api/v1/admin/tables/stats` (`total`, `occupied` = đang phục vụ, `available` = trống, `needsPayment` = chờ thanh toán, `reserved`, `inactive`). Trạng thái bàn (`available | occupied | needs_payment | reserved`) không sửa qua `PATCH /admin/tables/:id` — `occupied`/`needs_payment` do module phiên bàn gọi `setTableStatus()` trong `table.service.ts`.
- Đặt bàn trước: `PATCH /api/v1/admin/tables/:id/status` `{ status: 'reserved' | 'available', reservationNote? }` (`reservationNote` ≤ 200 ký tự, chỉ khi `reserved`; về `available` → `null`). Chỉ đổi được khi bàn đang `available`/`reserved` và không có phiên chưa đóng → ngược lại `409 TABLE_IN_USE`; bàn đã tắt → `409 TABLE_INACTIVE`. Cập nhật có điều kiện theo trạng thái cũ nên an toàn khi khách quét QR cùng lúc. Khách vẫn mở phiên được trên bàn `reserved` (bàn → `occupied`, ghi chú đặt bàn bị xoá). `tables` chỉ đọc `sessions/tableSession.model.ts` và `orders/order.model.ts` (file lá) để kiểm tra/hiển thị phiên — không gọi service của `sessions`.
- Phiên hiện tại của bàn: DTO của `GET /admin/tables` và `GET /admin/tables/:id` có `currentSession` = `null` hoặc `{ id, status, guestCount, openedAt, paymentRequestedAt, orderCount }` (`orderCount` không tính đơn huỷ) — lấy bằng một aggregation cho cả trang, màn sơ đồ bàn không cần gọi bill từng bàn.

### Mã QR gọi món tại bàn

- Mỗi bàn có `qrToken` ngẫu nhiên 192 bit (base64url, 32 ký tự, unique). Nội dung QR: `${CLIENT_URL}/t/${qrToken}` (trường `qrUrl` trong response bàn).
- Ảnh QR một bàn: `GET /api/v1/admin/tables/:id/qr?format=png|svg&size=512` (`size` 64–2048 px, `download=true` để tải file). Header `Cache-Control: no-store`.
- Sinh lại QR: `POST /api/v1/admin/tables/:id/qr/regenerate` → token cũ (QR đã in) lập tức không dùng được.
- **Xuất hàng loạt để in: định dạng ZIP** — `GET /api/v1/admin/tables/qr/export` trả `application/zip` chứa các ảnh PNG đặt tên `<mã bàn>.png` (ví dụ `B08.png`). Mặc định xuất mọi bàn đang hoạt động; lọc bằng `areaId=...` hoặc `ids=id1,id2`; `includeInactive=true` để lấy cả bàn đã tắt; `size` như trên; tối đa 500 bàn/lần. (Chọn ZIP thay vì PDF vì PDF cần nhúng font tiếng Việt và cố định bố cục in; ZIP PNG cho phép frontend/nhà in tự dàn trang.)
- Khách quét QR: `GET /api/v1/public/tables/resolve/:qrToken` → `{ table: { id, code, name, area }, restaurant }` (`restaurant` giống `GET /public/restaurant`); `404 TABLE_NOT_FOUND` nếu token sai, đã bị regenerate hoặc bàn đã tắt.

### Điều phối đơn (Live Orders) & yêu cầu nhanh tại bàn

- Nhân viên/bếp (cần đăng nhập): `GET /api/v1/admin/orders` (lọc `status=pending,confirmed` nhiều giá trị, `tableId`, `areaId`, `dateFrom`/`dateTo` theo ngày kinh doanh `YYYY-MM-DD`, `search` theo mã đơn; phân trang; `updatedSince` để polling — gửi lại `meta.serverTime` của lần trước), `GET /admin/orders/board?date=&areaId=&tableId=` (cột pending/confirmed/preparing/ready/served trong ngày + `counts`), `GET /admin/orders/:id`.
- State machine (`src/modules/orders/orderStatus.ts`): `pending → confirmed | cancelled`, `confirmed → preparing | cancelled`, `preparing → ready`, `ready → served`. `PATCH /admin/orders/:id/status` body `{ status, reason }` — huỷ bắt buộc `reason`; sai bước → `409 INVALID_STATUS_TRANSITION` (`details: { from, to, allowed }`). Mỗi lần chuyển ghi `statusHistory` kèm nhân viên (`byUser`).
- `PATCH /admin/orders/:id/items/:itemId` body `{ itemStatus?, markSoldOut?, reason? }`: món chỉ tiến lên hoặc bị huỷ; huỷ món tính lại `subtotal`; `markSoldOut` huỷ món ("Hết món") và đặt món trong thực đơn hết; huỷ hết mọi món → đơn tự `cancelled`.
- Nhân viên tạo đơn thay khách: `POST /admin/tables/:id/orders` (tự mở phiên nếu bàn chưa có, đơn ở `confirmed`, không bị chặn bởi giờ mở cửa).
- Yêu cầu nhanh: khách `POST/GET /api/v1/public/service-requests` (header `X-Session-Token`; loại `call_staff | request_water | request_utensils | request_bill | other`; trùng loại đang `pending` → `409 SERVICE_REQUEST_DUPLICATE`). Nhân viên `GET /admin/service-requests` (lọc `status`, `type`, `tableId`, `areaId`, `updatedSince`), `PATCH /admin/service-requests/:id` body `{ status: 'acknowledged' | 'done' }`.

### Thanh toán & đóng phiên bàn

Thanh toán chỉ **ghi nhận thủ công** (không tích hợp cổng thanh toán).

- Khách: `POST /api/v1/public/sessions/current/request-bill` `{ preferredMethod? }` → phiên `payment_requested` (không gọi thêm món), bàn `needs_payment`, tạo `ServiceRequest` loại `request_bill` (gọi lại không tạo trùng). `GET /api/v1/public/sessions/current/bill` → hoá đơn tạm tính (món, subtotal, phí phục vụ, VAT, tổng, `bankTransfer` khi bật chuyển khoản).
- Nhân viên: `GET /api/v1/admin/tables/:id/bill` hoặc `/admin/sessions/:id/bill`; thu tiền `POST /api/v1/admin/sessions/:id/payments` `{ method, amountReceived?, discountAmount?, discountReason?, note?, force? }` → tạo `Payment`, phiên `closed` (token cũ bị từ chối `401 SESSION_CLOSED`), bàn `available`, yêu cầu phục vụ còn mở → `done`. Còn đơn `pending/confirmed/preparing` → `409 UNFINISHED_ORDERS` trừ khi `force=true`.
- Cách tính: phí phục vụ = subtotal × %, VAT = (subtotal + phí) × %, làm tròn từng khoản (VND tới 1 đồng); giảm giá trừ vào tổng sau VAT/phí (`calculateBillTotals` trong `src/modules/orders/pricing.ts`). Món/đơn đã huỷ không tính.
- Danh sách phiên: `GET /admin/sessions?status=open,payment_requested&tableId=&areaId=&from=YYYY-MM-DD&to=&closeReason=paid|cancelled|expired` (mặc định phiên chưa đóng; có `closeReason` mà không có `status` → `closed`; `from`/`to` theo ngày mở phiên giờ VN; phân trang, sort `openedAt|closedAt|createdAt|updatedAt`, mặc định `-openedAt`). Mỗi phiên: bàn, trạng thái, số khách, tên, ghi chú, các mốc thời gian, `closeReason`, `closedBy { id, fullName }`, `orderCount` + `subtotal` (không tính đơn huỷ, tính theo lô bằng aggregation). **Không bao giờ trả `sessionToken`.** Chi tiết `GET /admin/sessions/:id` thêm `orders` (DTO đơn admin, kể cả đơn huỷ), `payment` (nếu đã thu) và `bill` (hoá đơn tạm tính, chỉ khi phiên chưa đóng). Nhân viên sửa số khách/tên/ghi chú: `PATCH /admin/sessions/:id` (cùng body với `PATCH /public/sessions/current`; phiên đóng → `409 SESSION_CLOSED`). Code nằm trong `payments/adminSession.*` (payments đã phụ thuộc sessions/orders → giữ phụ thuộc một chiều).
- Chuyển bàn `POST /admin/sessions/:id/move` `{ toTableId }` (bàn đích phải `available`), huỷ phiên trống `POST /admin/sessions/:id/cancel`. Lịch sử: `GET /admin/payments?from=YYYY-MM-DD&to=&method=&tableId=&status=completed|voided|all` (lọc theo ngày kinh doanh giờ VN, mặc định `status=completed`, `meta.summary` tổng theo phương thức theo đúng bộ lọc).
- Huỷ thanh toán ghi nhầm: `POST /admin/payments/:id/void` `{ reason (bắt buộc, ≤300), reopenSession? = true }` → bản ghi giữ lại với `status=voided`, `voidedAt`, `voidedBy`, `voidReason` và **không còn tính vào doanh thu** (dashboard summary/revenue/payment-methods, `/admin/payments` mặc định). Với `reopenSession=true`: phiên → `payment_requested` (mở lại, token cũ của khách dùng lại được), bàn → `needs_payment`, rồi thu lại bằng `POST /admin/sessions/:id/payments` (tạo bản ghi completed mới). Bàn đã có phiên khác đang mở → `409 TABLE_HAS_ACTIVE_SESSION` (không void; gửi `reopenSession=false` để chỉ huỷ). Huỷ lần 2 → `409 PAYMENT_ALREADY_VOIDED`. Mọi truy vấn doanh thu dùng `COUNTED_PAYMENT_FILTER` (`status ≠ voided`) trong `payment.model.ts`.
- **Nâng cấp DB cũ (migration index Payment):** ràng buộc "mỗi phiên một thanh toán" đổi từ unique `sessionId_1` sang unique một phần `sessionId_completed_unique` (`partialFilterExpression: { status: 'completed' }`). `migratePaymentIndexes()` (gọi tự động khi server khởi động, idempotent) gán `status: 'completed'` cho bản ghi cũ, tạo index mới rồi `syncIndexes()` drop `sessionId_1`. Nếu tắt bước này, cần chạy tay trong mongosh: `db.payments.updateMany({ status: { $exists: false } }, { $set: { status: 'completed' } })` rồi `db.payments.dropIndex('sessionId_1')` — nếu không, index cũ vẫn chặn thu lại sau khi void (`409 SESSION_ALREADY_PAID`).
- Tự đóng phiên trống bị bỏ quên (khách quét QR rồi bỏ đi): job trong `src/server.ts` (không chạy trong `createApp()`/test) mỗi 5 phút gọi `expireEmptySessions(now)` (`payment.service.ts`). Phiên bị đóng khi: `status = open` (không đụng `payment_requested`), không có đơn nào khác `cancelled`, và `openedAt`, `updatedAt` của phiên cũng như của mọi đơn đều cũ hơn `EMPTY_SESSION_TIMEOUT_MINUTES` (mặc định 120, `0` = tắt). Kết quả: `closeReason: expired`, `closedBy: null`, bàn → `available`, yêu cầu nhanh còn mở → `done`; token khách cũ → `401 SESSION_CLOSED`. Khách đặt món đúng lúc đóng → phiên được mở lại. Lỗi job chỉ ghi log; graceful shutdown dừng job trước khi ngắt DB.

### Tổng quan quản trị (dashboard)

Tất cả dưới `/api/v1/admin/dashboard` (cần đăng nhập). Ngày dạng `YYYY-MM-DD` theo giờ **Asia/Ho_Chi_Minh**; `from`/`to` gồm cả hai đầu, mặc định hôm nay.

- `GET /summary?date=` — doanh thu (tổng `Payment.total` của ngày, không tính thanh toán đã huỷ/void) và % so với hôm qua, số đơn (không tính đơn huỷ), giá trị TB/hoá đơn, bàn đang phục vụ/tổng bàn, thời gian phục vụ TB (`confirmed` đầu tiên → `served` cuối cùng trong `statusHistory`), yêu cầu/đơn đang chờ. `tables` và `pending` là trạng thái hiện tại. `changePercent = null` khi kỳ trước = 0.
- `GET /revenue?from=&to=&groupBy=hour|day|month` — chuỗi doanh thu, số hoá đơn, số khách (guestCount của phiên; không khai báo tính 1), mốc trống điền 0. Giới hạn: hour ≤ 31 ngày, day ≤ 366 ngày, month ≤ 5 năm.
- `GET /top-items?from=&to=&limit=` — món bán chạy theo số lượng (doanh thu = tổng `lineTotal`, chưa VAT/phí/giảm giá; bỏ đơn/món huỷ).
- `GET /recent-orders?limit=` — đơn mới nhất (định dạng như `/admin/orders`).
- `GET /payment-methods?from=&to=` — số tiền, số hoá đơn và % theo từng phương thức.
