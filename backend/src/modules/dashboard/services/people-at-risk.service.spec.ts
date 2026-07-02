import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';

import {
  PeopleAtRiskService,
  type PeopleAtRiskThresholds,
  computeMoodPenalty,
  computePulseScore,
  computeTopReason,
  parseRiskFlags,
} from './people-at-risk.service';

const DEFAULTS: PeopleAtRiskThresholds = {
  redMoodShareThreshold: 0.34,
  redMoodPenalty: 15,
  riskThreshold: 60,
};

interface PersonSeed {
  id: string;
  name: string;
  engagementScore: number | null;
  engagementScoreAt?: Date | null;
  riskFlagsJson?: unknown;
  primaryDepartmentId?: string | null;
}

interface CheckInSeed {
  personId: string;
  sentiment: string | null;
}

function makeCfg(overrides: Partial<PeopleAtRiskThresholds> = {}): TypedConfigService {
  const map: Record<string, number> = {
    'peopleAtRisk.redMoodShareThreshold':
      overrides.redMoodShareThreshold ?? DEFAULTS.redMoodShareThreshold,
    'peopleAtRisk.redMoodPenalty': overrides.redMoodPenalty ?? DEFAULTS.redMoodPenalty,
    'peopleAtRisk.riskThreshold': overrides.riskThreshold ?? DEFAULTS.riskThreshold,
  };
  return {
    getDynamic: async <T>(key: string, _env: string | undefined, def: T): Promise<T> =>
      map[key] !== undefined ? (map[key] as unknown as T) : def,
  } as unknown as TypedConfigService;
}

function makeRedis(): RedisService {
  return {
    client: {
      get: async () => null,
      set: async () => 'OK',
    },
  } as unknown as RedisService;
}

function makePrisma(opts: {
  persons: PersonSeed[];
  departments?: Array<{ id: string; name: string }>;
  checkIns?: CheckInSeed[];
  viewerPersonByUserId?: Record<string, string>;
}): PrismaService {
  return {
    person: {
      findMany: vi.fn(async (arg?: { where?: { id?: { not?: string } } }) => {
        const excludeId = arg?.where?.id?.not;
        return opts.persons
          .filter((p) => (excludeId ? p.id !== excludeId : true))
          .map((p) => ({
            id: p.id,
            name: p.name,
            engagementScore: p.engagementScore,
            engagementScoreAt: p.engagementScoreAt ?? null,
            riskFlagsJson: p.riskFlagsJson ?? null,
            primaryDepartmentId: p.primaryDepartmentId ?? null,
          }));
      }),
      findFirst: vi.fn(async (arg?: { where?: { userId?: string } }) => {
        const userId = arg?.where?.userId;
        const personId =
          userId && opts.viewerPersonByUserId ? opts.viewerPersonByUserId[userId] : undefined;
        return personId ? { id: personId } : null;
      }),
    },
    department: {
      findMany: vi.fn(async () => opts.departments ?? []),
    },
    dailyCheckIn: {
      findMany: vi.fn(async () => opts.checkIns ?? []),
    },
  } as unknown as PrismaService;
}

function makeService(opts: {
  persons: PersonSeed[];
  departments?: Array<{ id: string; name: string }>;
  checkIns?: CheckInSeed[];
  thresholds?: Partial<PeopleAtRiskThresholds>;
  viewerPersonByUserId?: Record<string, string>;
}): PeopleAtRiskService {
  return new PeopleAtRiskService(makePrisma(opts), makeRedis(), makeCfg(opts.thresholds));
}

const NOW = new Date('2026-06-05T12:00:00.000Z');

describe('parseRiskFlags (терпимый парсинг)', () => {
  it('валидная структура → массив', () => {
    expect(parseRiskFlags({ flags: [{ type: 'sentiment_dip', severity: 'high' }] })).toEqual([
      { type: 'sentiment_dip', severity: 'high' },
    ]);
  });
  it('null / не-объект / нет flags → []', () => {
    expect(parseRiskFlags(null)).toEqual([]);
    expect(parseRiskFlags(42)).toEqual([]);
    expect(parseRiskFlags({})).toEqual([]);
    expect(parseRiskFlags({ flags: 'bad' })).toEqual([]);
  });
  it('флаг без type отбрасывается; severity по умолчанию low', () => {
    expect(parseRiskFlags({ flags: [{ severity: 'high' }, { type: 'x' }] })).toEqual([
      { type: 'x', severity: 'low' },
    ]);
  });
});

