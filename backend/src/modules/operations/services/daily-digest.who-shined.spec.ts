import { describe, expect, it, vi } from 'vitest';

import { DailyDigestService } from './daily-digest.service';

const TENANT = 't1';
const DATE = '2026-05-24';
const IN_WINDOW = new Date('2026-05-24T08:00:00.000Z');

function buildSvc(overrides: {
  recognitions?: unknown[];
  helpfulness?: unknown[];
  keptCommits?: unknown[];
  persons?: unknown[];
}) {
  const ideaBlockFindMany = vi
    .fn()
    .mockImplementation((arg: { where?: Record<string, unknown> }) => {
      const where = arg?.where ?? {};
      if (where.commitmentStatus === 'fulfilled') {
        return Promise.resolve(overrides.keptCommits ?? []);
      }
      return Promise.resolve([]);
    });

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

  const prisma = {
    dailyOperationsDigest: {
      findUnique: vi.fn().mockResolvedValue(storedRow),
    },
    meeting: { findMany: vi.fn().mockResolvedValue([]) },
    decision: { findMany: vi.fn().mockResolvedValue([]) },
    insight: { findMany: vi.fn().mockResolvedValue([]) },
    dailyCheckIn: { findMany: vi.fn().mockResolvedValue([]) },
    ideaBlock: { findMany: ideaBlockFindMany },
    recognition: {
      findMany: vi.fn().mockResolvedValue(overrides.recognitions ?? []),
    },
    helpfulnessSpotlight: {
      findMany: vi.fn().mockResolvedValue(overrides.helpfulness ?? []),
    },
    person: {
      findMany: vi.fn().mockResolvedValue(overrides.persons ?? []),
    },
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
    listChronicForTenant: vi.fn().mockResolvedValue([]),
  };

  const svc = new DailyDigestService(
    prisma as never,
    llm as never,
    metrics as never,
    pendingActions as never,
    customerRisk as never,
    blockerSynthesis as never,
  );
  return { svc, prisma };
}

describe('DailyDigestService.whoShined (R6)', () => {
  it('Recognition.toUserId=U + Person(userId=U) → recognition_received', async () => {
    const { svc } = buildSvc({
      recognitions: [
        { toUserId: 'u1', type: 'thanks_helpfulness', createdAt: IN_WINDOW },
        { toUserId: 'u1', type: 'thanks_comment', createdAt: IN_WINDOW },
      ],
      persons: [{ id: 'p1', name: 'Иван', userId: 'u1' }],
    });
    const dto = await svc.getStored({ tenantId: TENANT, dateLocal: DATE });
    expect(dto).not.toBeNull();
    expect(dto!.whoShined).toHaveLength(1);
    const row = dto!.whoShined[0]!;
    expect(row.personId).toBe('p1');
    expect(row.personName).toBe('Иван');
    expect(row.reason).toBe('recognition_received');
    expect(row.detail).toContain('2');
    expect(row.detail).toContain('благодарност');
    expect(row.link).toBe('/persons/p1');
  });

  it('пустые источники → whoShined=[]', async () => {
    const { svc } = buildSvc({});
    const dto = await svc.getStored({ tenantId: TENANT, dateLocal: DATE });
    expect(dto).not.toBeNull();
    expect(dto!.whoShined).toEqual([]);
  });

  it('приоритет: тот же человек в recognition и helpful → recognition_received', async () => {
    const { svc } = buildSvc({
      recognitions: [{ toUserId: 'u1', type: 'mention_helped', createdAt: IN_WINDOW }],
      helpfulness: [{ helperUserId: 'u1', helpCount: 5 }],
      persons: [{ id: 'p1', name: 'Иван', userId: 'u1' }],
    });
    const dto = await svc.getStored({ tenantId: TENANT, dateLocal: DATE });
    expect(dto!.whoShined).toHaveLength(1);
    expect(dto!.whoShined[0]!.reason).toBe('recognition_received');
  });

  it('helpful_acts: helperUserId → Person, склонение «раз»', async () => {
    const { svc } = buildSvc({
      helpfulness: [{ helperUserId: 'u2', helpCount: 3 }],
      persons: [{ id: 'p2', name: 'Мария', userId: 'u2' }],
    });
    const dto = await svc.getStored({ tenantId: TENANT, dateLocal: DATE });
    expect(dto!.whoShined).toHaveLength(1);
    const row = dto!.whoShined[0]!;
    expect(row.reason).toBe('helpful_acts');
    expect(row.personName).toBe('Мария');
    expect(row.detail).toBe('помог 3 раза');
  });

  it('commitments_kept: атрибуция по commitmentAuthorPersonId (не получателю)', async () => {
    const { svc } = buildSvc({
      keptCommits: [
        {
          id: 'b1',
          name: 'выкатить релиз',
          commitmentAuthorPersonId: 'p3',
        },
      ],
      persons: [{ id: 'p3', name: 'Пётр', userId: 'u3' }],
    });
    const dto = await svc.getStored({ tenantId: TENANT, dateLocal: DATE });
    expect(dto!.whoShined).toHaveLength(1);
    const row = dto!.whoShined[0]!;
    expect(row.personId).toBe('p3');
    expect(row.reason).toBe('commitments_kept');
    expect(row.detail).toContain('сдержал обещание');
    expect(row.detail).toContain('выкатить релиз');
  });

  it('Person без userId / без имени → запись пропускается (не «Без имени»)', async () => {
    const { svc } = buildSvc({
      recognitions: [{ toUserId: 'u-unknown', type: 'thanks_comment', createdAt: IN_WINDOW }],
      persons: [{ id: 'p1', name: 'Иван', userId: 'u1' }],
    });
    const dto = await svc.getStored({ tenantId: TENANT, dateLocal: DATE });
    expect(dto!.whoShined).toEqual([]);
  });
});
