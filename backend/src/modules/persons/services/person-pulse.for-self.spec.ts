import { describe, expect, it, vi } from 'vitest';

import { PersonPulseService } from './person-pulse.service';

const HR_JSON = {
  generatedAt: '2026-06-01T10:00:00.000Z',
  recommendations: [
    {
      type: 'praise',
      text: 'Отметить вклад в проект',
      signals: ['high engagement'],
      confidence: 0.8,
    },
  ],
};

function buildPerson() {
  return {
    id: 'p-1',
    name: 'Иван Иванов',
    email: 'ivan@example.com',
    userId: 'u-1',
    engagementScore: 0.75,
    engagementScoreAt: new Date('2026-06-01T09:00:00.000Z'),
    hrSuggestionsJson: HR_JSON,
    riskFlagsJson: null,
    primaryDepartment: { id: 'd-1', name: 'Продажи', headPersonId: 'p-2' },
  };
}

function buildService(opts?: { person?: unknown }) {
  const person = 'person' in (opts ?? {}) ? opts!.person : buildPerson();

  const prisma = {
    person: {
      findFirst: vi.fn(async () => person),
    },
    dailyCheckIn: {
      findMany: vi.fn(async () => []),
    },
  };

  const redisGet = vi.fn(async (_key: string): Promise<string | null> => null);
  const redisSet = vi.fn(
    async (_key: string, _val: string, _mode: string, _ttl: number): Promise<string> => 'OK',
  );
  const redis = { client: { get: redisGet, set: redisSet } };

  const svc = new PersonPulseService(prisma as never, redis as never);

  return { svc, redisGet, redisSet, prisma };
}

describe('PersonPulseService.getPulse — self-режим (ТЗ-E Фаза 2)', () => {
  it('forSelf:true → hrSuggestions и hrSuggestionsGeneratedAt = null', async () => {
    const { svc } = buildService();

    const result = await svc.getPulse({
      tenantId: 'org-1',
      personId: 'p-1',
      forSelf: true,
    });

    expect(result.hrSuggestions).toBeNull();
    expect(result.hrSuggestionsGeneratedAt).toBeNull();
  });

  it('forSelf не передан → hrSuggestions НЕ null (manager-вид сохранён)', async () => {
    const { svc } = buildService();

    const result = await svc.getPulse({
      tenantId: 'org-1',
      personId: 'p-1',
    });

    expect(result.hrSuggestions).not.toBeNull();
    expect(result.hrSuggestions).toHaveLength(1);
    expect(result.hrSuggestions?.[0]?.type).toBe('praise');
    expect(result.hrSuggestionsGeneratedAt).toBe(HR_JSON.generatedAt);
  });

  it('forSelf:false → hrSuggestions НЕ null (явный manager-вид)', async () => {
    const { svc } = buildService();

    const result = await svc.getPulse({
      tenantId: 'org-1',
      personId: 'p-1',
      forSelf: false,
    });

    expect(result.hrSuggestions).not.toBeNull();
    expect(result.hrSuggestions).toHaveLength(1);
  });

  it('кэш-ключ self содержит ":self"', async () => {
    const { svc, redisGet } = buildService();

    await svc.getPulse({ tenantId: 'org-1', personId: 'p-1', forSelf: true });

    expect(redisGet).toHaveBeenCalledWith(expect.stringContaining(':self'));
  });

  it('кэш-ключ manager содержит ":mgr"', async () => {
    const { svc, redisGet } = buildService();

    await svc.getPulse({ tenantId: 'org-1', personId: 'p-1', forSelf: false });

    expect(redisGet).toHaveBeenCalledWith(expect.stringContaining(':mgr'));
  });

  it('self и manager используют РАЗНЫЕ cache-ключи', async () => {
    const { svc, redisGet } = buildService();

    await svc.getPulse({ tenantId: 'org-1', personId: 'p-1', forSelf: true });
    await svc.getPulse({ tenantId: 'org-1', personId: 'p-1', forSelf: false });

    const keys = redisGet.mock.calls.map((c) => c[0] as string);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.some((k) => k.includes(':self'))).toBe(true);
    expect(keys.some((k) => k.includes(':mgr'))).toBe(true);
  });
});
