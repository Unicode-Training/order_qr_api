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

| Biến                               | Bắt buộc | Mô tả                                                                                                   | Ví dụ                                |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `PORT`                             | Không    | Cổng HTTP (mặc định `4000`)                                                                             | `4000`                               |
| `NODE_ENV`                         | Không    | `development` \| `production` \| `test` (mặc định `development`)                                        | `development`                        |
| `DATABASE_URL`                     | **Có**   | Chuỗi kết nối MongoDB (`mongodb://` hoặc `mongodb+srv://`)                                              | `mongodb://localhost:27017/order-qr` |
| `JWT_ACCESS_SECRET`                | **Có**   | Secret ký access token, tối thiểu 32 ký tự                                                              | chuỗi ngẫu nhiên                     |
| `JWT_REFRESH_SECRET`               | **Có**   | Secret ký refresh token, tối thiểu 32 ký tự                                                             | chuỗi ngẫu nhiên                     |
| `JWT_ACCESS_EXPIRES`               | Không    | Thời hạn access token (mặc định `15m`)                                                                  | `15m`                                |
| `JWT_REFRESH_EXPIRES`              | Không    | Thời hạn refresh token (mặc định `7d`)                                                                  | `7d`                                 |
| `BCRYPT_SALT_ROUNDS`               | Không    | Số vòng băm bcrypt (4-15, mặc định `10`)                                                                | `10`                                 |
| `LOGIN_RATE_LIMIT_MAX`             | Không    | Số lần đăng nhập **thất bại** tối đa / IP trong một cửa sổ (mặc định `10`)                              | `10`                                 |
| `LOGIN_RATE_LIMIT_WINDOW_MINUTES`  | Không    | Độ dài cửa sổ rate limit đăng nhập, phút (mặc định `15`)                                                | `15`                                 |
| `PUBLIC_RATE_LIMIT_WINDOW_SECONDS` | Không    | Cửa sổ rate limit cho route `/public`, giây (mặc định `60`)                                             | `60`                                 |
| `PUBLIC_RATE_LIMIT_MAX`            | Không    | Số request tối đa / IP / cửa sổ cho mọi route `/public` (mặc định `600`)                                | `600`                                |
| `PUBLIC_WRITE_RATE_LIMIT_MAX`      | Không    | Số thao tác ghi tối đa / cửa sổ: mở phiên (theo IP), quote/đặt/huỷ đơn (theo phiên bàn) (mặc định `30`) | `30`                                 |
| `SEED_ADMIN_EMAIL`                 | Seed     | Email tài khoản đầu tiên (chỉ dùng cho `npm run seed:admin`)                                            | `admin@example.com`                  |
| `SEED_ADMIN_PASSWORD`              | Seed     | Mật khẩu tài khoản đầu tiên (8-72 ký tự)                                                                | chuỗi mạnh                           |
| `SEED_ADMIN_FULLNAME`              | Không    | Họ tên tài khoản đầu tiên (mặc định `Quản trị viên`)                                                    | `Chủ quán`                           |
| `CLIENT_URL`                       | **Có**   | URL web dành cho khách, được in vào mã QR                                                               | `http://localhost:3000`              |
| `CORS_ORIGINS`                     | Không    | Danh sách origin cho phép, cách nhau bởi dấu phẩy; rỗng hoặc `*` = cho phép tất cả                      | `http://localhost:3000`              |
| `CLOUDINARY_CLOUD_NAME`            | Không    | Cloud name Cloudinary (để trống → API upload ảnh trả 503)                                               | `my-cloud`                           |
| `CLOUDINARY_API_KEY`               | Không    | API key Cloudinary                                                                                      |                                      |
| `CLOUDINARY_API_SECRET`            | Không    | API secret Cloudinary                                                                                   |                                      |
| `CLOUDINARY_FOLDER`                | Không    | Thư mục gốc chứa ảnh trên Cloudinary (mặc định `order-qr`)                                              | `order-qr`                           |

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

- Health check: `GET http://localhost:4000/api/v1/health` (trả `503` nếu mất kết nối DB)
- Swagger UI: `http://localhost:4000/api/docs` (JSON: `/api/docs.json`)

## Kiểm thử & chất lượng mã

```bash
npm test             # Vitest + supertest + mongodb-memory-server
npm run test:watch
npm run lint         # ESLint
npm run format       # Prettier (ghi file); format:check để chỉ kiểm tra
npm run typecheck
```

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

## Cấu trúc thư mục

```
src/
  app.ts                 # tạo Express app (không listen) — dùng cho server và test
  server.ts              # kết nối DB rồi listen, graceful shutdown
  routes.ts              # router /api/v1, đăng ký route các module
  config/                # env (zod), database, swagger
  middlewares/           # validate (zod), errorHandler, notFound, requestLogger
  utils/                 # AppError, response helper, pagination, logger
  modules/<module>/
    <module>.model.ts       # Mongoose model
    <module>.schema.ts      # zod schema cho request
    <module>.service.ts     # nghiệp vụ
    <module>.controller.ts  # xử lý request/response
    <module>.routes.ts      # khai báo route + comment @openapi
tests/
  setup-env.ts           # biến môi trường cho test
  helpers/               # db (mongodb-memory-server), app (supertest)
```

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
- Tài liệu API: thêm comment `@openapi` trong `*.routes.ts`, Swagger tự quét.
- Cài đặt nhà hàng (singleton, tự tạo mặc định): `GET/PUT/PATCH /api/v1/admin/settings`, công khai `GET /api/v1/public/restaurant` (kèm `isOpenNow`, `ordering.canOrderNow`, múi giờ `Asia/Ho_Chi_Minh`). Module khác đọc cấu hình qua `settings.service.ts` (`getPricingConfig()`, `getSettings()`, `canOrderAt()`), tiện ích giờ mở cửa ở `src/utils/openingHours.ts`.
- Khu vực & bàn: `CRUD /api/v1/admin/areas` (xoá khu vực còn bàn → `409 AREA_HAS_TABLES`), `CRUD /api/v1/admin/tables` (lọc `areaId` — `none` = chưa gán khu vực —, `status`, `isActive`, `search`), thống kê đầu màn hình `GET /api/v1/admin/tables/stats` (`total`, `occupied` = đang phục vụ, `available` = trống, `needsPayment` = chờ thanh toán, `reserved`, `inactive`). Trạng thái bàn (`available | occupied | needs_payment | reserved`) không sửa qua API admin — module phiên bàn gọi `setTableStatus()` trong `table.service.ts`.

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
- Chuyển bàn `POST /admin/sessions/:id/move` `{ toTableId }` (bàn đích phải `available`), huỷ phiên trống `POST /admin/sessions/:id/cancel`. Lịch sử: `GET /admin/payments?from=YYYY-MM-DD&to=&method=&tableId=` (lọc theo ngày kinh doanh giờ VN, `meta.summary` tổng theo phương thức).
