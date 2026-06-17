import {
  Controller,
  Get,
  type INestApplication,
  MiddlewareConsumer,
  Module,
  type NestModule,
  Param,
  Req,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { TenantMiddleware } from './tenant.middleware';

@Controller('api/v1/orgs')
class OrgsProbeController {
  @Get(':id/invitations')
  inv(
    @Param('id') id: string,
    @Req() req: Request & { tenantId?: string },
  ): { id: string; tenantId: string | null } {
    return { id, tenantId: req.tenantId ?? null };
  }
}

@Module({ controllers: [OrgsProbeController] })
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('api/v1/{*path}');
  }
}

describe('TenantMiddleware — резолвинг tenant из пути /orgs/:id', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  async function boot() {
    const mod = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  }

  it('orgId в пути → req.tenantId выставлен (через originalUrl)', async () => {
    await boot();
    const orgId = 'cmpp5tpo3000001pqb4hseduf';
    const res = await request(app.getHttpServer()).get(`/api/v1/orgs/${orgId}/invitations`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: orgId, tenantId: orgId });
  });

  it('X-Org-Id header имеет приоритет над путём', async () => {
    await boot();
    const res = await request(app.getHttpServer())
      .get('/api/v1/orgs/cmpp5tpo3000001pqb4hseduf/invitations')
      .set('X-Org-Id', 'cmHEADERoverride0001');
    expect(res.body.tenantId).toBe('cmHEADERoverride0001');
  });
});
