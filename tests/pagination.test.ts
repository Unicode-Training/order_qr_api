import { describe, expect, it } from 'vitest';
import { buildPaginationMeta, getPaginationOptions, parseSort } from '../src/utils/pagination';

describe('pagination helper', () => {
  it('tính skip/limit và sort mặc định', () => {
    expect(getPaginationOptions({ page: 3, limit: 10 })).toEqual({
      page: 3,
      limit: 10,
      skip: 20,
      sort: { createdAt: -1 },
    });
  });

  it('parse sort và lọc field không cho phép', () => {
    expect(parseSort('-price,name,$where', ['price', 'name'])).toEqual({ price: -1, name: 1 });
    expect(parseSort('secret', ['price'])).toEqual({ createdAt: -1 });
  });

  it('build meta', () => {
    expect(buildPaginationMeta(45, 2, 20)).toEqual({
      page: 2,
      limit: 20,
      total: 45,
      totalPages: 3,
    });
  });
});
