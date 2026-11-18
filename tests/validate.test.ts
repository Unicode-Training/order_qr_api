import express from 'express';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorHandler, validate } from '../src/middlewares';
import { paginationQuerySchema } from '../src/utils/pagination';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post(
    '/items/:id',
    validate({
      params: z.object({ id: z.string().regex(/^\d+$/) }),
      query: paginationQuerySchema,
      body: z.object({ name: z.string().min(1) }),
    }),
    (req, res) => {
      res.json({ params: req.params, query: req.query, body: req.body });
    },
  );
  app.use(errorHandler);
  return app;
}

describe('validate middleware', () => {
  it('gán lại giá trị đã parse (coerce + default) vào req', async () => {
    const res = await supertest(buildApp()).post('/items/12?page=2').send({ name: 'Phở' });

    expect(res.status).toBe(200);
    expect(res.body.query).toEqual({ page: 2, limit: 20 });
    expect(res.body.params).toEqual({ id: '12' });
  });

  it('trả 400 VALIDATION_ERROR kèm details theo vị trí', async () => {
    const res = await supertest(buildApp()).post('/items/abc?limit=1000').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const locations = res.body.error.details.map((d: { location: string }) => d.location);
    expect(locations).toEqual(expect.arrayContaining(['params', 'query', 'body']));
  });
});
