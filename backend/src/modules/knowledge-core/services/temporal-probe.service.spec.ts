import { describe, expect, it, vi } from 'vitest';

import { TemporalProbeService } from './temporal-probe.service';

/**
 * W2.4 KC-Temporal (2026-05-25) — unit-тесты `TemporalProbeService.runForOrg`.
 *
 * Тестируем:
 *   1) Расхождение есть → probe эмитится через ProbeService.suggest.
 *   2) Расхождения нет (свежий блок такой же trustedAnswer) → probe НЕ эмитится.
 *   3) Нет свежего блока вообще → probe НЕ эмитится.
 */

function makeService(args: {
  staleBlocks: Array<{
    id: string;
    name: string;
    trustedAnswer: string;
    signalType: string;
    validFrom: Date;
    entities: Array<{ entityId: string }>;
  }>;
  /** Map staleId -> fresh block or null. */
  freshBy: Map<string, { id: string; name: string; trustedAnswer: string; validFrom: Date } | null>;
  memberships: Array<{ userId: string }>;
  probeSuggest: ReturnType<typeof vi.fn>;
}) {
  const findManyMock = vi.fn(async () => args.staleBlocks);
  let currentStale: string | null = null;
  const findFirstMock = vi.fn(async (q: unknown) => {
    const query = q as { where: { id: { not: string }; signalType: string } };
    currentStale = query.where.id.not;
    return args.freshBy.get(currentStale!) ?? null;
  });
  const fakePrisma = {
    org: {
      findMany: async () => [{ id: 'org_1' }],
      findUnique: async () => ({ ownerId: 'u_owner' }),
    },
    ideaBlock: {
      findMany: findManyMock,
      findFirst: findFirstMock,
    },
    membership: {
      findMany: async () => args.memberships,
    },
    probeEvent: {
      findMany: async () => [],
    },
  } as unknown as ConstructorParameters<typeof TemporalProbeService>[0];

  const fakeCfg = {
    bitemporal: { factSignalTypes: ['fact_state'] },
    temporalProbe: { limitPerOrg: 50, escalateAfterWeeks: 2 },
    probe: { expiryDays: 14 },
  } as unknown as ConstructorParameters<typeof TemporalProbeService>[1];

  const fakeProbe = {
    suggest: args.probeSuggest,
  } as unknown as ConstructorParameters<typeof TemporalProbeService>[2];

  return new TemporalProbeService(fakePrisma, fakeCfg, fakeProbe);
}

describe('TemporalProbeService.runForOrg', () => {
  it('есть расхождение → emit probe.suggest с reason=temporal.fact_stale_contradiction', async () => {
    const suggestMock = vi
      .fn()
      .mockResolvedValue({ ok: true, probeEventId: 'pe_1' });
    const svc = makeService({
      staleBlocks: [
        {
          id: 'b_old',
          name: 'CEO компании X',
          trustedAnswer: 'Иван',
          signalType: 'fact_state',
          validFrom: new Date('2024-01-01'),
          entities: [{ entityId: 'e_company' }],
        },
      ],
      freshBy: new Map([
        [
          'b_old',
          {
            id: 'b_new',
            name: 'CEO компании X',
            trustedAnswer: 'Пётр',
            validFrom: new Date(),
          },
        ],
      ]),
      memberships: [{ userId: 'u_admin' }],
      probeSuggest: suggestMock,
    });
    const stats = await svc.runForOrg('org_1');
    expect(stats.probesEmitted).toBe(1);
    expect(suggestMock).toHaveBeenCalledTimes(1);
    const callArgs = suggestMock.mock.calls[0]?.[0] as {
      reason: string;
      recipientCandidates: string[];
    };
    expect(callArgs.reason).toBe('temporal.fact_stale_contradiction');
    expect(callArgs.recipientCandidates).toEqual(['u_admin']);
  });

  it('свежий блок с тем же trustedAnswer → probe не эмитится', async () => {
    const suggestMock = vi.fn();
    const svc = makeService({
      staleBlocks: [
        {
          id: 'b_old',
          name: 'CEO X',
          trustedAnswer: 'Иван',
          signalType: 'fact_state',
          validFrom: new Date('2024-01-01'),
          entities: [{ entityId: 'e_company' }],
        },
      ],
      freshBy: new Map([
        [
          'b_old',
          {
            id: 'b_new',
            name: 'CEO X',
            trustedAnswer: 'иван  ', // та же сущность, normalize схлопнёт.
            validFrom: new Date(),
          },
        ],
      ]),
      memberships: [{ userId: 'u_admin' }],
      probeSuggest: suggestMock,
    });
    const stats = await svc.runForOrg('org_1');
    expect(stats.probesEmitted).toBe(0);
    expect(suggestMock).not.toHaveBeenCalled();
  });

  it('нет свежего блока → probe не эмитится', async () => {
    const suggestMock = vi.fn();
    const svc = makeService({
      staleBlocks: [
        {
          id: 'b_old',
          name: 'X',
          trustedAnswer: 'A',
          signalType: 'fact_state',
          validFrom: new Date('2024-01-01'),
          entities: [{ entityId: 'e_x' }],
        },
      ],
      freshBy: new Map([['b_old', null]]),
      memberships: [{ userId: 'u_admin' }],
      probeSuggest: suggestMock,
    });
    const stats = await svc.runForOrg('org_1');
    expect(stats.probesEmitted).toBe(0);
    expect(suggestMock).not.toHaveBeenCalled();
  });
});

