/** Schemas OpenAPI cho hoá đơn, thanh toán, đóng/chuyển/huỷ phiên bàn. */

const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'served', 'cancelled'];
const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card'];
const idProp = { type: 'string', example: '665f1c2e8b3a4d0012345678' };
const dateTime = { type: 'string', format: 'date-time' };

const billOrderRef = {
  type: 'object',
  properties: {
    id: idProp,
    orderNumber: { type: 'string', example: 'ORD-0012' },
    status: { type: 'string', enum: ORDER_STATUSES },
    createdAt: dateTime,
  },
};

const tableRef = {
  type: 'object',
  properties: {
    id: idProp,
    code: { type: 'string', example: 'B08' },
    status: { $ref: '#/components/schemas/TableStatus' },
  },
};

export const paymentSchemas = {
  BillItem: {
    type: 'object',
    properties: {
      orderId: idProp,
      orderNumber: { type: 'string', example: 'ORD-0012' },
      itemId: idProp,
      name: { type: 'string', example: 'Phở bò tái' },
      options: { type: 'array', items: { type: 'string' }, example: ['Lớn'] },
      quantity: { type: 'integer', example: 2 },
      unitPrice: { type: 'number', example: 70000 },
      lineTotal: { type: 'number', example: 140000 },
      note: { type: 'string', nullable: true },
      itemStatus: { type: 'string', enum: ORDER_STATUSES },
    },
  },
  BillOrderRef: billOrderRef,
  Bill: {
    type: 'object',
    description:
      'Hoá đơn tạm tính: gộp mọi đơn không bị huỷ (bỏ món đã huỷ). Phí phục vụ = subtotal × %, VAT = (subtotal + phí) × %, làm tròn từng khoản.',
    properties: {
      sessionId: idProp,
      sessionStatus: { type: 'string', enum: ['open', 'payment_requested', 'closed'] },
      table: {
        type: 'object',
        properties: {
          id: idProp,
          code: { type: 'string', example: 'B08' },
          name: { type: 'string', example: 'Bàn 08' },
        },
      },
      openedAt: dateTime,
      guestCount: { type: 'integer', nullable: true, example: 4 },
      preferredPaymentMethod: { type: 'string', nullable: true, enum: [...PAYMENT_METHODS, null] },
      paymentRequestedAt: { ...dateTime, nullable: true },
      orders: { type: 'array', items: billOrderRef },
      items: { type: 'array', items: { $ref: '#/components/schemas/BillItem' } },
      itemCount: { type: 'integer', example: 5 },
      unfinishedOrders: {
        type: 'array',
        items: billOrderRef,
        description: 'Đơn còn pending/confirmed/preparing — chặn thu tiền nếu không force',
      },
      currency: { type: 'string', example: 'VND' },
      subtotal: { type: 'number', example: 200000 },
      serviceChargePercent: { type: 'number', example: 5 },
      serviceCharge: { type: 'number', example: 10000 },
      vatPercent: { type: 'number', example: 8 },
      vatAmount: { type: 'number', example: 16800 },
      totalBeforeDiscount: { type: 'number', example: 226800 },
      discountAmount: { type: 'number', example: 0 },
      total: { type: 'number', example: 226800 },
      paymentMethods: { type: 'array', items: { type: 'string', enum: PAYMENT_METHODS } },
      bankTransfer: {
        type: 'object',
        nullable: true,
        description: 'Chỉ có khi nhà hàng bật bank_transfer',
        properties: {
          bankName: { type: 'string', example: 'Vietcombank' },
          accountNumber: { type: 'string', example: '0123456789' },
          accountName: { type: 'string', example: 'NGUYEN VAN A' },
          amount: { type: 'number', example: 226800 },
          transferContent: {
            type: 'string',
            example: 'B08 A1B2C3',
            description: 'Nội dung chuyển khoản gợi ý (mã bàn + 6 ký tự cuối mã phiên)',
          },
        },
      },
      generatedAt: dateTime,
    },
  },
  RequestBillResult: {
    type: 'object',
    properties: {
      bill: { $ref: '#/components/schemas/Bill' },
      serviceRequest: {
        type: 'object',
        properties: {
          id: idProp,
          type: { type: 'string', example: 'request_bill' },
          status: { type: 'string', enum: ['pending', 'acknowledged', 'done'] },
          createdAt: dateTime,
        },
      },
    },
  },
  RecordPaymentBody: {
    type: 'object',
    required: ['method'],
    properties: {
      method: {
        type: 'string',
        enum: PAYMENT_METHODS,
        description:
          'Phải nằm trong paymentMethods của cài đặt nhà hàng, nếu không → 422 PAYMENT_METHOD_UNAVAILABLE',
      },
      amountReceived: {
        type: 'number',
        minimum: 0,
        example: 250000,
        description: 'Tiền khách đưa — bắt buộc với cash; bank_transfer/card bỏ trống = đúng tổng',
      },
      discountAmount: {
        type: 'number',
        minimum: 0,
        default: 0,
        description: 'Số tiền giảm, trừ vào tổng sau VAT/phí',
      },
      discountReason: {
        type: 'string',
        maxLength: 300,
        nullable: true,
        description: 'Bắt buộc khi discountAmount > 0',
      },
      note: { type: 'string', maxLength: 500, nullable: true },
      force: {
        type: 'boolean',
        default: false,
        description: 'Vẫn thu tiền khi còn đơn pending/confirmed/preparing (lưu cảnh báo)',
      },
    },
  },
  Payment: {
    type: 'object',
    properties: {
      id: idProp,
      sessionId: idProp,
      table: { type: 'object', properties: { id: idProp, code: { type: 'string' } } },
      orderIds: { type: 'array', items: { type: 'string' } },
      currency: { type: 'string', example: 'VND' },
      subtotal: { type: 'number', example: 200000 },
      serviceChargePercent: { type: 'number', example: 5 },
      serviceCharge: { type: 'number', example: 10000 },
      vatPercent: { type: 'number', example: 8 },
      vat: { type: 'number', example: 16800 },
      discount: { type: 'number', example: 6800 },
      discountReason: { type: 'string', nullable: true, example: 'Khách quen' },
      total: { type: 'number', example: 220000 },
      method: { type: 'string', enum: PAYMENT_METHODS },
      amountReceived: { type: 'number', example: 300000 },
      change: { type: 'number', example: 80000 },
      note: { type: 'string', nullable: true },
      forced: { type: 'boolean', example: false },
      warnings: { type: 'array', items: { type: 'string' } },
      paidAt: dateTime,
      businessDate: { type: 'string', example: '2026-11-18' },
      cashier: {
        type: 'object',
        properties: { id: idProp, fullName: { type: 'string', nullable: true } },
      },
      createdAt: dateTime,
    },
  },
  ClosedSessionInfo: {
    type: 'object',
    properties: {
      id: idProp,
      status: { type: 'string', example: 'closed' },
      closeReason: { type: 'string', enum: ['paid', 'cancelled'] },
      closedAt: dateTime,
    },
  },
  PaymentTableRef: tableRef,
  RecordPaymentResult: {
    type: 'object',
    properties: {
      payment: { $ref: '#/components/schemas/Payment' },
      session: { $ref: '#/components/schemas/ClosedSessionInfo' },
      table: { $ref: '#/components/schemas/PaymentTableRef' },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  },
  MoveSessionResult: {
    type: 'object',
    properties: {
      session: {
        type: 'object',
        properties: {
          id: idProp,
          status: { type: 'string', enum: ['open', 'payment_requested'] },
          tableId: idProp,
        },
      },
      fromTable: { $ref: '#/components/schemas/PaymentTableRef' },
      toTable: { $ref: '#/components/schemas/PaymentTableRef' },
    },
  },
  PaymentSummary: {
    type: 'object',
    properties: {
      count: { type: 'integer', example: 12 },
      total: { type: 'number', example: 3450000 },
      byMethod: {
        type: 'object',
        properties: Object.fromEntries(
          PAYMENT_METHODS.map((method) => [
            method,
            {
              type: 'object',
              properties: { count: { type: 'integer' }, total: { type: 'number' } },
            },
          ]),
        ),
      },
    },
  },
};
