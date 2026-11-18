/** Schemas OpenAPI cho phiên bàn của khách, giỏ hàng/đặt món và theo dõi đơn. */

const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'served', 'cancelled'];
const idProp = { type: 'string', example: '665f1c2e8b3a4d0012345678' };
const dateTime = { type: 'string', format: 'date-time' };
const errorContent = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
};

const priceBreakdownProps = {
  currency: { type: 'string', example: 'VND' },
  subtotal: { type: 'number', example: 200000 },
  serviceChargePercent: { type: 'number', example: 5 },
  serviceCharge: { type: 'number', example: 10000 },
  vatPercent: { type: 'number', example: 8 },
  vatAmount: {
    type: 'number',
    example: 16800,
    description: 'VAT tính trên (subtotal + phí phục vụ)',
  },
  total: { type: 'number', example: 226800 },
};

const orderLineProps = {
  menuItemId: idProp,
  nameSnapshot: { type: 'string', example: 'Phở bò tái' },
  priceSnapshot: { type: 'number', example: 60000, description: 'Giá gốc món lúc đặt' },
  quantity: { type: 'integer', example: 2 },
  selectedOptions: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        groupId: idProp,
        groupName: { type: 'string', example: 'Size' },
        optionId: idProp,
        optionName: { type: 'string', example: 'Lớn' },
        priceDelta: { type: 'number', example: 10000 },
      },
    },
  },
  unitPrice: { type: 'number', example: 70000, description: 'priceSnapshot + tổng priceDelta' },
  lineTotal: { type: 'number', example: 140000 },
  note: { type: 'string', nullable: true, example: 'Không hành' },
};

const orderLineInput = {
  type: 'object',
  required: ['menuItemId', 'quantity'],
  properties: {
    menuItemId: idProp,
    quantity: { type: 'integer', minimum: 1, example: 2 },
    optionIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'id các lựa chọn đã chọn (thuộc optionGroups của món)',
    },
    note: { type: 'string', maxLength: 300, nullable: true },
  },
};

const sessionSchema = {
  type: 'object',
  properties: {
    id: idProp,
    status: { type: 'string', enum: ['open', 'payment_requested', 'closed'] },
    guestCount: { type: 'integer', nullable: true, example: 4 },
    customerName: { type: 'string', nullable: true, example: 'Anh Nam' },
    note: { type: 'string', nullable: true },
    openedAt: dateTime,
    closedAt: { ...dateTime, nullable: true },
  },
};

export const guestOrderSecuritySchemes = {
  sessionToken: {
    type: 'apiKey',
    in: 'header',
    name: 'X-Session-Token',
    description: 'Token phiên bàn nhận từ POST /public/sessions',
  },
};

export const guestOrderResponses = {
  InvalidSession: {
    description:
      'INVALID_SESSION (thiếu/sai X-Session-Token) hoặc SESSION_CLOSED (phiên đã đóng) — client xoá token và quét lại QR',
    content: errorContent,
  },
  OrderItemsInvalid: {
    description:
      'ORDER_ITEMS_INVALID — `details` là mảng `{ index, menuItemId, code, message }`, code ∈ ITEM_NOT_FOUND | ITEM_UNAVAILABLE | INVALID_OPTIONS | QUANTITY_EXCEEDED',
    content: errorContent,
  },
  TooManyRequests: {
    description: 'TOO_MANY_REQUESTS — vượt rate limit (xem header Retry-After)',
    content: errorContent,
  },
};

export const guestOrderSchemas = {
  OpenSessionBody: {
    type: 'object',
    required: ['qrToken'],
    properties: {
      qrToken: { type: 'string', description: 'Token trong mã QR của bàn' },
      guestCount: { type: 'integer', minimum: 1, maximum: 100, example: 4 },
      customerName: { type: 'string', maxLength: 100, nullable: true },
      note: { type: 'string', maxLength: 500, nullable: true },
    },
  },
  UpdateSessionBody: {
    type: 'object',
    minProperties: 1,
    properties: {
      guestCount: { type: 'integer', minimum: 1, maximum: 100 },
      customerName: { type: 'string', maxLength: 100, nullable: true },
      note: { type: 'string', maxLength: 500, nullable: true },
    },
  },
  TableSession: sessionSchema,
  SessionTable: {
    type: 'object',
    properties: {
      id: idProp,
      code: { type: 'string', example: 'B08' },
      name: { type: 'string', example: 'Bàn 8' },
      area: {
        type: 'object',
        nullable: true,
        properties: { id: idProp, name: { type: 'string', example: 'Tầng 1' } },
      },
    },
  },
  OpenSessionResult: {
    type: 'object',
    properties: {
      sessionToken: { type: 'string', description: 'Gửi ở header X-Session-Token' },
      isNew: { type: 'boolean' },
      session: { $ref: '#/components/schemas/TableSession' },
      table: { $ref: '#/components/schemas/SessionTable' },
    },
  },
  PriceBreakdown: { type: 'object', properties: priceBreakdownProps },
  CurrentSession: {
    type: 'object',
    properties: {
      session: { $ref: '#/components/schemas/TableSession' },
      table: { $ref: '#/components/schemas/SessionTable' },
      bill: {
        type: 'object',
        description: 'Tạm tính cả phiên (không tính đơn đã huỷ)',
        properties: {
          orderCount: { type: 'integer' },
          activeOrderCount: { type: 'integer' },
          itemCount: { type: 'integer' },
          ...priceBreakdownProps,
        },
      },
    },
  },
  QuoteOrderBody: {
    type: 'object',
    required: ['items'],
    properties: { items: { type: 'array', minItems: 1, maxItems: 50, items: orderLineInput } },
  },
  CreateOrderBody: {
    type: 'object',
    required: ['items'],
    properties: {
      items: { type: 'array', minItems: 1, maxItems: 50, items: orderLineInput },
      note: { type: 'string', maxLength: 500, nullable: true },
    },
  },
  OrderQuote: {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'object', properties: orderLineProps } },
      ...priceBreakdownProps,
      canOrderNow: { type: 'boolean' },
      maxItemQuantityPerOrder: { type: 'integer', example: 50 },
    },
  },
  Order: {
    type: 'object',
    properties: {
      id: idProp,
      orderNumber: { type: 'string', example: 'ORD-0802', description: 'Đánh số lại mỗi ngày' },
      businessDate: { type: 'string', example: '2026-11-18' },
      sessionId: idProp,
      tableId: idProp,
      status: { type: 'string', enum: ORDER_STATUSES },
      canCancel: { type: 'boolean', description: 'true khi đơn còn pending' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: idProp,
            ...orderLineProps,
            itemStatus: { type: 'string', enum: ORDER_STATUSES },
          },
        },
      },
      note: { type: 'string', nullable: true },
      subtotal: { type: 'number' },
      totals: { $ref: '#/components/schemas/PriceBreakdown' },
      statusHistory: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ORDER_STATUSES },
            at: dateTime,
            by: { type: 'string', enum: ['guest', 'staff', 'system'] },
            note: { type: 'string', nullable: true },
          },
        },
      },
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  },
};
