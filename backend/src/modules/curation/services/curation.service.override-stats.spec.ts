import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational/conversational.service';

import { CurationService } from './curation.service';
import type { CuratorRoutingService } from './curator-routing.service';

/**
 * A0 «лестница доверия» (2026-06-02) — юнит-тесты getOverrideStats.
 *
 * Проверяют:
 *   1. Корректный overrideRate per resourceType ((reject + approve_with_edits)/totalDecided).
 *   2. overrideRate=0 и item не считается decided, когда финального решения нет.
 *   3. 'escalate' не считается финальным; финал = последнее не-escalate решение.
 */
describe('CurationService.getOverrideStats (A0)', () => {
  let prisma: PrismaService;
  let svc: CurationService;
  let findManyMock: ReturnType<typeof vi.fn>;

  function decision(decisionType: string, isoTs: string) {
    return { decisionType, createdAt: new Date(isoTs) };
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

  it('считает overrideRate per resourceType', async () => {
    findManyMock.mockResolvedValue([
      // fact: approve, reject, approve_with_edits → 3 decided, override = 2/3
      { resourceType: 'fact', decisions: [decision('approve', '2026-06-01T10:00:00Z')] },
      { resourceType: 'fact', decisions: [decision('reject', '2026-06-01T10:00:00Z')] },
      {
        resourceType: 'fact',
        decisions: [decision('approve_with_edits', '2026-06-01T10:00:00Z')],
      },
      // note: один approve → override = 0/1 = 0
      { resourceType: 'note', decisions: [decision('approve', '2026-06-01T10:00:00Z')] },
    ]);

    const { items } = await svc.getOverrideStats({ tenantId: 't-1' });

    const fact = items.find((i) => i.resourceType === 'fact')!;
    expect(fact.totalDecided).toBe(3);
    expect(fact.approve).toBe(1);
    expect(fact.reject).toBe(1);
    expect(fact.approveWithEdits).toBe(1);
    expect(fact.overrideRate).toBeCloseTo(2 / 3, 6);

    const note = items.find((i) => i.resourceType === 'note')!;
    expect(note.totalDecided).toBe(1);
    expect(note.overrideRate).toBe(0);
  });

  it('item без решений не считается decided (отсутствует в результате)', async () => {
    findManyMock.mockResolvedValue([
      { resourceType: 'fact', decisions: [] },
    ]);

    const { items } = await svc.getOverrideStats({ tenantId: 't-1' });
    expect(items).toEqual([]);
  });

  it('escalate не финал: item только с escalate не считается decided', async () => {
    findManyMock.mockResolvedValue([
      {
        resourceType: 'fact',
        decisions: [decision('escalate', '2026-06-01T10:00:00Z')],
      },
    ]);

    const { items } = await svc.getOverrideStats({ tenantId: 't-1' });
    expect(items).toEqual([]);
  });

  it('финал = последнее не-escalate решение (escalate в истории игнорируется)', async () => {
    findManyMock.mockResolvedValue([
      {
        resourceType: 'fact',
        decisions: [
          decision('escalate', '2026-06-01T10:00:00Z'),
          decision('approve_with_edits', '2026-06-01T11:00:00Z'),
          decision('escalate', '2026-06-01T12:00:00Z'), // позже, но escalate → игнор
        ],
      },
    ]);

    const { items } = await svc.getOverrideStats({ tenantId: 't-1' });
    const fact = items.find((i) => i.resourceType === 'fact')!;
    expect(fact.totalDecided).toBe(1);
    expect(fact.approveWithEdits).toBe(1);
    expect(fact.overrideRate).toBe(1);
  });

  it('берёт именно ПОСЛЕДНЕЕ не-escalate решение как финал', async () => {
    findManyMock.mockResolvedValue([
      {
        resourceType: 'fact',
        decisions: [
          decision('reject', '2026-06-01T10:00:00Z'),
          decision('approve', '2026-06-01T11:00:00Z'), // позже → финал
        ],
      },
    ]);

    const { items } = await svc.getOverrideStats({ tenantId: 't-1' });
    const fact = items.find((i) => i.resourceType === 'fact')!;
    expect(fact.approve).toBe(1);
    expect(fact.reject).toBe(0);
    expect(fact.overrideRate).toBe(0);
  });

  it('пустой набор items → пустой результат', async () => {
    findManyMock.mockResolvedValue([]);
    const { items } = await svc.getOverrideStats({ tenantId: 't-1' });
    expect(items).toEqual([]);
  });
});
