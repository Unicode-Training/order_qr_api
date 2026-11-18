import path from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';

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
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      responses: {
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
