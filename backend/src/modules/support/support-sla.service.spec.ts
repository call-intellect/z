import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import type { SupportAccessService } from './services/support-access.service';
import { SupportSlaService } from './services/support-sla.service';

const VENDOR_ORG = 'vendor-org-1';

function makeAccess(vendorOrgId: string | null): SupportAccessService {
  return {
    getVendorOrgId: vi.fn(async () => vendorOrgId),
  } as unknown as SupportAccessService;
}

describe('SupportSlaService', () => {
  it('computeDueDates: дефолты 60/480, если нет SupportSlaPolicy', async () => {
    const prisma = {
      supportSlaPolicy: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaService;
    const svc = new SupportSlaService(prisma, makeAccess(VENDOR_ORG));
    const created = new Date('2026-06-09T10:00:00Z');
    const { firstResponseDueAt, resolutionDueAt } = await svc.computeDueDates(VENDOR_ORG, created);
    expect(firstResponseDueAt.getTime()).toBe(created.getTime() + 60 * 60_000);
    expect(resolutionDueAt.getTime()).toBe(created.getTime() + 480 * 60_000);
  });

  it('computeDueDates: использует значения из SupportSlaPolicy', async () => {
    const prisma = {
      supportSlaPolicy: {
        findUnique: vi.fn(async () => ({
          firstResponseMins: 15,
          resolutionMins: 120,
        })),
      },
    } as unknown as PrismaService;
    const svc = new SupportSlaService(prisma, makeAccess(VENDOR_ORG));
    const created = new Date('2026-06-09T10:00:00Z');
    const { firstResponseDueAt, resolutionDueAt } = await svc.computeDueDates(VENDOR_ORG, created);
    expect(firstResponseDueAt.getTime()).toBe(created.getTime() + 15 * 60_000);
    expect(resolutionDueAt.getTime()).toBe(created.getTime() + 120 * 60_000);
  });

  it('markBreaches: 1 просроченный тикет → updateMany вызван с его id, slaBreachedAt', async () => {
    const findMany = vi.fn(async () => [{ id: 'ticket-late-1' }]);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      supportTicket: { findMany, updateMany },
    } as unknown as PrismaService;
    const svc = new SupportSlaService(prisma, makeAccess(VENDOR_ORG));
    const now = new Date('2026-06-09T12:00:00Z');
    const count = await svc.markBreaches(now);
    expect(count).toBe(1);

    const whereArg = (findMany.mock.calls[0] as unknown[])[0] as {
      where: Record<string, unknown>;
    };
    expect(whereArg.where.tenantId).toBe(VENDOR_ORG);
    expect(whereArg.where.firstRespondedAt).toBeNull();
    expect(whereArg.where.slaBreachedAt).toBeNull();
    expect(whereArg.where.status).toEqual({ notIn: ['resolved', 'closed'] });

    const updArg = (updateMany.mock.calls[0] as unknown[])[0] as {
      where: { id: { in: string[] } };
      data: { slaBreachedAt: Date };
    };
    expect(updArg.where.id.in).toEqual(['ticket-late-1']);
    expect(updArg.data.slaBreachedAt).toBe(now);
  });

  it('markBreaches: нет вендор-Org → 0 без запроса', async () => {
    const findMany = vi.fn();
    const prisma = {
      supportTicket: { findMany },
    } as unknown as PrismaService;
    const svc = new SupportSlaService(prisma, makeAccess(null));
    const count = await svc.markBreaches(new Date());
    expect(count).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
