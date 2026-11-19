import type { Router } from 'express';
import { VALIDATION_SCHEMAS, type ValidationSchemas } from '../../src/middlewares/validate';

type Layer = {
  rawPath?: unknown;
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
  handle: { stack?: Layer[]; [VALIDATION_SCHEMAS]?: ValidationSchemas };
};

export interface RegisteredRoute {
  method: string;
  /** Path theo cú pháp OpenAPI (`/admin/tables/{id}`), tương đối với /api/v1. */
  path: string;
  /** Schema zod truyền vào `validate()` của route (nếu có). */
  schemas: ValidationSchemas;
}

/** Liệt kê mọi route đã đăng ký trong router (đi qua các router con lồng nhau). */
export function listRoutes(router: Router): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        const schemas: ValidationSchemas = {};
        for (const handler of layer.route.stack) {
          Object.assign(schemas, handler.handle[VALIDATION_SCHEMAS] ?? {});
        }
        const path = (`${prefix}${layer.route.path}`.replace(/\/$/, '') || '/').replace(
          /:(\w+)/g,
          '{$1}',
        );
        for (const method of Object.keys(layer.route.methods)) {
          routes.push({ method, path, schemas });
        }
      } else if (layer.handle.stack) {
        const mount =
          typeof layer.rawPath === 'string' && layer.rawPath !== '/' ? layer.rawPath : '';
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  walk((router as unknown as { stack: Layer[] }).stack, '');
  return routes;
}
