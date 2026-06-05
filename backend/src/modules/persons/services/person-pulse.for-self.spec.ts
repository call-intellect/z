/**
 * Юнит-тесты self-режима `PersonPulseService.getPulse` (ТЗ-E Фаза 2).
 *
 * Проверяем три инварианта self-vs-manager без реальной БД/Redis —
 * конструктор сервиса вызывается напрямую с замоканными зависимостями
 * (Prisma / Redis / CommitmentReliabilityService):
 *   1. forSelf:true → hrSuggestions === null и hrSuggestionsGeneratedAt === null
 *      (служебная аналитика руководителя не отдаётся в self-режиме).
 *   2. forSelf отсутствует/false → hrSuggestions НЕ null (manager-вид сохранён).
 *   3. Кэш-ключ self ≠ mgr — redis.client.get вызывается с ключом,
 *      содержащим ':self' при forSelf=true и ':mgr' при forSelf=false.
 *
 * Redis: get → null (cache miss), set → no-op. Так каждый вызов идёт в «live»
 * ветку и формирует DTO из мок-person.
 */
import { describe, expect, it, vi } from 'vitest';

import { PersonPulseService } from './person-pulse.service';

/** Валидный `hrSuggestionsJson` с одной рекомендацией (формат HrRecommenderCron). */
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

/**
 * Мок-person со ВСЕМИ полями, которые запрашивает `select` в getPulse, —
 * иначе на runtime получим undefined при чтении.
 */
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

/** Заглушка CommitmentReliabilityService.getReliability — валидный DTO. */
function buildCommitsStub() {
  return {
    getReliability: vi.fn(async () => ({
      kept: 3,
      broken: 1,
      overdue: 0,
      reliabilityPercent: 75,
      delta14d: 5,
      weeklyTrend: [],
    })),
  };
}

/**
 * Собирает сервис + возвращает шпион на `redis.client.get`, чтобы проверять,
 * с каким cache-ключом он вызван.
 */
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

  // Явные сигнатуры с аргументами — иначе vi.fn выводит арность [] и
  // redisGet.mock.calls[i][0] не типизируется как string.
  const redisGet = vi.fn(async (_key: string): Promise<string | null> => null); // cache miss
  const redisSet = vi.fn(
    async (_key: string, _val: string, _mode: string, _ttl: number): Promise<string> => 'OK',
  ); // no-op
  const redis = { client: { get: redisGet, set: redisSet } };

  const commits = buildCommitsStub();

  const svc = new PersonPulseService(
    prisma as never,
    redis as never,
    commits as never,
  );

  return { svc, redisGet, redisSet, prisma, commits };
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