/**
 * Б28 — порог эскалации должен быть строго МЕНЬШЕ PROBE_EXPIRY_DAYS, иначе
 * probe становится эскалируемым ровно в момент протухания (status уходит из
 * 'pending' в 'expired') и эскалация почти никогда не срабатывает.
 */
describe('TemporalProbeService.escalateUnanswered — порог < expiryDays (Б28)', () => {
  function makeEscalateService(args: {
    escalateAfterWeeks: number;
    expiryDays: number;
    stuck: Array<{ id: string; tenantId: string; payload: unknown }>;
    probeSuggest: ReturnType<typeof vi.fn>;
    findManyCapture: ReturnType<typeof vi.fn>;
  }) {
    const fakePrisma = {
      probeEvent: { findMany: args.findManyCapture },
      org: { findUnique: async () => ({ ownerId: 'u_owner' }) },
    } as unknown as ConstructorParameters<typeof TemporalProbeService>[0];
    const fakeCfg = {
      bitemporal: { factSignalTypes: ['fact_state'] },
      temporalProbe: { limitPerOrg: 50, escalateAfterWeeks: args.escalateAfterWeeks },
      probe: { expiryDays: args.expiryDays },
    } as unknown as ConstructorParameters<typeof TemporalProbeService>[1];
    const fakeProbe = {
      suggest: args.probeSuggest,
    } as unknown as ConstructorParameters<typeof TemporalProbeService>[2];
    return new TemporalProbeService(fakePrisma, fakeCfg, fakeProbe);
  }

  it('cutoff строго раньше expiry: probe старше порога, но «недавно-pending» эскалируется', async () => {
    const now = Date.now();
    // Probe создан 13 дней назад: при дефолтах (weeks*7=14 == expiry=14) он
    // НЕ попадал бы под старый порог (createdAt < now-14д ложно) — и при этом
    // на 14-й день его пометили бы expired. Новый порог = min(14, 14-1) = 13:
    // probe попадает в эскалацию ПОКА ещё pending.
    const probeCreatedAt = new Date(now - 13 * 24 * 3600 * 1000);
    let capturedCutoff: Date | null = null;
    const findManyCapture = vi.fn(async (q: unknown) => {
      const query = q as { where: { createdAt: { lt: Date } } };
      capturedCutoff = query.where.createdAt.lt;
      // Эмулируем БД: вернуть probe только если он старше cutoff'а.
      return probeCreatedAt < capturedCutoff
        ? [{ id: 'pe_old', tenantId: 'org_1', payload: { message: 'q?' } }]
        : [];
    });
    const suggestMock = vi.fn().mockResolvedValue({ ok: true, probeEventId: 'pe_2' });
    const svc = makeEscalateService({
      escalateAfterWeeks: 2,
      expiryDays: 14,
      stuck: [],
      probeSuggest: suggestMock,
      findManyCapture,
    });

    const res = await svc.escalateUnanswered();

    // cutoff (now - 13д) строго ПОЗЖЕ момента протухания не наступил бы —
    // главное: cutoff строго раньше now-14д? Нет: cutoff = now-13д > now-14д.
    expect(capturedCutoff).not.toBeNull();
    const cutoffMs = (capturedCutoff as unknown as Date).getTime();
    const expiryCutoffMs = now - 14 * 24 * 3600 * 1000;
    // Порог эскалации строго ближе к now, чем порог expiry → probe успевает
    // эскалироваться, оставаясь pending.
    expect(cutoffMs).toBeGreaterThan(expiryCutoffMs);
    // Probe 13-дневной давности попал в эскалацию.
    expect(res.escalated).toBe(1);
    expect(suggestMock).toHaveBeenCalledTimes(1);
  });
});