describe('computeMoodPenalty', () => {
  it('mood: redShare>=threshold → penalty; иначе 0', () => {
    expect(computeMoodPenalty(0.34, DEFAULTS)).toBe(15);
    expect(computeMoodPenalty(0.5, DEFAULTS)).toBe(15);
    expect(computeMoodPenalty(0.33, DEFAULTS)).toBe(0);
  });
});

describe('computePulseScore', () => {
  it('engagementScore=null → base=50', () => {
    expect(computePulseScore({ engagementScore: null, redShare30d: 0 }, DEFAULTS)).toBe(50);
  });
  it('0.30 без штрафов → 30', () => {
    expect(computePulseScore({ engagementScore: 0.3, redShare30d: 0 }, DEFAULTS)).toBe(30);
  });
  it('штраф настроения зажимается в 0 (0.10 − 15 = clamp(-5)→0)', () => {
    expect(computePulseScore({ engagementScore: 0.1, redShare30d: 0.5 }, DEFAULTS)).toBe(0);
  });
  it('red-mood штраф применён (0.62 − 15 = 47)', () => {
    expect(computePulseScore({ engagementScore: 0.62, redShare30d: 0.4 }, DEFAULTS)).toBe(47);
  });
});

describe('computeTopReason', () => {
  it('активный флаг severity high (workload_overload) → русская причина', () => {
    expect(
      computeTopReason({
        riskFlagsJson: {
          flags: [
            { type: 'sentiment_dip', severity: 'low' },
            { type: 'workload_overload', severity: 'high' },
          ],
        },
        penMood: 15,
      }),
    ).toBe('Признаки перегрузки — обсудите нагрузку');
  });
  it('нет флагов, есть штраф настроения → причина про настроение', () => {
    expect(
      computeTopReason({
        riskFlagsJson: null,
        penMood: 15,
      }),
    ).toBe('Настроение проседает — стоит спросить, как дела');
  });
  it('fallback (нет флагов, нет штрафов) → причина про вовлечённость', () => {
    expect(
      computeTopReason({
        riskFlagsJson: null,
        penMood: 0,
      }),
    ).toBe('Вовлечённость ниже обычного — повод для короткого 1:1');
  });
});

