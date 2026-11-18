import path from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';
import { menuSchemas } from './swagger.menu';
import { dashboardSchemas } from './swagger.dashboard';
import { paymentSchemas } from './swagger.payments';
import {
  guestOrderResponses,
  guestOrderSchemas,
  guestOrderSecuritySchemes,
} from './swagger.orders';
import { staffSchemas } from './swagger.staff';

const nullableString = (example?: string) => ({ type: 'string', nullable: true, example });

const imageSchema = {
  type: 'object',
  nullable: true,
  description: 'Ảnh đã upload lên Cloudinary',
  required: ['url'],
  properties: {
    url: { type: 'string', format: 'uri', example: 'https://res.cloudinary.com/demo/logo.png' },
    publicId: nullableString('restaurant/logo'),
  },
};

/** Field chung cho body PUT/PATCH và response của cài đặt nhà hàng. */
const restaurantSettingsProperties = {
  name: { type: 'string', maxLength: 150, example: 'Quán Ngon' },
  slogan: { ...nullableString('Hương vị Việt'), maxLength: 200 },
  description: { ...nullableString(), maxLength: 2000 },
  logo: imageSchema,
  coverImage: imageSchema,
  address: { ...nullableString('123 Lê Lợi, Q.1, TP.HCM'), maxLength: 300 },
  phone: nullableString('0901234567'),
  email: { ...nullableString('lienhe@quanngon.vn'), format: 'email' },
  wifi: {
    type: 'object',
    nullable: true,
    required: ['ssid'],
    properties: {
      ssid: { type: 'string', example: 'QuanNgon' },
      password: nullableString('12345678'),
    },
  },
  openingHours: {
    type: 'array',
    maxItems: 7,
    items: { $ref: '#/components/schemas/DayOpeningHours' },
  },
  currency: { type: 'string', pattern: '^[A-Z]{3}$', default: 'VND' },
  vatPercent: { type: 'number', minimum: 0, maximum: 100, default: 0, example: 8 },
  serviceChargePercent: { type: 'number', minimum: 0, maximum: 100, default: 0, example: 5 },
  ordering: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true, description: 'Cho phép khách đặt món qua QR' },
      requireStaffConfirm: {
        type: 'boolean',
        default: true,
        description: 'Đơn của khách cần nhân viên xác nhận',
      },
      allowOrderOutsideOpeningHours: { type: 'boolean', default: false },
      maxItemQuantityPerOrder: {
        type: 'integer',
        minimum: 1,
        maximum: 1000,
        default: 50,
        description: 'Số lượng tối đa của một món trong một đơn',
      },
    },
  },
  paymentMethods: {
    type: 'array',
    minItems: 1,
    uniqueItems: true,
    items: { type: 'string', enum: ['cash', 'bank_transfer', 'card'] },
    default: ['cash'],
  },
  bankTransferInfo: {
    type: 'object',
    nullable: true,
    description: 'Bắt buộc khi paymentMethods có bank_transfer',
    required: ['bankName', 'accountNumber', 'accountName'],
    properties: {
      bankName: { type: 'string', example: 'Vietcombank' },
      accountNumber: { type: 'string', pattern: '^[0-9]{4,30}$', example: '0123456789' },
      accountName: { type: 'string', example: 'NGUYEN VAN A' },
    },
  },
};

