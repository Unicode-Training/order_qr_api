/** Bỏ dấu tiếng Việt và chuyển về chữ thường: "Phở Bò Tái" → "pho bo tai". */
export function removeVietnameseTones(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Chuỗi dùng để tìm kiếm không dấu (khoảng trắng gộp lại). */
export function toSearchText(value: string): string {
  return removeVietnameseTones(value).replace(/\s+/g, ' ').trim();
}

/** Tạo slug: "Phở Bò Tái Lăn!" → "pho-bo-tai-lan". */
export function slugify(value: string, maxLength = 120): string {
  const slug = removeVietnameseTones(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'item';
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Sinh slug chưa bị dùng: base, base-2, base-3...
 * `exists(slug)` trả true nếu slug đã có (đã loại trừ chính document đang sửa).
 */
export async function generateUniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base);
  if (!(await exists(root))) return root;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${root}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
