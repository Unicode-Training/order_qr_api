/**
 * Ảnh minh hoạ cho dữ liệu demo (`npm run seed:demo`): logo/ảnh bìa nhà hàng, ảnh danh mục, ảnh món.
 *
 * Nguồn: Wikimedia Commons (giấy phép mở — CC0/PD/CC BY/CC BY-SA; xem trang
 * `https://commons.wikimedia.org/wiki/File:<file>` để biết tác giả). Chỉ dùng cho demo.
 */
import { createHash } from 'node:crypto';

export interface DemoImageSource {
  /** Tên file trên Wikimedia Commons (không có tiền tố `File:`). */
  file: string;
  license: string;
  /** Chiều rộng ảnh thu nhỏ (px). `null` = dùng ảnh gốc (ảnh gốc đã nhỏ hơn 960px). */
  width?: number | null;
}

/** Chiều rộng mặc định — một trong các kích thước thumbnail chuẩn của Wikimedia. */
const DEFAULT_WIDTH = 960;

/** URL ảnh trên upload.wikimedia.org (thư mục băm theo MD5 của tên file, như MediaWiki). */
export function wikimediaImageUrl(source: DemoImageSource): string {
  const name = source.file.replace(/ /g, '_');
  const hash = createHash('md5').update(name).digest('hex');
  const encoded = encodeURIComponent(name);
  const dir = `${hash[0]}/${hash.slice(0, 2)}`;
  const width = source.width === undefined ? DEFAULT_WIDTH : source.width;
  if (width === null) return `https://upload.wikimedia.org/wikipedia/commons/${dir}/${encoded}`;
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${dir}/${encoded}/${width}px-${encoded}`;
}

export const DEMO_RESTAURANT_IMAGES = {
  logo: { file: 'Aiga restaurant knife-fork crossed.png', license: 'CC BY-SA 3.0', width: 500 },
  coverImage: {
    file: 'Restaurant table at Amantaka luxury Resort & Hotel in Luang Prabang Laos.jpg',
    license: 'CC BY-SA 4.0',
  },
} satisfies Record<'logo' | 'coverImage', DemoImageSource>;

/** Ảnh danh mục, theo slug trong `DEMO_CATEGORIES`. */
export const DEMO_CATEGORY_IMAGES: Record<string, DemoImageSource> = {
  'khai-vi': { file: 'Salad as starter at restaurant Vltava.jpg', license: 'CC BY-SA 4.0' },
  'bit-tet-nuong': { file: 'Steak Dinner for Two (Unsplash).jpg', license: 'CC0' },
  'mon-chinh': { file: "Spaghetti bolognese - Enzo's 2026-04-21.jpg", license: 'CC0' },
  'trang-mieng': {
    file: 'Piece of chocolate cake on a white plate decorated with chocolate sauce.jpg',
    license: 'CC0',
  },
  'do-uong': { file: 'Cocktail tropicana.jpg', license: 'Public domain' },
};

/** Ảnh món, theo slug trong `DEMO_MENU_ITEMS`. */
export const DEMO_MENU_ITEM_IMAGES: Record<string, DemoImageSource> = {
  'sup-bi-do-kem-tuoi': { file: 'Autumn Soup (Unsplash) cropped.jpg', license: 'CC0', width: null },
  'salad-caesar-ga-nuong': { file: 'Chicken Caesar Salad - Amo 2026-04-11.jpg', license: 'CC0' },
  'banh-mi-bo-toi': {
    file: 'Garlic Bread Mozzarella - Oregano Pizzeria 2025-05-17.jpg',
    license: 'CC0',
  },
  'goi-cuon-tom-thit': { file: 'Gỏi cuốn.jpg', license: 'CC0' },
  'bit-tet-than-bo-uc': { file: 'Steak Dinner (Unsplash).jpg', license: 'CC0' },
  'suon-cuu-nuong-thao-moc': { file: 'Grilled lamb chops.jpg', license: 'CC0' },
  'ba-chi-heo-nuong-mat-ong': { file: 'Grilled kurobuta pork belly 01.jpg', license: 'CC BY 2.0' },
  'ga-nuong-la-chanh': { file: 'Grilled chicken and risotto.jpg', license: 'CC BY-SA 4.0' },
  'ca-hoi-ap-chao-sot-chanh-day': { file: 'Grilled plated salmon fillet.jpg', license: 'CC0' },
  'mi-y-sot-bo-bam': {
    file: 'Spaghetti Bolognese - Figaros, Brighton 2023-10-06.jpg',
    license: 'CC0',
  },
  'mi-y-hai-san-sot-kem': {
    file: 'Seafood cream spaghetti (8192349219).jpg',
    license: 'CC BY-SA 2.0',
  },
  'pizza-margherita': { file: 'Margherita Originale.JPG', license: 'CC BY-SA 3.0' },
  'com-chien-hai-san': { file: 'Seafood Fried Rice.jpg', license: 'CC BY-SA 4.0' },
  tiramisu: { file: 'Tiramisu dessert.jpg', license: 'CC BY-SA 4.0' },
  'banh-flan-caramel': { file: 'Homemade Flan.jpg', license: 'CC BY-SA 2.5' },
  'kem-vani-dau-tay': { file: 'Strawberry and vanilla ice cream.jpg', license: 'CC BY-SA 4.0' },
  'nuoc-cam-ep': { file: 'Fresh orange juice.jpg', license: 'CC BY-SA 4.0' },
  'tra-dao-cam-sa': { file: 'Peach iced tea.jpg', license: 'CC BY-SA 4.0' },
  'ca-phe-sua-da': { file: 'Ca Phe Sua Da.jpg', license: 'CC BY 2.5' },
  'ruou-vang-do-ly': { file: 'Wine being poured into a glass.jpg', license: 'CC BY 2.0' },
  'bia-heineken': { file: 'Glass of heineken beer (23019967875).jpg', license: 'CC0' },
  'nuoc-suoi': {
    file: 'Person pours water from a bottle into a glass in a kitchen.jpg',
    license: 'CC BY 2.0',
  },
};
