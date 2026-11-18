/** Schemas OpenAPI cho tổng quan quản trị (dashboard). */

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card'];
const int = (example?: number) => ({ type: 'integer', example });
const num = (example?: number) => ({ type: 'number', example });
const nullableNum = (example?: number) => ({ type: 'number', nullable: true, example });
const date = (example: string) => ({ type: 'string', format: 'date', example });
const meta = {
  timezone: { type: 'string', example: 'Asia/Ho_Chi_Minh' },
  currency: { type: 'string', example: 'VND' },
};

export const dashboardSchemas = {
  DashboardSummary: {
    type: 'object',
    properties: {
      date: date('2026-11-18'),
      ...meta,
      revenue: {
        type: 'object',
        properties: {
          today: num(12500000),
          yesterday: num(10000000),
          changePercent: {
            ...nullableNum(25),
            description: '% so với hôm qua (1 chữ số thập phân)',
          },
        },
      },
      orders: {
        type: 'object',
        properties: {
          count: { ...int(48), description: 'Đơn tạo trong ngày, không tính đơn huỷ' },
          yesterday: int(40),
          changePercent: nullableNum(20),
          cancelled: int(2),
        },
      },
      invoices: {
        type: 'object',
        properties: {
          count: { ...int(30), description: 'Số thanh toán trong ngày' },
          averageValue: num(416667),
          yesterdayAverageValue: num(400000),
          averageValueChangePercent: nullableNum(4.2),
        },
      },
      tables: {
        type: 'object',
        description: 'Trạng thái hiện tại (không phụ thuộc date)',
        properties: {
          serving: { ...int(12), description: 'occupied + needs_payment' },
          needsPayment: int(3),
          total: { ...int(20), description: 'Số bàn đang hoạt động' },
          occupancyPercent: num(60),
        },
      },
      serviceTime: {
        type: 'object',
        properties: {
          averageMinutes: {
            ...nullableNum(18.5),
            description: 'Trung bình confirmed → served (phút); null nếu chưa có đơn served',
          },
          servedOrders: int(25),
        },
      },
      pending: {
        type: 'object',
        description: 'Trạng thái hiện tại',
        properties: {
          serviceRequests: { ...int(2), description: 'Yêu cầu nhanh tại bàn status = pending' },
          orders: { ...int(3), description: 'Đơn chờ xác nhận (pending)' },
          total: int(5),
        },
      },
      generatedAt: { type: 'string', format: 'date-time' },
    },
  },
  DashboardRevenuePoint: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        example: '2026-11-18T12:00',
        description: 'hour: YYYY-MM-DDTHH:00, day: YYYY-MM-DD, month: YYYY-MM (giờ nhà hàng)',
      },
      start: { type: 'string', format: 'date-time', description: 'Bắt đầu mốc (UTC)' },
      revenue: num(1500000),
      invoices: int(4),
      guests: int(9),
    },
  },
  DashboardRevenueSeries: {
    type: 'object',
    properties: {
      from: date('2026-11-18'),
      to: date('2026-11-18'),
      groupBy: { type: 'string', enum: ['hour', 'day', 'month'] },
      ...meta,
      points: { type: 'array', items: { $ref: '#/components/schemas/DashboardRevenuePoint' } },
      totals: {
        type: 'object',
        properties: { revenue: num(12500000), invoices: int(30), guests: int(75) },
      },
    },
  },
  DashboardTopItems: {
    type: 'object',
    properties: {
      from: date('2026-11-01'),
      to: date('2026-11-18'),
      currency: meta.currency,
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            menuItemId: { type: 'string', example: '665f1c2e8b3a4d0012345678' },
            name: { type: 'string', example: 'Phở bò tái' },
            image: {
              type: 'object',
              nullable: true,
              properties: { url: { type: 'string', format: 'uri' } },
            },
            quantity: int(120),
            revenue: { ...num(8400000), description: 'Tổng lineTotal (chưa VAT/phí/giảm giá)' },
            orderCount: int(95),
          },
        },
      },
    },
  },
  DashboardPaymentMethods: {
    type: 'object',
    properties: {
      from: date('2026-11-01'),
      to: date('2026-11-18'),
      currency: meta.currency,
      totalAmount: num(12500000),
      totalCount: int(30),
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            method: { type: 'string', enum: PAYMENT_METHODS },
            count: int(18),
            amount: num(7500000),
            amountPercent: num(60),
            countPercent: num(60),
          },
        },
      },
    },
  },
};
