import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { RestaurantSettings } from '../src/modules/settings/settings.model';
import { restaurantSettingsSchema } from '../src/modules/settings/settings.schema';
import { getPricingConfig, getSettings } from '../src/modules/settings/settings.service';
import { createUser, loginAs } from './helpers/auth';
import { setupTestDb } from './helpers/db';

setupTestDb();

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  slots: [{ open: '00:00', close: '24:00' }],
}));

const fullSettings = {
  name: '  Quán Ngon  ',
  slogan: 'Hương vị Việt',
  description: '',
  logo: { url: 'https://res.cloudinary.com/demo/logo.png', publicId: 'restaurant/logo' },
  coverImage: { url: 'https://res.cloudinary.com/demo/cover.png', publicId: 'restaurant/cover' },
  address: '123 Lê Lợi, Q.1, TP.HCM',
  phone: '0901 234 567',
  email: 'LienHe@QuanNgon.vn',
  wifi: { ssid: 'QuanNgon', password: '12345678' },
  openingHours: [
    {
      dayOfWeek: 2,
      slots: [
        { open: '17:30', close: '23:00' },
        { open: '10:30', close: '14:00' },
      ],
    },
    { dayOfWeek: 1, slots: [] },
  ],
  currency: 'vnd',
  vatPercent: 8,
  serviceChargePercent: 5.5,
  ordering: {
    enabled: true,
    requireStaffConfirm: false,
    allowOrderOutsideOpeningHours: false,
    maxItemQuantityPerOrder: 20,
  },
  paymentMethods: ['cash', 'bank_transfer'],
  bankTransferInfo: {
    bankName: 'Vietcombank',
    accountNumber: '0123456789',
    accountName: 'NGUYEN VAN A',
  },
};

describe('restaurantSettingsSchema (validate input)', () => {
  const parse = (data: Record<string, unknown>) =>
    restaurantSettingsSchema.safeParse({ name: 'Quán', ...data });
  const issuePaths = (data: Record<string, unknown>) => {
    const result = parse(data);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
  };

  it('chỉ cần name, còn lại nhận mặc định', () => {
    const result = restaurantSettingsSchema.parse({ name: 'Quán' });
    expect(result).toMatchObject({
      currency: 'VND',
      vatPercent: 0,
      serviceChargePercent: 0,
      ordering: {
        enabled: true,
        requireStaffConfirm: true,
        allowOrderOutsideOpeningHours: false,
        maxItemQuantityPerOrder: 50,
      },
      paymentMethods: ['cash'],
      logo: null,
      wifi: null,
      bankTransferInfo: null,
    });
    expect(result.openingHours).toHaveLength(7);
  });

  it('chuẩn hoá: trim, chuỗi rỗng → null, currency in hoa, sắp xếp ngày và khung giờ', () => {
    const result = restaurantSettingsSchema.parse(fullSettings);
    expect(result.name).toBe('Quán Ngon');
    expect(result.description).toBeNull();
    expect(result.currency).toBe('VND');
    expect(result.email).toBe('lienhe@quanngon.vn');
    expect(result.openingHours.map((day) => day.dayOfWeek)).toEqual([1, 2]);
    expect(result.openingHours[1]?.slots.map((slot) => slot.open)).toEqual(['10:30', '17:30']);
  });

  it.each([
    ['name rỗng', { name: '   ' }, 'name'],
    ['VAT > 100', { vatPercent: 101 }, 'vatPercent'],
    ['VAT âm', { vatPercent: -1 }, 'vatPercent'],
    ['phí phục vụ quá 2 chữ số thập phân', { serviceChargePercent: 1.234 }, 'serviceChargePercent'],
    ['VAT dạng chuỗi', { vatPercent: '8' }, 'vatPercent'],
    ['currency sai', { currency: 'VN' }, 'currency'],
    ['email sai', { email: 'abc' }, 'email'],
    ['phone sai', { phone: 'abc' }, 'phone'],
    ['logo không phải http(s)', { logo: { url: 'javascript:alert(1)' } }, 'logo.url'],
    ['wifi thiếu ssid', { wifi: { password: 'x' } }, 'wifi.ssid'],
    ['paymentMethods rỗng', { paymentMethods: [] }, 'paymentMethods'],
    ['paymentMethods lạ', { paymentMethods: ['momo'] }, 'paymentMethods.0'],
    ['paymentMethods trùng', { paymentMethods: ['cash', 'cash'] }, 'paymentMethods'],
    [
      'bank_transfer thiếu bankTransferInfo',
      { paymentMethods: ['bank_transfer'] },
      'bankTransferInfo',
    ],
    [
      'số tài khoản có chữ',
      {
        bankTransferInfo: { bankName: 'VCB', accountNumber: 'abc', accountName: 'A' },
      },
      'bankTransferInfo.accountNumber',
    ],
    [
      'maxItemQuantityPerOrder = 0',
      { ordering: { maxItemQuantityPerOrder: 0 } },
      'ordering.maxItemQuantityPerOrder',
    ],
    [
      'maxItemQuantityPerOrder lẻ',
      { ordering: { maxItemQuantityPerOrder: 1.5 } },
      'ordering.maxItemQuantityPerOrder',
    ],
    ['dayOfWeek = 7', { openingHours: [{ dayOfWeek: 7, slots: [] }] }, 'openingHours.0.dayOfWeek'],
    [
      'giờ sai định dạng',
      { openingHours: [{ dayOfWeek: 1, slots: [{ open: '9:00', close: '25:00' }] }] },
      'openingHours.0.slots.0.open',
    ],
    [
      'giờ mở = giờ đóng',
      { openingHours: [{ dayOfWeek: 1, slots: [{ open: '09:00', close: '09:00' }] }] },
      'openingHours.0.slots.0.close',
    ],
    [
      'trùng ngày',
      {
        openingHours: [
          { dayOfWeek: 1, slots: [] },
          { dayOfWeek: 1, slots: [] },
        ],
      },
      'openingHours.1.dayOfWeek',
    ],
    [
      'khung giờ chồng lấn',
      {
        openingHours: [
          {
            dayOfWeek: 1,
            slots: [
              { open: '10:00', close: '14:00' },
              { open: '13:00', close: '15:00' },
            ],
          },
        ],
      },
      'openingHours.0.slots.1',
    ],
  ])('%s → lỗi tại %s', (_label, data, path) => {
    expect(issuePaths(data)).toContain(path);
  });
});

