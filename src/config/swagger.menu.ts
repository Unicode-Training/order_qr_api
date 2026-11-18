/** Schemas OpenAPI cho thực đơn (danh mục, món, upload ảnh). */

const TAGS = ['bestseller', 'new', 'spicy', 'vegetarian', 'chef_recommend'];
const idProp = { type: 'string', example: '665f1c2e8b3a4d0012345678' };
const timestamps = {
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};

const imageRef = { $ref: '#/components/schemas/MenuImage' };
const publicImage = {
  type: 'object',
  nullable: true,
  properties: { url: { type: 'string', format: 'uri' } },
};

const categoryInputProps = {
  name: { type: 'string', maxLength: 100, example: 'Món chính' },
  slug: {
    type: 'string',
    pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    description: 'Bỏ trống để tự sinh từ tên',
    example: 'mon-chinh',
  },
  description: { type: 'string', nullable: true, maxLength: 500 },
  icon: { type: 'string', nullable: true, maxLength: 100, example: '🍜' },
  image: imageRef,
  sortOrder: { type: 'integer', description: 'Bỏ trống → xếp cuối' },
  isActive: { type: 'boolean', default: true },
};

const optionGroupInput = {
  type: 'object',
  required: ['name', 'options'],
  properties: {
    name: { type: 'string', example: 'Mức chín' },
    required: { type: 'boolean', default: false },
    maxSelect: { type: 'integer', minimum: 1, default: 1, description: '<= số lựa chọn' },
    options: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', example: 'Tái' },
          priceDelta: {
            type: 'integer',
            default: 0,
            description: 'Chênh lệch giá (VND), có thể âm',
          },
        },
      },
    },
  },
};

const menuItemInputProps = {
  name: { type: 'string', maxLength: 150, example: 'Phở bò tái' },
  slug: {
    type: 'string',
    pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    description: 'Bỏ trống để tự sinh từ tên',
  },
  description: { type: 'string', nullable: true, maxLength: 1000 },
  categoryId: idProp,
  price: { type: 'integer', minimum: 0, description: 'Giá bán (VND)', example: 55000 },
  originalPrice: {
    type: 'integer',
    nullable: true,
    description: 'Giá gốc để hiển thị giảm giá, phải > price',
    example: 65000,
  },
  image: imageRef,
  tags: { type: 'array', uniqueItems: true, items: { type: 'string', enum: TAGS } },
  isAvailable: { type: 'boolean', default: true, description: 'Còn món / hết món' },
  isActive: { type: 'boolean', default: true, description: 'Hiện / ẩn với khách' },
  preparationTimeMinutes: {
    type: 'integer',
    nullable: true,
    minimum: 0,
    maximum: 600,
    example: 10,
  },
  sortOrder: { type: 'integer', description: 'Bỏ trống → xếp cuối danh mục' },
  optionGroups: { type: 'array', maxItems: 20, items: optionGroupInput },
};

const optionGroupOutput = {
  type: 'object',
  properties: {
    id: idProp,
    name: { type: 'string', example: 'Size' },
    required: { type: 'boolean' },
    maxSelect: { type: 'integer' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: idProp,
          name: { type: 'string', example: 'Lớn' },
          priceDelta: { type: 'integer', example: 10000 },
        },
      },
    },
  },
};

const publicItemProps = {
  id: idProp,
  name: { type: 'string', example: 'Phở bò tái' },
  slug: { type: 'string', example: 'pho-bo-tai' },
  description: { type: 'string', nullable: true },
  categoryId: idProp,
  price: { type: 'integer', example: 55000 },
  originalPrice: { type: 'integer', nullable: true, example: 65000 },
  discountPercent: { type: 'integer', nullable: true, example: 15 },
  tags: { type: 'array', items: { type: 'string', enum: TAGS } },
  isAvailable: { type: 'boolean', description: 'false = hết món (vẫn hiển thị, không gọi được)' },
  preparationTimeMinutes: { type: 'integer', nullable: true },
  optionGroups: { type: 'array', items: optionGroupOutput },
};

export const menuSchemas = {
  MenuImage: {
    type: 'object',
    nullable: true,
    description: 'Ảnh lấy từ POST /admin/uploads. Gửi null để gỡ ảnh.',
    required: ['url'],
    properties: {
      url: {
        type: 'string',
        format: 'uri',
        example: 'https://res.cloudinary.com/demo/image/upload/v1/order-qr/menu-items/abc.jpg',
      },
      publicId: { type: 'string', nullable: true, example: 'order-qr/menu-items/abc' },
    },
  },
  UploadedImage: {
    type: 'object',
    properties: {
      url: { type: 'string', format: 'uri', description: 'secure_url' },
      publicId: { type: 'string', example: 'order-qr/menu-items/abc' },
      width: { type: 'integer', example: 1200 },
      height: { type: 'integer', example: 800 },
    },
  },
  DeletedResult: {
    type: 'object',
    properties: { id: idProp, deleted: { type: 'boolean', example: true } },
  },
  ReorderInput: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 500,
        items: {
          type: 'object',
          required: ['id', 'sortOrder'],
          properties: { id: idProp, sortOrder: { type: 'integer', example: 0 } },
        },
      },
    },
  },
  CategoryInput: { type: 'object', required: ['name'], properties: categoryInputProps },
  CategoryPatch: { type: 'object', minProperties: 1, properties: categoryInputProps },
  Category: {
    type: 'object',
    properties: {
      id: idProp,
      ...categoryInputProps,
      itemCount: { type: 'integer', description: 'Số món thuộc danh mục', example: 12 },
      ...timestamps,
    },
  },
  MenuItemInput: {
    type: 'object',
    required: ['name', 'categoryId', 'price'],
    properties: menuItemInputProps,
  },
  MenuItemPatch: { type: 'object', minProperties: 1, properties: menuItemInputProps },
  MenuItem: {
    type: 'object',
    properties: {
      ...publicItemProps,
      category: {
        type: 'object',
        nullable: true,
        properties: { id: idProp, name: { type: 'string' }, slug: { type: 'string' } },
      },
      image: imageRef,
      isActive: { type: 'boolean' },
      sortOrder: { type: 'integer' },
      ...timestamps,
    },
  },
  MenuStats: {
    type: 'object',
    properties: {
      totalItems: { type: 'integer', description: 'Tổng số món (kể cả đang ẩn)', example: 40 },
      availableItems: { type: 'integer', description: 'Đang bán (hiện và còn món)', example: 32 },
      outOfStockItems: { type: 'integer', description: 'Hết món (đang hiện)', example: 5 },
      hiddenItems: { type: 'integer', description: 'Đang ẩn', example: 3 },
      totalCategories: { type: 'integer', example: 6 },
      activeCategories: { type: 'integer', example: 5 },
    },
  },
  PublicCategory: {
    type: 'object',
    properties: {
      id: idProp,
      name: { type: 'string' },
      slug: { type: 'string' },
      description: { type: 'string', nullable: true },
      icon: { type: 'string', nullable: true },
      image: publicImage,
    },
  },
  PublicMenuItem: {
    type: 'object',
    properties: { ...publicItemProps, image: publicImage },
  },
  PublicMenu: {
    type: 'object',
    properties: {
      categories: {
        type: 'array',
        items: {
          allOf: [
            { $ref: '#/components/schemas/PublicCategory' },
            {
              type: 'object',
              properties: {
                items: { type: 'array', items: { $ref: '#/components/schemas/PublicMenuItem' } },
              },
            },
          ],
        },
      },
      totalItems: { type: 'integer' },
    },
  },
};
