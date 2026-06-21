import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuditLogService } from '../../audit/audit-log.service';

import { CompanyProfileService } from './company-profile.service';

const TENANT_ID = 't-1';
const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

function makeProfileRow(over: Record<string, unknown> = {}) {
  return {
    id: 'cp-1',
    tenantId: TENANT_ID,
    externalSource: null,
    displayName: null,
    missionJson: null,
    visionJson: null,
    strategyJson: null,
    targetMarketIds: [] as string[],
    maturityScore: null,
    lastMaturityCalcAt: null,
    stage: null,
    sourceBlockIds: [] as string[],
    confidence: null,
    summaryJson: null,
    summaryPinned: false,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...over,
  };
}

describe('CompanyProfileService.applyAutoSummary', () => {
  let findUnique: ReturnType<typeof vi.fn>;
  let upsert: ReturnType<typeof vi.fn>;
  let svc: CompanyProfileService;

  beforeEach(() => {
    findUnique = vi.fn();
    upsert = vi.fn().mockResolvedValue(makeProfileRow());

    const prisma = {
      companyProfile: { findUnique, upsert },
    } as unknown as PrismaService;
    const audit = { log: vi.fn() } as unknown as AuditLogService;

    svc = new CompanyProfileService(prisma, audit);
  });

  it('summaryPinned=true → не перетирает (applied:false, reason:pinned), upsert не вызван', async () => {
    findUnique.mockResolvedValue({ id: 'cp-1', summaryPinned: true });

    const res = await svc.applyAutoSummary({
      tenantId: TENANT_ID,
      contentMd: 'Кора — память компании',
      sourceBlockIds: ['b-1', 'b-2'],
      confidence: 0.9,
    });

    expect(res).toEqual({ applied: false, reason: 'pinned' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('не закреплён → upsert вызван с summaryJson.contentMd, applied:true reason:updated', async () => {
    findUnique.mockResolvedValue({ id: 'cp-1', summaryPinned: false });

    const res = await svc.applyAutoSummary({
      tenantId: TENANT_ID,
      contentMd: 'Кора — память компании',
      sourceBlockIds: ['b-1'],
      confidence: 0.8,
    });

    expect(res).toEqual({ applied: true, reason: 'updated' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT_ID },
        update: expect.objectContaining({
          summaryJson: expect.objectContaining({ contentMd: 'Кора — память компании' }),
          sourceBlockIds: ['b-1'],
        }),
        create: expect.objectContaining({
          tenantId: TENANT_ID,
          summaryJson: expect.objectContaining({ contentMd: 'Кора — память компании' }),
        }),
      }),
    );
  });
});

describe('CompanyProfileService.update — summary/summaryPinned', () => {
  it('сохраняет summaryJson и summaryPinned=true', async () => {
    const findUnique = vi.fn().mockResolvedValue(makeProfileRow());
    const update = vi
      .fn()
      .mockResolvedValue(makeProfileRow({ summaryJson: { contentMd: 'X' }, summaryPinned: true }));

    const prisma = {
      companyProfile: { findUnique, create: vi.fn(), update },
    } as unknown as PrismaService;
    const audit = { log: vi.fn() } as unknown as AuditLogService;
    const svc = new CompanyProfileService(prisma, audit);

    await svc.update({
      tenantId: TENANT_ID,
      userId: 'u-1',
      body: { summary: { contentMd: 'X' }, summaryPinned: true },
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT_ID },
        data: expect.objectContaining({
          summaryJson: expect.objectContaining({ contentMd: 'X' }),
          summaryPinned: true,
        }),
      }),
    );
  });
});