describe('PeopleAtRiskService.getAtRisk', () => {
  it('кейс §316: 5 сотрудников, ранжирование ASC, totalAtRisk=3', async () => {
    const svc = makeService({
      persons: [
        { id: 'p1', name: 'A', engagementScore: 0.3 },
        { id: 'p2', name: 'B', engagementScore: 0.55 },
        { id: 'p3', name: 'C', engagementScore: 0.85 },
        { id: 'p4', name: 'D', engagementScore: null },
        { id: 'p5', name: 'E', engagementScore: 0.62 },
      ],
    });
    const res = await svc.compute({ tenantId: 't1', limit: 3 }, NOW);

    expect(res.totalAtRisk).toBe(3);
    expect(res.items.map((i) => i.pulseScore)).toEqual([30, 50, 55]);
    expect(res.items.map((i) => i.personId)).toEqual(['p1', 'p4', 'p2']);
    expect(res.generatedAt).toBe(NOW.toISOString());
  });

  it('0 под риском → items:[], totalAtRisk:0', async () => {
    const svc = makeService({
      persons: [
        { id: 'p1', name: 'A', engagementScore: 0.85 },
        { id: 'p2', name: 'B', engagementScore: 0.7 },
      ],
    });
    const res = await svc.compute({ tenantId: 't1', limit: 3 }, NOW);
    expect(res.items).toEqual([]);
    expect(res.totalAtRisk).toBe(0);
  });

  it('engagementScore=null → base=50 (под риском при пороге 60)', async () => {
    const svc = makeService({
      persons: [{ id: 'p1', name: 'A', engagementScore: null }],
    });
    const res = await svc.compute({ tenantId: 't1', limit: 3 }, NOW);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.pulseScore).toBe(50);
  });

  it('red-mood: доля красных >= порога → penMood применён', async () => {
    const svc = makeService({
      persons: [{ id: 'p1', name: 'A', engagementScore: 0.62 }],
      checkIns: [
        { personId: 'p1', sentiment: 'red' },
        { personId: 'p1', sentiment: 'red' },
        { personId: 'p1', sentiment: 'green' },
        { personId: 'p1', sentiment: 'yellow' },
      ],
    });
    const res = await svc.compute({ tenantId: 't1', limit: 3 }, NOW);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.pulseScore).toBe(47);
    expect(res.items[0]!.topReason).toBe('Настроение проседает — стоит спросить, как дела');
  });

  it('topReason: активный флаг high workload_overload приоритетнее штрафов', async () => {
    const svc = makeService({
      persons: [
        {
          id: 'p1',
          name: 'A',
          engagementScore: 0.4,
          riskFlagsJson: {
            flags: [{ type: 'workload_overload', severity: 'high' }],
          },
        },
      ],
    });
    const res = await svc.compute({ tenantId: 't1', limit: 3 }, NOW);
    expect(res.items[0]!.topReason).toBe('Признаки перегрузки — обсудите нагрузку');
  });

  it('topReason fallback (нет флагов/штрафов) + имя отдела + engagementScoreAt ISO', async () => {
    const at = new Date('2026-06-01T08:00:00.000Z');
    const svc = makeService({
      persons: [
        {
          id: 'p1',
          name: 'A',
          engagementScore: 0.5,
          engagementScoreAt: at,
          primaryDepartmentId: 'd1',
        },
      ],
      departments: [{ id: 'd1', name: 'Маркетинг' }],
    });
    const res = await svc.compute({ tenantId: 't1', limit: 3 }, NOW);
    expect(res.items[0]!.topReason).toBe('Вовлечённость ниже обычного — повод для короткого 1:1');
    expect(res.items[0]!.department).toBe('Маркетинг');
    expect(res.items[0]!.engagementScoreAt).toBe(at.toISOString());
  });

  it('totalAtRisk считает всех под порогом, items ограничен limit', async () => {
    const svc = makeService({
      persons: [
        { id: 'p1', name: 'A', engagementScore: 0.1 },
        { id: 'p2', name: 'B', engagementScore: 0.2 },
        { id: 'p3', name: 'C', engagementScore: 0.3 },
        { id: 'p4', name: 'D', engagementScore: 0.4 },
      ],
    });
    const res = await svc.compute({ tenantId: 't1', limit: 2 }, NOW);
    expect(res.totalAtRisk).toBe(4);
    expect(res.items.map((i) => i.pulseScore)).toEqual([10, 20]);
  });
});

describe('PeopleAtRiskService — исключение зрителя', () => {
  it('compute с excludePersonId фильтрует зрителя из выборки', async () => {
    const svc = makeService({
      persons: [
        { id: 'p1', name: 'A', engagementScore: 0.1 },
        { id: 'p2', name: 'B', engagementScore: 0.2 },
      ],
    });
    const res = await svc.compute({ tenantId: 't1', limit: 3, excludePersonId: 'p1' }, NOW);
    expect(res.totalAtRisk).toBe(1);
    expect(res.items.map((i) => i.personId)).toEqual(['p2']);
  });

  it('getAtRisk резолвит viewerUserId→Person и исключает его', async () => {
    const svc = makeService({
      persons: [
        { id: 'p-owner', name: 'Директор', engagementScore: 0.1 },
        { id: 'p2', name: 'B', engagementScore: 0.2 },
      ],
      viewerPersonByUserId: { 'user-owner': 'p-owner' },
    });
    const res = await svc.getAtRisk({
      tenantId: 't1',
      limit: 3,
      viewerUserId: 'user-owner',
    });
    expect(res.items.map((i) => i.personId)).toEqual(['p2']);
    expect(res.totalAtRisk).toBe(1);
  });

  it('getAtRisk без резолва Person (нет связки) — никого не исключает', async () => {
    const svc = makeService({
      persons: [
        { id: 'p1', name: 'A', engagementScore: 0.1 },
        { id: 'p2', name: 'B', engagementScore: 0.2 },
      ],
    });
    const res = await svc.getAtRisk({
      tenantId: 't1',
      limit: 3,
      viewerUserId: 'unknown-user',
    });
    expect(res.totalAtRisk).toBe(2);
    expect(res.items.map((i) => i.personId)).toEqual(['p1', 'p2']);
  });
});
