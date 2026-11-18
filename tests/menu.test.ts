import supertest from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import * as cloudinary from '../src/modules/uploads/cloudinary.service';
import { createUser, loginAs } from './helpers/auth';
import { flushPromises, resetCloudinaryMock } from './helpers/cloudinaryMock';
import { setupTestDb } from './helpers/db';

vi.mock('../src/modules/uploads/cloudinary.service', async (importOriginal) => ({
  ...(await importOriginal<typeof cloudinary>()),
  isCloudinaryConfigured: vi.fn(() => true),
  uploadImage: vi.fn(),
  deleteImage: vi.fn(),
}));

setupTestDb();

const img = (n: string) => ({
  url: `https://res.cloudinary.com/demo/image/upload/v1/order-qr/menu-items/${n}.jpg`,
  publicId: `order-qr/menu-items/${n}`,
});

describe('Thực đơn API', () => {
  let app: ReturnType<typeof createApp>;
  let bearer: string;

  const api = () => supertest(app);
  const createCategory = async (body: Record<string, unknown>) => {
    const res = await api()
      .post('/api/v1/admin/categories')
      .set('Authorization', bearer)
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as { id: string; slug: string; sortOrder: number };
  };
  const createItem = async (body: Record<string, unknown>) => {
    const res = await api()
      .post('/api/v1/admin/menu-items')
      .set('Authorization', bearer)
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as { id: string; slug: string; sortOrder: number };
  };

  beforeEach(async () => {
    resetCloudinaryMock(cloudinary);
    app = createApp();
    await createUser();
    bearer = `Bearer ${(await loginAs(app)).accessToken}`;
  });

  describe('yêu cầu đăng nhập', () => {
    it.each([
      ['get', '/api/v1/admin/categories'],
      ['post', '/api/v1/admin/categories'],
      ['patch', '/api/v1/admin/categories/reorder'],
      ['delete', '/api/v1/admin/categories/665f1c2e8b3a4d0012345678'],
      ['get', '/api/v1/admin/menu-items'],
      ['get', '/api/v1/admin/menu-items/stats'],
      ['post', '/api/v1/admin/menu-items'],
      ['patch', '/api/v1/admin/menu-items/665f1c2e8b3a4d0012345678'],
      ['patch', '/api/v1/admin/menu-items/665f1c2e8b3a4d0012345678/availability'],
      ['delete', '/api/v1/admin/menu-items/665f1c2e8b3a4d0012345678'],
    ] as const)('%s %s → 401 khi không có token', async (method, url) => {
      const res = await api()[method](url).send({});
      expect(res.status).toBe(401);
    });
  });

  describe('Danh mục', () => {
    it('tạo danh mục: tự sinh slug không dấu, không trùng, sortOrder tăng dần', async () => {
      const a = await createCategory({ name: 'Món Chính Đặc Biệt', icon: '🍜' });
      const b = await createCategory({ name: 'Món chính đặc biệt' });
      expect(a.slug).toBe('mon-chinh-dac-biet');
      expect(b.slug).toBe('mon-chinh-dac-biet-2');
      expect(a.sortOrder).toBe(0);
      expect(b.sortOrder).toBe(1);
    });

    it('slug tự đặt bị trùng → 409 SLUG_TAKEN', async () => {
      await createCategory({ name: 'Đồ uống', slug: 'do-uong' });
      const res = await api()
        .post('/api/v1/admin/categories')
        .set('Authorization', bearer)
        .send({ name: 'Khác', slug: 'do-uong' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLUG_TAKEN');
    });

    it('validate input', async () => {
      const res = await api()
        .post('/api/v1/admin/categories')
        .set('Authorization', bearer)
        .send({ name: '', slug: 'Có Dấu', image: { url: 'not-url' } });
      expect(res.status).toBe(400);
      const paths = res.body.error.details.map((d: { path: string }) => d.path);
      expect(paths).toEqual(expect.arrayContaining(['name', 'slug', 'image.url']));
    });

    it('list kèm itemCount, lọc isActive và tìm không dấu; get/patch', async () => {
      const cat = await createCategory({ name: 'Khai vị' });
      await createCategory({ name: 'Tráng miệng', isActive: false });
      await createItem({ name: 'Gỏi cuốn', categoryId: cat.id, price: 30000 });

      const all = await api().get('/api/v1/admin/categories').set('Authorization', bearer);
      expect(all.body.data).toHaveLength(2);
      expect(all.body.data[0]).toMatchObject({ name: 'Khai vị', itemCount: 1 });

      const active = await api()
        .get('/api/v1/admin/categories?isActive=false')
        .set('Authorization', bearer);
      expect(active.body.data.map((c: { name: string }) => c.name)).toEqual(['Tráng miệng']);

      const search = await api()
        .get('/api/v1/admin/categories?search=trang mieng')
        .set('Authorization', bearer);
      expect(search.body.data).toHaveLength(1);

      const patched = await api()
        .patch(`/api/v1/admin/categories/${cat.id}`)
        .set('Authorization', bearer)
        .send({ description: 'Món nhẹ', isActive: false });
      expect(patched.status).toBe(200);
      expect(patched.body.data).toMatchObject({
        description: 'Món nhẹ',
        isActive: false,
        slug: 'khai-vi',
      });

      const got = await api()
        .get(`/api/v1/admin/categories/${cat.id}`)
        .set('Authorization', bearer);
      expect(got.body.data.itemCount).toBe(1);
    });

    it('PATCH body rỗng → 400; id không tồn tại → 404', async () => {
      const cat = await createCategory({ name: 'A' });
      const empty = await api()
        .patch(`/api/v1/admin/categories/${cat.id}`)
        .set('Authorization', bearer)
        .send({});
      expect(empty.status).toBe(400);
      const missing = await api()
        .get('/api/v1/admin/categories/665f1c2e8b3a4d0012345678')
        .set('Authorization', bearer);
      expect(missing.status).toBe(404);
    });

    it('PATCH /reorder cập nhật sortOrder', async () => {
      const a = await createCategory({ name: 'A' });
      const b = await createCategory({ name: 'B' });
      const res = await api()
        .patch('/api/v1/admin/categories/reorder')
        .set('Authorization', bearer)
        .send({
          items: [
            { id: a.id, sortOrder: 5 },
            { id: b.id, sortOrder: 1 },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.data.map((c: { name: string }) => c.name)).toEqual(['B', 'A']);

      const missing = await api()
        .patch('/api/v1/admin/categories/reorder')
        .set('Authorization', bearer)
        .send({ items: [{ id: '665f1c2e8b3a4d0012345678', sortOrder: 1 }] });
      expect(missing.status).toBe(404);
    });

    it('không cho xoá danh mục còn món (409), xoá được khi trống và xoá ảnh Cloudinary', async () => {
      const cat = await createCategory({ name: 'Lẩu', image: img('lau') });
      const item = await createItem({ name: 'Lẩu thái', categoryId: cat.id, price: 200000 });

      const blocked = await api()
        .delete(`/api/v1/admin/categories/${cat.id}`)
        .set('Authorization', bearer);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toMatchObject({
        code: 'CATEGORY_NOT_EMPTY',
        details: { itemCount: 1 },
      });

      await api()
        .delete(`/api/v1/admin/menu-items/${item.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const ok = await api()
        .delete(`/api/v1/admin/categories/${cat.id}`)
        .set('Authorization', bearer);
      expect(ok.status).toBe(200);
      expect(cloudinary.deleteImage).toHaveBeenCalledWith('order-qr/menu-items/lau');
    });

    it('đổi ảnh danh mục → xoá ảnh cũ; gửi lại cùng ảnh → không xoá', async () => {
      const cat = await createCategory({ name: 'Nướng', image: img('old') });
      await api()
        .patch(`/api/v1/admin/categories/${cat.id}`)
        .set('Authorization', bearer)
        .send({ image: img('old') })
        .expect(200);
      expect(cloudinary.deleteImage).not.toHaveBeenCalled();

      await api()
        .patch(`/api/v1/admin/categories/${cat.id}`)
        .set('Authorization', bearer)
        .send({ image: img('new') })
        .expect(200);
      expect(cloudinary.deleteImage).toHaveBeenCalledWith('order-qr/menu-items/old');
    });
  });

  describe('Món ăn', () => {
    let categoryId: string;
    beforeEach(async () => {
      categoryId = (await createCategory({ name: 'Món chính' })).id;
    });

    it('tạo món đầy đủ trường, trả kèm category và discountPercent', async () => {
      const res = await api()
        .post('/api/v1/admin/menu-items')
        .set('Authorization', bearer)
        .send({
          name: 'Bò bít tết',
          description: 'Thăn bò Úc',
          categoryId,
          price: 250000,
          originalPrice: 300000,
          image: img('steak'),
          tags: ['bestseller', 'chef_recommend', 'bestseller'],
          preparationTimeMinutes: 20,
          optionGroups: [
            {
              name: 'Mức chín',
              required: true,
              options: [{ name: 'Tái' }, { name: 'Chín vừa' }, { name: 'Chín kỹ' }],
            },
            {
              name: 'Size',
              maxSelect: 1,
              options: [
                { name: 'Vừa', priceDelta: 0 },
                { name: 'Lớn', priceDelta: 50000 },
              ],
            },
          ],
        });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const data = res.body.data;
      expect(data).toMatchObject({
        name: 'Bò bít tết',
        slug: 'bo-bit-tet',
        categoryId,
        category: { id: categoryId, name: 'Món chính', slug: 'mon-chinh' },
        price: 250000,
        originalPrice: 300000,
        discountPercent: 17,
        image: img('steak'),
        tags: ['bestseller', 'chef_recommend'],
        isAvailable: true,
        isActive: true,
        preparationTimeMinutes: 20,
        sortOrder: 0,
      });
      expect(data.optionGroups).toHaveLength(2);
      expect(data.optionGroups[0]).toMatchObject({
        name: 'Mức chín',
        required: true,
        maxSelect: 1,
      });
      expect(data.optionGroups[1].options[1]).toMatchObject({ name: 'Lớn', priceDelta: 50000 });
      expect(data.optionGroups[1].options[1].id).toEqual(expect.any(String));
      expect(data).not.toHaveProperty('searchName');
    });

    it('validate: giá không nguyên, originalPrice <= price, tag lạ, maxSelect > số lựa chọn', async () => {
      const res = await api()
        .post('/api/v1/admin/menu-items')
        .set('Authorization', bearer)
        .send({
          name: 'X',
          categoryId,
          price: 1000.5,
          tags: ['unknown'],
          optionGroups: [{ name: 'Size', maxSelect: 3, options: [{ name: 'S' }] }],
        });
      expect(res.status).toBe(400);
      const paths = res.body.error.details.map((d: { path: string }) => d.path);
      expect(paths).toEqual(
        expect.arrayContaining(['price', 'tags.0', 'optionGroups.0.maxSelect']),
      );

      const price = await api()
        .post('/api/v1/admin/menu-items')
        .set('Authorization', bearer)
        .send({ name: 'X', categoryId, price: 50000, originalPrice: 50000 });
      expect(price.status).toBe(400);
      expect(price.body.error.details[0].path).toBe('originalPrice');
    });

    it('categoryId không tồn tại → 400 CATEGORY_NOT_FOUND', async () => {
      const res = await api()
        .post('/api/v1/admin/menu-items')
        .set('Authorization', bearer)
        .send({ name: 'X', categoryId: '665f1c2e8b3a4d0012345678', price: 1000 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('PATCH: cập nhật một phần, kiểm tra originalPrice với giá hiện tại, đổi ảnh → xoá ảnh cũ', async () => {
      const item = await createItem({
        name: 'Cơm gà',
        categoryId,
        price: 50000,
        image: img('com'),
      });

      const bad = await api()
        .patch(`/api/v1/admin/menu-items/${item.id}`)
        .set('Authorization', bearer)
        .send({ originalPrice: 40000 });
      expect(bad.status).toBe(400);

      const res = await api()
        .patch(`/api/v1/admin/menu-items/${item.id}`)
        .set('Authorization', bearer)
        .send({ name: 'Cơm gà xối mỡ', originalPrice: 60000, image: img('com2') });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        name: 'Cơm gà xối mỡ',
        slug: 'com-ga',
        price: 50000,
        originalPrice: 60000,
        image: img('com2'),
      });
      expect(cloudinary.deleteImage).toHaveBeenCalledWith('order-qr/menu-items/com');

      await api()
        .patch(`/api/v1/admin/menu-items/${item.id}`)
        .set('Authorization', bearer)
        .send({ image: null })
        .expect(200);
      expect(cloudinary.deleteImage).toHaveBeenCalledWith('order-qr/menu-items/com2');
    });

    it('lỗi xoá ảnh Cloudinary chỉ ghi log, không làm hỏng request', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.mocked(cloudinary.deleteImage).mockRejectedValue(new Error('network down'));
      const item = await createItem({
        name: 'Bún chả',
        categoryId,
        price: 45000,
        image: img('bun'),
      });
      const res = await api()
        .delete(`/api/v1/admin/menu-items/${item.id}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(200);
      await flushPromises();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('PATCH /availability chuyển còn/hết món', async () => {
      const item = await createItem({ name: 'Chè', categoryId, price: 20000 });
      const res = await api()
        .patch(`/api/v1/admin/menu-items/${item.id}/availability`)
        .set('Authorization', bearer)
        .send({ isAvailable: false });
      expect(res.status).toBe(200);
      expect(res.body.data.isAvailable).toBe(false);

      const bad = await api()
        .patch(`/api/v1/admin/menu-items/${item.id}/availability`)
        .set('Authorization', bearer)
        .send({});
      expect(bad.status).toBe(400);
    });

    it('list: lọc category, search không dấu, isAvailable, tags, phân trang, sort', async () => {
      const drinks = (await createCategory({ name: 'Đồ uống' })).id;
      await createItem({ name: 'Phở bò', categoryId, price: 55000, tags: ['bestseller'] });
      await createItem({ name: 'Phở gà', categoryId, price: 50000, isAvailable: false });
      await createItem({ name: 'Mì cay', categoryId, price: 60000, tags: ['spicy', 'new'] });
      await createItem({ name: 'Trà đá', categoryId: drinks, price: 5000, isActive: false });

      const list = (qs: string) =>
        api().get(`/api/v1/admin/menu-items${qs}`).set('Authorization', bearer);

      const all = await list('');
      expect(all.body.meta).toMatchObject({ total: 4, page: 1 });

      expect(
        (await list(`?categoryId=${drinks}`)).body.data.map((i: { name: string }) => i.name),
      ).toEqual(['Trà đá']);
      expect((await list('?search=pho')).body.meta.total).toBe(2);
      expect((await list('?search=Phở bò')).body.meta.total).toBe(1);
      expect((await list('?isAvailable=false')).body.data[0].name).toBe('Phở gà');
      expect((await list('?isActive=false')).body.data[0].name).toBe('Trà đá');
      expect((await list('?tags=spicy,bestseller')).body.meta.total).toBe(2);
      expect((await list('?tags=new&tags=spicy')).body.meta.total).toBe(1);

      const page2 = await list('?limit=3&page=2&sort=-price');
      expect(page2.body.meta).toMatchObject({ total: 4, totalPages: 2 });
      expect(page2.body.data.map((i: { name: string }) => i.name)).toEqual(['Trà đá']);

      expect((await list('?tags=unknown')).status).toBe(400);
    });

    it('GET /stats trả số liệu cho header', async () => {
      await createCategory({ name: 'Ẩn', isActive: false });
      await createItem({ name: 'A', categoryId, price: 1000 });
      await createItem({ name: 'B', categoryId, price: 1000, isAvailable: false });
      await createItem({ name: 'C', categoryId, price: 1000, isActive: false });
      const res = await api().get('/api/v1/admin/menu-items/stats').set('Authorization', bearer);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        totalItems: 3,
        availableItems: 1,
        outOfStockItems: 1,
        hiddenItems: 1,
        totalCategories: 2,
        activeCategories: 1,
      });
    });

    it('xoá món → 404 khi lấy lại; reorder món', async () => {
      const a = await createItem({ name: 'A', categoryId, price: 1000 });
      const b = await createItem({ name: 'B', categoryId, price: 1000 });
      expect(b.sortOrder).toBe(1);
      await api()
        .patch('/api/v1/admin/menu-items/reorder')
        .set('Authorization', bearer)
        .send({
          items: [
            { id: a.id, sortOrder: 2 },
            { id: b.id, sortOrder: 0 },
          ],
        })
        .expect(200);
      const list = await api().get('/api/v1/admin/menu-items').set('Authorization', bearer);
      expect(list.body.data.map((i: { name: string }) => i.name)).toEqual(['B', 'A']);

      await api()
        .delete(`/api/v1/admin/menu-items/${a.id}`)
        .set('Authorization', bearer)
        .expect(200);
      await api().get(`/api/v1/admin/menu-items/${a.id}`).set('Authorization', bearer).expect(404);
    });
  });

  describe('Thực đơn công khai', () => {
    it('chỉ trả danh mục/món active, theo sortOrder; món hết vẫn hiện với isAvailable=false', async () => {
      const drinks = await createCategory({ name: 'Đồ uống', sortOrder: 2 });
      const mains = await createCategory({ name: 'Món chính', sortOrder: 1, image: img('cat') });
      const hiddenCat = await createCategory({ name: 'Ẩn', isActive: false });
      await createItem({
        name: 'Phở',
        categoryId: mains.id,
        price: 50000,
        sortOrder: 2,
        image: img('pho'),
      });
      await createItem({
        name: 'Bún',
        categoryId: mains.id,
        price: 45000,
        sortOrder: 1,
        isAvailable: false,
      });
      await createItem({ name: 'Cơm ẩn', categoryId: mains.id, price: 1, isActive: false });
      await createItem({ name: 'Trà', categoryId: drinks.id, price: 5000, tags: ['new'] });
      await createItem({ name: 'Món trong danh mục ẩn', categoryId: hiddenCat.id, price: 1 });

      const res = await api().get('/api/v1/public/menu');
      expect(res.status).toBe(200);
      const { categories, totalItems } = res.body.data;
      expect(totalItems).toBe(3);
      expect(categories.map((c: { name: string }) => c.name)).toEqual(['Món chính', 'Đồ uống']);
      expect(categories[0].image).toEqual({ url: img('cat').url });
      expect(categories[0].items.map((i: { name: string }) => i.name)).toEqual(['Bún', 'Phở']);
      expect(categories[0].items[0].isAvailable).toBe(false);
      const pho = categories[0].items[1];
      expect(pho.image).toEqual({ url: img('pho').url });
      expect(pho).not.toHaveProperty('isActive');
      expect(pho).not.toHaveProperty('sortOrder');

      const byTag = await api().get('/api/v1/public/menu?tag=new');
      expect(byTag.body.data.categories.map((c: { name: string }) => c.name)).toEqual(['Đồ uống']);

      const bySearch = await api().get('/api/v1/public/menu?search=pho');
      expect(bySearch.body.data.totalItems).toBe(1);

      const byCategory = await api().get(`/api/v1/public/menu?category=${drinks.slug}`);
      expect(byCategory.body.data.categories).toHaveLength(1);
      const byCategoryId = await api().get(`/api/v1/public/menu?category=${mains.id}`);
      expect(byCategoryId.body.data.categories[0].name).toBe('Món chính');
      const byHiddenCat = await api().get(`/api/v1/public/menu?category=${hiddenCat.id}`);
      expect(byHiddenCat.body.data.categories).toHaveLength(0);
    });

    it('GET /public/menu-items/:id theo id hoặc slug; món/danh mục ẩn → 404', async () => {
      const cat = await createCategory({ name: 'Món chính' });
      const hiddenCat = await createCategory({ name: 'Ẩn', isActive: false });
      const item = await createItem({ name: 'Phở bò', categoryId: cat.id, price: 50000 });
      const hidden = await createItem({
        name: 'Ẩn',
        categoryId: cat.id,
        price: 1,
        isActive: false,
      });
      const inHiddenCat = await createItem({
        name: 'Trong ẩn',
        categoryId: hiddenCat.id,
        price: 1,
      });

      const byId = await api().get(`/api/v1/public/menu-items/${item.id}`);
      expect(byId.status).toBe(200);
      expect(byId.body.data).toMatchObject({ name: 'Phở bò', category: { name: 'Món chính' } });
      expect((await api().get('/api/v1/public/menu-items/pho-bo')).status).toBe(200);
      expect((await api().get(`/api/v1/public/menu-items/${hidden.id}`)).status).toBe(404);
      expect((await api().get(`/api/v1/public/menu-items/${inHiddenCat.id}`)).status).toBe(404);
      expect((await api().get('/api/v1/public/menu-items/khong-co')).status).toBe(404);
    });
  });
});