describe('Cài đặt nhà hàng API', () => {
  let app: ReturnType<typeof createApp>;
  let bearer: string;

  beforeEach(async () => {
    app = createApp();
    await createUser();
    bearer = `Bearer ${(await loginAs(app)).accessToken}`;
  });

  describe('yêu cầu đăng nhập', () => {
    it.each([['get'], ['put'], ['patch']] as const)(
      '%s /admin/settings không token → 401',
      async (method) => {
        const res = await supertest(app)[method]('/api/v1/admin/settings').send({ name: 'X' });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
        expect(await RestaurantSettings.countDocuments()).toBe(0);
      },
    );

    it('token sai → 401', async () => {
      await supertest(app)
        .get('/api/v1/admin/settings')
        .set('Authorization', 'Bearer abc.def.ghi')
        .expect(401);
    });

    it('GET /public/restaurant không cần đăng nhập', async () => {
      await supertest(app).get('/api/v1/public/restaurant').expect(200);
    });
  });

  it('GET /admin/settings tự tạo mặc định (singleton, gọi đồng thời vẫn chỉ 1 document)', async () => {
    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        supertest(app).get('/api/v1/admin/settings').set('Authorization', bearer),
      ),
    );
    for (const res of responses) expect(res.status).toBe(200);
    expect(await RestaurantSettings.countDocuments()).toBe(1);

    const { data } = responses[0]!.body;
    expect(data).toMatchObject({
      name: 'Nhà hàng của tôi',
      currency: 'VND',
      paymentMethods: ['cash'],
    });
    expect(data.updatedAt).toBeDefined();
    expect(data._id).toBeUndefined();
    expect(data.key).toBeUndefined();
  });

  it('PUT thay toàn bộ, trường bỏ qua về mặc định', async () => {
    const res = await supertest(app)
      .put('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send(fullSettings);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'Quán Ngon',
      vatPercent: 8,
      serviceChargePercent: 5.5,
      logo: fullSettings.logo,
      bankTransferInfo: fullSettings.bankTransferInfo,
    });

    const replaced = await supertest(app)
      .put('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send({ name: 'Quán Mới' });
    expect(replaced.status).toBe(200);
    expect(replaced.body.data).toMatchObject({
      name: 'Quán Mới',
      vatPercent: 0,
      logo: null,
      wifi: null,
    });
    expect(await RestaurantSettings.countDocuments()).toBe(1);
  });

  it('PUT dữ liệu sai → 400 kèm chi tiết, không ghi DB', async () => {
    const res = await supertest(app)
      .put('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send({ name: '', vatPercent: 200 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['name', 'vatPercent']),
    );
    expect(await RestaurantSettings.countDocuments()).toBe(0);
  });

  it('PATCH gộp object lồng nhau, thay mảng, null để xoá', async () => {
    await supertest(app)
      .put('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send(fullSettings);

    const res = await supertest(app)
      .patch('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send({
        vatPercent: 10,
        ordering: { requireStaffConfirm: true },
        logo: null,
        openingHours: [{ dayOfWeek: 5, slots: [{ open: '18:00', close: '02:00' }] }],
        unknownField: 'bị bỏ qua',
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'Quán Ngon',
      vatPercent: 10,
      serviceChargePercent: 5.5,
      logo: null,
      coverImage: fullSettings.coverImage,
      ordering: { requireStaffConfirm: true, maxItemQuantityPerOrder: 20 },
      openingHours: [{ dayOfWeek: 5, slots: [{ open: '18:00', close: '02:00' }] }],
    });
    expect(res.body.data.unknownField).toBeUndefined();
  });

  it('PATCH validate lại sau khi gộp (ràng buộc chéo) và body rỗng → 400', async () => {
    const cross = await supertest(app)
      .patch('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send({ paymentMethods: ['cash', 'bank_transfer'] });
    expect(cross.status).toBe(400);
    expect(cross.body.error.details[0]).toMatchObject({
      location: 'body',
      path: 'bankTransferInfo',
    });

    const nested = await supertest(app)
      .patch('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send({ ordering: { maxItemQuantityPerOrder: -1 } });
    expect(nested.status).toBe(400);
    expect(nested.body.error.details[0].path).toBe('ordering.maxItemQuantityPerOrder');

    await supertest(app)
      .patch('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send({})
      .expect(400);
    await supertest(app)
      .patch('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send({ foo: 1 })
      .expect(400);

    // Không thay đổi gì sau các request lỗi
    expect((await getSettings()).paymentMethods).toEqual(['cash']);
  });

  it('GET /public/restaurant: không lộ trường nội bộ, có isOpenNow và canOrderNow', async () => {
    await supertest(app)
      .put('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send({ ...fullSettings, openingHours: ALL_DAY })
      .expect(200);

    const res = await supertest(app).get('/api/v1/public/restaurant');
    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data).toMatchObject({
      name: 'Quán Ngon',
      timezone: 'Asia/Ho_Chi_Minh',
      isOpenNow: true,
      logo: { url: fullSettings.logo.url },
      wifi: fullSettings.wifi,
      bankTransferInfo: fullSettings.bankTransferInfo,
      ordering: { enabled: true, canOrderNow: true },
    });
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/publicId|_id|"key"|__v|createdAt|updatedAt/);
  });

  it('GET /public/restaurant: ngoài giờ → isOpenNow=false, canOrderNow theo cấu hình; ẩn bankTransferInfo khi không bật', async () => {
    await supertest(app)
      .put('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send({ ...fullSettings, openingHours: [], paymentMethods: ['cash'] })
      .expect(200);

    let { data } = (await supertest(app).get('/api/v1/public/restaurant')).body;
    expect(data.isOpenNow).toBe(false);
    expect(data.ordering.canOrderNow).toBe(false);
    expect(data.bankTransferInfo).toBeNull();

    await supertest(app)
      .patch('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send({ ordering: { allowOrderOutsideOpeningHours: true } })
      .expect(200);
    ({ data } = (await supertest(app).get('/api/v1/public/restaurant')).body);
    expect(data.ordering.canOrderNow).toBe(true);

    await supertest(app)
      .patch('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send({ ordering: { enabled: false } })
      .expect(200);
    ({ data } = (await supertest(app).get('/api/v1/public/restaurant')).body);
    expect(data.ordering.canOrderNow).toBe(false);
  });

  it('getPricingConfig() trả cấu hình tính tiền cho module đơn hàng', async () => {
    expect(await getPricingConfig()).toEqual({
      currency: 'VND',
      vatPercent: 0,
      serviceChargePercent: 0,
    });
    await supertest(app)
      .patch('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send({ vatPercent: 8, serviceChargePercent: 5 })
      .expect(200);
    expect(await getPricingConfig()).toEqual({
      currency: 'VND',
      vatPercent: 8,
      serviceChargePercent: 5,
    });
  });
});
