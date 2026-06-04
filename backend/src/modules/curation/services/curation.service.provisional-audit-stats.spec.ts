import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational/conversational.service';

import { CurationService } from './curation.service';
import type { CuratorRoutingService } from './curator-routing.service';

/**
 * Action Center A2 «лестница доверия» (2026-06-02) — юнит-тесты
 * getProvisionalAuditStats.
 *
 * Проверяют:
 *   1. wrongRate считается только по аудит-выборке (triageReason.reason=
 *      'audit_sample'); reject/mark_as_misleading/supersede = wrong.
 *   2. items без аудит-маркера / без решений не учитываются.
 *   3. 0 при отсутствии аудит-решений.
 */
describe('CurationService.getProvisionalAuditStats (A2)', () => {
  let prisma: PrismaService;
  let svc: CurationService;
  let findManyMock: ReturnType<typeof vi.fn>;

  function decision(decisionType: string, isoTs: string) {
    return { decisionType, createdAt: new Date(isoTs) };
  }
  function auditItem(
    resourceType: string,
    decisions: Array<{ decisionType: string; createdAt: Date }>,
  ) {
    return {
      resourceType,
      triageReason: { reason: 'audit_sample', trustTier: 'provisional' },
      decisions,
    };
  }

  beforeEach(() => {
    findManyMock = vi.fn();
    prisma = {
      curationItem: { findMany: findManyMock },
    } as unknown as PrismaService;

    const cfg = {
      curation: {
        autoThresholdDefault: 0.85,
        deepReviewThresholdDefault: 0.6,
        criticalTypesDefault: [],
        itemExpiryDays: 30,
      },
    } as unknown as TypedConfigService;
    const metrics = {} as unknown as BusinessMetricsService;
    const conversational = {} as unknown as ConversationalService;
    const routing = {} as unknown as CuratorRoutingService;

    svc = new CurationService(
      prisma,
      cfg,
      metrics,
      conversational,
      routing,
      null,
      null,
    );
  });

  it('считает provisionalWrongRate только по аудит-выборке', async () => {
    findManyMock.mockResolvedValue([
      // regulation: 4 аудит-решения, 2 wrong (reject + supersede) → 0.5
      auditItem('regulation', [decision('approve', '2026-06-01T10:00:00Z')]),
      auditItem('regulation', [decision('reject', '2026-06-01T10:00:00Z')]),
      auditItem('regulation', [decision('supersede', '2026-06-01T10:00:00Z')]),
      auditItem('regulation', [
        decision('approve_with_edits', '2026-06-01T10:00:00Z'),
      ]),
      // process: 1 wrong (mark_as_misleading) → 1.0
      auditItem('process', [decision('mark_as_misleading', '2026-06-01T10:00:00Z')]),
      // НЕ аудит (обычный triage) — должен игнорироваться полностью.
      {
        resourceType: 'regulation',
        triageReason: { reason: 'stale' },
        decisions: [decision('reject', '2026-06-01T10:00:00Z')],
      },
    ]);

    const { items } = await svc.getProvisionalAuditStats({ tenantId: 't-1' });

    const reg = items.find((i) => i.resourceType === 'regulation')!;
    expect(reg.auditDecided).toBe(4);
    expect(reg.auditWrong).toBe(2);
    expect(reg.provisionalWrongRate).toBeCloseTo(0.5, 6);

    const proc = items.find((i) => i.resourceType === 'process')!;
    expect(proc.auditDecided).toBe(1);
    expect(proc.auditWrong).toBe(1);
    expect(proc.provisionalWrongRate).toBe(1);
  });

  it('аудит-item без финального решения не считается decided', async () => {
    findManyMock.mockResolvedValue([
      auditItem('regulation', []),
      auditItem('regulation', [decision('escalate', '2026-06-01T10:00:00Z')]),
    ]);
    const { items } = await svc.getProvisionalAuditStats({ tenantId: 't-1' });
    expect(items).toEqual([]);
  });

  it('0 при отсутствии аудит-решений (только approve = wrongRate 0)', async () => {
    findManyMock.mockResolvedValue([
      auditItem('regulation', [decision('approve', '2026-06-01T10:00:00Z')]),
    ]);
    const { items } = await svc.getProvisionalAuditStats({ tenantId: 't-1' });
    const reg = items.find((i) => i.resourceType === 'regulation')!;
    expect(reg.auditDecided).toBe(1);
    expect(reg.auditWrong).toBe(0);
    expect(reg.provisionalWrongRate).toBe(0);
  });

  it('пустой набор → пустой результат', async () => {
    findManyMock.mockResolvedValue([]);
    const { items } = await svc.getProvisionalAuditStats({ tenantId: 't-1' });
    expect(items).toEqual([]);
  });
});
