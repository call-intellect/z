import { describe, expect, it, vi } from 'vitest';

import { DailyDigestService } from './daily-digest.service';

/**
 * ТЗ-2 Ф3 — секция «Хронические блокеры» (chronicBlockers) в ежедневном
 * дайджесте.
 *
 * Тестируем сборку chronicBlockers внутри `computeRuntimeSections` через
 * публичную точку `getStored` (она зовёт `enrichDto` → `computeRuntimeSections`).
 * Метод приватный, поэтому идём через выдачу DTO с замоканной существующей
 * записью дайджеста.
 *
 * Проверяем:
 *   - listChronicForTenant вернул элементы → chronicBlockers замаплены в DTO
 *     (id/representativeText/status/daysOpen/linkedInsightId/responsiblePersonId),
 *     поля businessImpactScore/даты отброшены.
 *   - listChronicForTenant бросил ошибку → chronicBlockers=[] (дайджест не падает).
 *   - listChronicForTenant вызван с { tenantId, limit: 5 }.
 */

const TENANT = 't1';
const DATE = '2026-05-24';

function buildSvc(overrides: {
  chronic?: unknown[];
  chronicReject?: Error;
}) {
  const storedRow = {
    id: 'dd1',
    tenantId: TENANT,
    dateLocal: DATE,
    bodyMarkdown: 'текст',
    metricsJson: {},
    sourcesJson: {},
    llmTaskRouteId: 'deepseek:deepseek-chat',
    shortSummary: 'кратко',
    deliveredAt: null,
    createdAt: new Date('2026-05-25T01:00:00Z'),
  };

  // computeRuntimeSections делает много findMany — все пустые.
  const prisma = {
    dailyOperationsDigest: {
      findUnique: vi.fn().mockResolvedValue(storedRow),
    },
    meeting: { findMany: vi.fn().mockResolvedValue([]) },
    decision: { findMany: vi.fn().mockResolvedValue([]) },
    insight: { findMany: vi.fn().mockResolvedValue([]) },
    dailyCheckIn: { findMany: vi.fn().mockResolvedValue([]) },
    ideaBlock: { findMany: vi.fn().mockResolvedValue([]) },
    recognition: { findMany: vi.fn().mockResolvedValue([]) },
    helpfulnessSpotlight: { findMany: vi.fn().mockResolvedValue([]) },
    person: { findMany: vi.fn().mockResolvedValue([]) },
  };

  const llm = { call: vi.fn() };
  const metrics = {
    incCooDailyDigestGenerated: vi.fn(),
    incCooDailyDigestFailed: vi.fn(),
    setCooDailyDigestAge: vi.fn(),
  };
  const pendingActions = { getCount: vi.fn() };
  const customerRisk = { topForDigest: vi.fn().mockResolvedValue([]) };
  const blockerSynthesis = {
    listChronicForTenant: overrides.chronicReject
      ? vi.fn().mockRejectedValue(overrides.chronicReject)
      : vi.fn().mockResolvedValue(overrides.chronic ?? []),
  };

  const svc = new DailyDigestService(
    prisma as never,
    llm as never,
    metrics as never,
    pendingActions as never,
    customerRisk as never,
    blockerSynthesis as never,
  );
  return { svc, blockerSynthesis };
}

describe('DailyDigestService.chronicBlockers (ТЗ-2 Ф3)', () => {
  it('listChronicForTenant вернул элементы → замаплены в DTO (без impact/дат)', async () => {
    const { svc, blockerSynthesis } = buildSvc({
      chronic: [
        {
          id: 'bs1',
          representativeText: 'нет доступа к проду',
          status: 'recurring',
          daysOpen: 5,
          businessImpactScore: 42.7,
          firstSeenDateLocal: '2026-05-19',
          lastSeenDateLocal: '2026-05-24',
          linkedInsightId: 'ins1',
          responsiblePersonId: 'p1',
        },
        {
          id: 'bs2',
          representativeText: 'жду решения по бюджету',
          status: 'new',
          daysOpen: 1,
          businessImpactScore: 10,
          firstSeenDateLocal: '2026-05-24',
          lastSeenDateLocal: '2026-05-24',
          linkedInsightId: null,
          responsiblePersonId: null,
        },
      ],
    });
    const dto = await svc.getStored({ tenantId: TENANT, dateLocal: DATE });
    expect(dto).not.toBeNull();
    expect(dto!.chronicBlockers).toHaveLength(2);

    const first = dto!.chronicBlockers[0]!;
    expect(first).toEqual({
      id: 'bs1',
      representativeText: 'нет доступа к проду',
      status: 'recurring',
      daysOpen: 5,
      linkedInsightId: 'ins1',
      responsiblePersonId: 'p1',
    });
    // businessImpactScore / даты не выносятся в DTO.
    expect(first).not.toHaveProperty('businessImpactScore');
    expect(first).not.toHaveProperty('firstSeenDateLocal');
    expect(first).not.toHaveProperty('lastSeenDateLocal');

    expect(blockerSynthesis.listChronicForTenant).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, limit: 5 }),
    );
  });

  it('listChronicForTenant бросил ошибку → chronicBlockers=[] (не падает)', async () => {
    const { svc } = buildSvc({ chronicReject: new Error('bs down') });
    const dto = await svc.getStored({ tenantId: TENANT, dateLocal: DATE });
    expect(dto).not.toBeNull();
    expect(dto!.chronicBlockers).toEqual([]);
  });

  it('синтез пуст → chronicBlockers=[]', async () => {
    const { svc } = buildSvc({ chronic: [] });
    const dto = await svc.getStored({ tenantId: TENANT, dateLocal: DATE });
    expect(dto!.chronicBlockers).toEqual([]);
  });
});
