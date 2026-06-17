import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';

import { AdminBillingController } from './admin-billing.controller';
import { BillingOverviewService } from './services/billing-overview.service';
import { InvoiceService } from './services/invoice.service';
import { ManualBillingService } from './services/manual-billing.service';
import { SubscriptionService } from './services/subscription.service';

const AUTH_USER = { id: 'user_admin_1', email: 'a@b.c', role: 'admin', isSuperAdmin: true };

class AllowAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    req.user = { ...AUTH_USER };
    return true;
  }
}
class AllowSuperAdminGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

describe('AdminBillingController (e2e) — activate', () => {
  let app: INestApplication;
  const manualActivate = vi.fn();

  async function boot() {
    const mod = await Test.createTestingModule({
      controllers: [AdminBillingController],
      providers: [
        { provide: PrismaService, useValue: {} },
        { provide: SubscriptionService, useValue: { getByTenant: vi.fn() } },
        { provide: InvoiceService, useValue: { listByTenant: vi.fn() } },
        { provide: ManualBillingService, useValue: { activate: manualActivate } },
        { provide: BillingOverviewService, useValue: { getOverview: vi.fn() } },
      ],
    })
      .overrideGuard(CookieAuthGuard)
      .useClass(AllowAuthGuard)
      .overrideGuard(SuperAdminGuard)
      .useClass(AllowSuperAdminGuard)
      .compile();
    app = mod.createNestApplication();
    await app.init();
  }

  afterEach(async () => {
    manualActivate.mockReset();
    await app?.close();
  });

  const TENANT = 'cmpndk2tw000101mwmixvacuj';
  const validBody = {
    billingPeriod: 'monthly',
    seatsExtra: 0,
    startedAt: new Date('2026-06-03T05:00:00.000Z').toISOString(),
    paymentMode: 'bonus',
    reason: '111',
  };

  it('валидное тело + tenantId в пути → 201 (баг был 400)', async () => {
    manualActivate.mockResolvedValue({
      subscription: { id: 'sub_1' },
      invoiceId: 'inv_1',
      grantedMeetings: 10,
    });
    await boot();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/orgs/${TENANT}/billing/activate`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      subscriptionId: 'sub_1',
      invoiceId: 'inv_1',
      grantedMeetings: 10,
    });
    expect(manualActivate).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, byUserId: AUTH_USER.id, paymentMode: 'bonus' }),
    );
  });

  it('reason < 3 символов → 400 validation_error (валидация тела жива)', async () => {
    await boot();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/orgs/${TENANT}/billing/activate`)
      .send({ ...validBody, reason: 'x' });

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('validation_error');
    expect(manualActivate).not.toHaveBeenCalled();
  });
});
