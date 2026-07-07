import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { OperationsDashboardService } from './operations-dashboard.service';

describe('OperationsDashboardService.getTeamFrictions — anti-leak', () => {
  it('НЕ отдаёт sourceBlockIds наружу, даже если строка БД его содержит', async () => {
    const prisma = {
      entityLink: {
        findMany: vi.fn(async () => [
          {
            id: 'l-1',
            fromEntityId: 'e-1',
            toEntityId: 'e-2',
            relationType: 'conflicted_with',
            confidence: { toString: () => '0.82' },
            explanation: 'спор о сроках',
            createdAt: new Date('2026-06-27T00:00:00Z'),
            validFrom: new Date('2026-06-27T00:00:00Z'),
            sourceBlockIds: ['b-1', 'b-2'],
          },
        ]),
      },
      person: {
        findMany: vi.fn(async () => [
          { id: 'p-1', entityId: 'e-1', name: 'Аня' },
          { id: 'p-2', entityId: 'e-2', name: 'Миша' },
        ]),
      },
    } as unknown as PrismaService;

    const svc = new OperationsDashboardService(
      prisma,
      {} as unknown as TypedConfigService,
      {} as unknown as BusinessMetricsService,
    );

    const res = await svc.getTeamFrictions({ tenantId: 't-1' });

    expect(res.items).toHaveLength(1);
    const [item] = res.items;
    if (!item) throw new Error('item missing');
    expect(item).toMatchObject({
      id: 'l-1',
      fromPersonName: 'Аня',
      toPersonName: 'Миша',
    });
    expect(typeof item.confidence).toBe('number');
    expect('sourceBlockIds' in item).toBe(false);
    expect(Object.keys(item)).not.toContain('sourceBlockIds');
  });
});
