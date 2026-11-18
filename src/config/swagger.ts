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
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
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