const restaurantSchemas = {
  TimeSlot: {
    type: 'object',
    required: ['open', 'close'],
    description:
      'Khung giờ HH:mm. close có thể là 24:00; close <= open nghĩa là qua nửa đêm (vd. 18:00-02:00).',
    properties: {
      open: { type: 'string', example: '10:30' },
      close: { type: 'string', example: '14:00' },
    },
  },
  DayOpeningHours: {
    type: 'object',
    required: ['dayOfWeek'],
    properties: {
      dayOfWeek: {
        type: 'integer',
        minimum: 0,
        maximum: 6,
        description: '0 = Chủ nhật, 1 = Thứ 2, ..., 6 = Thứ 7',
      },
      slots: {
        type: 'array',
        maxItems: 6,
        description: 'Mảng rỗng = nghỉ cả ngày; các khung giờ không được chồng lấn',
        items: { $ref: '#/components/schemas/TimeSlot' },
        example: [
          { open: '10:30', close: '14:00' },
          { open: '17:30', close: '23:00' },
        ],
      },
    },
  },
  RestaurantSettingsPatch: {
    type: 'object',
    minProperties: 1,
    properties: restaurantSettingsProperties,
  },
  RestaurantSettingsInput: {
    type: 'object',
    required: ['name'],
    properties: restaurantSettingsProperties,
  },
  RestaurantSettings: {
    type: 'object',
    properties: {
      ...restaurantSettingsProperties,
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  PublicRestaurant: {
    type: 'object',
    properties: {
      ...restaurantSettingsProperties,
      logo: {
        type: 'object',
        nullable: true,
        properties: { url: { type: 'string', format: 'uri' } },
      },
      coverImage: {
        type: 'object',
        nullable: true,
        properties: { url: { type: 'string', format: 'uri' } },
      },
      timezone: { type: 'string', example: 'Asia/Ho_Chi_Minh' },
      isOpenNow: { type: 'boolean', example: true },
      ordering: {
        type: 'object',
        properties: {
          ...restaurantSettingsProperties.ordering.properties,
          canOrderNow: { type: 'boolean', example: true },
        },
      },
      bankTransferInfo: {
        ...restaurantSettingsProperties.bankTransferInfo,
        description: 'Chỉ có khi paymentMethods có bank_transfer',
      },
    },
  },
};

const tableSchemas = {
  Area: {
    type: 'object',
    properties: {
      id: { type: 'string', example: '665f1c2e8b3a4d0012345678' },
      name: { type: 'string', example: 'Tầng 1 - Sảnh chính' },
      sortOrder: { type: 'integer', example: 1 },
      tableCount: { type: 'integer', example: 12, description: 'Số bàn thuộc khu vực' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  AreaInput: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', maxLength: 100, example: 'Tầng 1 - Sảnh chính' },
      sortOrder: { type: 'integer', default: 0, description: 'Thứ tự hiển thị (tăng dần)' },
    },
  },
  TableStatus: {
    type: 'string',
    enum: ['available', 'occupied', 'needs_payment', 'reserved'],
    description:
      'available = trống, occupied = đang phục vụ, needs_payment = chờ thanh toán, reserved = đã đặt trước',
  },
  TableAreaRef: {
    type: 'object',
    nullable: true,
    properties: {
      id: { type: 'string' },
      name: { type: 'string', example: 'Tầng 1 - Sảnh chính' },
    },
  },
  Table: {
    type: 'object',
    properties: {
      id: { type: 'string', example: '665f1c2e8b3a4d0012345678' },
      code: { type: 'string', example: 'B08' },
      name: { type: 'string', example: 'Bàn 08' },
      areaId: { type: 'string', nullable: true },
      area: { $ref: '#/components/schemas/TableAreaRef' },
      capacity: { type: 'integer', example: 4 },
      isActive: { type: 'boolean', example: true },
      status: { $ref: '#/components/schemas/TableStatus' },
      qrToken: { type: 'string', example: 'q1Wm2cZ0p8yH3nVt6Ra9LbXe4KdUs7Gf' },
      qrUrl: {
        type: 'string',
        format: 'uri',
        example: 'http://localhost:3000/t/q1Wm2cZ0p8yH3nVt6Ra9LbXe4KdUs7Gf',
        description: 'Nội dung mã QR',
      },
      qrTokenUpdatedAt: { type: 'string', format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  TableStats: {
    type: 'object',
    properties: {
      total: { type: 'integer', example: 20, description: 'Tổng bàn đang hoạt động' },
      occupied: { type: 'integer', example: 8, description: 'Đang phục vụ' },
      available: { type: 'integer', example: 10, description: 'Trống' },
      needsPayment: { type: 'integer', example: 2, description: 'Chờ thanh toán' },
      reserved: { type: 'integer', example: 0 },
      inactive: { type: 'integer', example: 1, description: 'Bàn đã tắt (không tính vào total)' },
    },
  },
};

/**
 * Tài liệu OpenAPI được sinh từ các comment `@openapi` trong file *.routes.ts của từng module.
 * Các task sau chỉ cần thêm comment `@openapi` vào routes của module mới.
 */
export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Order QR API',
      version: '1.0.0',
      description: 'API đặt món qua mã QR',
    },
    servers: [{ url: '/api/v1' }],
    tags: [
      { name: 'Health' },
      { name: 'Auth', description: 'Đăng nhập JWT (access + refresh token)' },
      {
        name: 'Users',
        description: 'Quản lý tài khoản nhân viên — mọi tài khoản đăng nhập đều có toàn quyền',
      },
      { name: 'Settings', description: 'Cài đặt nhà hàng (singleton)' },
      { name: 'Restaurant', description: 'Thông tin nhà hàng công khai cho khách' },
      { name: 'Areas', description: 'Khu vực / tầng của nhà hàng' },
      { name: 'Tables', description: 'Quản lý bàn ăn và mã QR gọi món tại bàn' },
      { name: 'Public Tables', description: 'Khách quét mã QR tại bàn' },
      { name: 'Categories', description: 'Quản lý danh mục món' },
      { name: 'MenuItems', description: 'Quản lý món ăn, còn/hết món' },
      { name: 'Uploads', description: 'Upload ảnh lên Cloudinary' },
      { name: 'Menu', description: 'Thực đơn công khai cho khách' },
      { name: 'GuestSession', description: 'Phiên bàn của khách (header X-Session-Token)' },
      { name: 'GuestOrders', description: 'Giỏ hàng / đặt món / huỷ đơn của khách' },
      {
        name: 'GuestServiceRequests',
        description: 'Yêu cầu nhanh tại bàn của khách (gọi nhân viên, xin nước, ...)',
      },
      { name: 'AdminOrders', description: 'Điều phối đơn cho nhân viên/bếp (Live Orders)' },
      { name: 'ServiceRequests', description: 'Nhân viên xử lý yêu cầu nhanh tại bàn' },
      {
        name: 'Payments',
        description: 'Hoá đơn, ghi nhận thanh toán thủ công, đóng / chuyển / huỷ phiên bàn',
      },
      {
        name: 'Dashboard',
        description: 'Tổng quan quản trị: doanh thu, đơn hàng, món bán chạy (giờ Asia/Ho_Chi_Minh)',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        ...guestOrderSecuritySchemes,
      },
      responses: {
        ...guestOrderResponses,
        Unauthorized: {
          description: 'Chưa đăng nhập / token không hợp lệ hoặc hết hạn',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
        ValidationError: {
          description: 'Dữ liệu không hợp lệ',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
        NotFound: {
          description: 'Không tìm thấy',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'NOT_FOUND' },
                message: { type: 'string' },
                details: {},
              },
              required: ['code', 'message'],
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '665f1c2e8b3a4d0012345678' },
            fullName: { type: 'string', example: 'Nguyễn Văn A' },
            email: { type: 'string', format: 'email', example: 'nhanvien@example.com' },
            isActive: { type: 'boolean', example: true },
            lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        AuthTokens: {
          type: 'object',
          properties: {
            tokenType: { type: 'string', example: 'Bearer' },
            accessToken: { type: 'string' },
            accessTokenExpiresAt: { type: 'string', format: 'date-time' },
            refreshToken: { type: 'string' },
            refreshTokenExpiresAt: { type: 'string', format: 'date-time' },
          },
        },
        RefreshTokenBody: {
          type: 'object',
          required: ['refreshToken'],
          properties: { refreshToken: { type: 'string' } },
        },
        ...restaurantSchemas,
        ...tableSchemas,
        ...menuSchemas,
        ...guestOrderSchemas,
        ...staffSchemas,
        ...paymentSchemas,
        ...dashboardSchemas,
        PaginationMeta: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 100 },
            totalPages: { type: 'integer', example: 5 },
          },
        },
      },
    },
  },
  apis: [path.join(__dirname, '../modules/**/*.routes.{ts,js}')],
});
