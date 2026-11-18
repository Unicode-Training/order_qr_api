/** Schemas OpenAPI cho điều phối đơn (nhân viên/bếp) và yêu cầu nhanh tại bàn. */

const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'served', 'cancelled'];
const BOARD_COLUMNS = ['pending', 'confirmed', 'preparing', 'ready', 'served'];
const SERVICE_REQUEST_TYPES = [
  'call_staff',
  'request_water',
  'request_utensils',
  'request_bill',
  'other',
];
const SERVICE_REQUEST_STATUSES = ['pending', 'acknowledged', 'done'];
const idProp = { type: 'string', example: '665f1c2e8b3a4d0012345678' };
const dateTime = { type: 'string', format: 'date-time' };
const nullableDateTime = { ...dateTime, nullable: true };
const userRef = {
  type: 'object',
  nullable: true,
  properties: { id: idProp, fullName: { type: 'string', example: 'Nguyễn Văn A' } },
};

const tableRef = {
  type: 'object',
  nullable: true,
  properties: {
    id: idProp,
    code: { type: 'string', example: 'B08' },
    name: { type: 'string', example: 'Bàn 8' },
    area: { $ref: '#/components/schemas/TableAreaRef' },
  },
};

const guestServiceRequestProps = {
  id: idProp,
  type: { type: 'string', enum: SERVICE_REQUEST_TYPES },
  note: { type: 'string', nullable: true, example: 'Thêm 2 ly đá' },
  status: { type: 'string', enum: SERVICE_REQUEST_STATUSES },
  acknowledgedAt: nullableDateTime,
  doneAt: nullableDateTime,
  createdAt: dateTime,
  updatedAt: dateTime,
};

export const staffSchemas = {
  PollingPaginationMeta: {
    type: 'object',
    properties: {
      page: { type: 'integer', example: 1 },
      limit: { type: 'integer', example: 20 },
      total: { type: 'integer', example: 100 },
      totalPages: { type: 'integer', example: 5 },
      serverTime: {
        ...dateTime,
        description: 'Thời điểm server — gửi lại làm `updatedSince` ở lần polling sau',
      },
    },
  },
  AdminOrder: {
    description:
      'Đơn hàng (góc nhìn nhân viên) — gồm mọi field của Order, thêm thông tin bàn và người thao tác',
    allOf: [
      { $ref: '#/components/schemas/Order' },
      {
        type: 'object',
        properties: {
          table: tableRef,
          allowedNextStatuses: {
            type: 'array',
            items: { type: 'string', enum: ORDER_STATUSES },
            description: 'Trạng thái có thể chuyển tiếp theo state machine',
            example: ['confirmed', 'cancelled'],
          },
          statusHistory: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ORDER_STATUSES },
                at: dateTime,
                by: { type: 'string', enum: ['guest', 'staff', 'system'] },
                byUser: { ...userRef, description: 'Nhân viên thao tác (khi by = staff)' },
                note: { type: 'string', nullable: true, example: 'Khách đổi ý' },
              },
            },
          },
        },
      },
    ],
  },
  OrderBoard: {
    type: 'object',
    properties: {
      date: { type: 'string', example: '2026-11-18', description: 'Ngày kinh doanh' },
      serverTime: dateTime,
      columns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: BOARD_COLUMNS },
            count: { type: 'integer', example: 3 },
            orders: { type: 'array', items: { $ref: '#/components/schemas/AdminOrder' } },
          },
        },
      },
      counts: {
        type: 'object',
        properties: {
          pending: { type: 'integer' },
          confirmed: { type: 'integer' },
          preparing: { type: 'integer' },
          ready: { type: 'integer' },
          served: { type: 'integer' },
          cancelled: { type: 'integer' },
          total: { type: 'integer' },
        },
      },
    },
  },
  UpdateOrderStatusBody: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ORDER_STATUSES },
      reason: {
        type: 'string',
        maxLength: 300,
        nullable: true,
        description: 'Bắt buộc khi status = cancelled',
      },
    },
  },
  UpdateOrderItemBody: {
    type: 'object',
    description: 'Cần `itemStatus` hoặc `markSoldOut: true`',
    properties: {
      itemStatus: { type: 'string', enum: ['preparing', 'ready', 'served', 'cancelled'] },
      markSoldOut: {
        type: 'boolean',
        description: 'Huỷ món vì hết món + đặt món trong thực đơn isAvailable=false',
      },
      reason: {
        type: 'string',
        maxLength: 300,
        nullable: true,
        description: 'Bắt buộc khi itemStatus = cancelled (mặc định "Hết món" khi markSoldOut)',
      },
    },
  },
  CreateServiceRequestBody: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', enum: SERVICE_REQUEST_TYPES },
      note: { type: 'string', maxLength: 300, nullable: true },
    },
  },
  GuestServiceRequest: { type: 'object', properties: guestServiceRequestProps },
  ServiceRequest: {
    type: 'object',
    properties: {
      ...guestServiceRequestProps,
      sessionId: idProp,
      tableId: idProp,
      table: tableRef,
      handledBy: { ...userRef, description: 'Nhân viên xử lý gần nhất' },
    },
  },
};
