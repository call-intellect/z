/**
 * Admin-redesign Фаза 4 (collapse-to-standard, ТЗ 2026-05-31) —
 * unit-тесты `AdminPlansService.getCurrentSnapshot()`.
 *
 * После collapse-to-standard CRUD-методы удалены. Тестируем один публичный
 * метод — `getCurrentSnapshot()`:
 *   1) собирает значения из `AdminSettingsService.getMany(...)`;
 *   2) при отсутствии ключа — берёт code-fallback (защита от bootstrap-сценария);
 *   3) при кривом типе значения — берёт code-fallback (защита от мусора в БД);
 *   4) дёргает `SeatService.calculatePricing('monthly', 0)` для базовой строки
 *      (UI и расчёт цены подписки — один источник правды);
 *   5) считает COUNT'ы Org на `tier_standard` и на legacy-тирах;
 *   6) features/quotas — берёт из `TIER_CONFIG['tier_standard']`;
 *   7) editableSettings — 6 ключей `billing.*` с severity=high.
 */

import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { SeatService } from '../../billing/services/seat.service';
import { TIER_CONFIG } from '../../entitlements/tier-config';
import type { AdminSettingsService } from '../settings/admin-settings.service';

import { AdminPlansService } from './plans.service';

interface PrismaCounts {
  /** Сколько Org на `tier_standard`. */
  standardCount: number;
  /** Сколько Org на legacy-тирах (basic/pro/enterprise). */
  legacyCount: number;
}

function buildPrisma(counts: PrismaCounts): PrismaService {
  const count = vi.fn(async (args: { where: { tier: unknown } }) => {
    const tier = args.where.tier;
    if (tier === 'tier_standard') return counts.standardCount;
    if (
      typeof tier === 'object' &&
      tier !== null &&
      'in' in (tier as Record<string, unknown>)
    ) {
      return counts.legacyCount;
    }
    return 0;
  });
  return {
    orgEntitlement: { count },
  } as unknown as PrismaService;
}

function buildAdminSettings(
  values: Record<string, unknown>,
): AdminSettingsService {
  return {
    getMany: vi.fn(async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        if (k in values) out[k] = values[k];
      }
      return out;
    }),
  } as unknown as AdminSettingsService;
}

function buildSeat(monthlyKopecks: number): SeatService {
  return {
    calculatePricing: vi.fn(async (_period: 'monthly' | 'yearly', _extra: number) => ({
      baseMonthlyKopecks: monthlyKopecks,
      seatsExtraKopecks: 0,
      monthlyKopecks,
      periodKopecks: monthlyKopecks,
      discountKopecks: 0,
      monthsInPeriod: 1,
    })),
  } as unknown as SeatService;
}

describe('AdminPlansService.getCurrentSnapshot', () => {
  it('собирает снимок из AdminSetting + SeatService + COUNT Org', async () => {
    const prisma = buildPrisma({ standardCount: 42, legacyCount: 3 });
    const settings = buildAdminSettings({
      'billing.baseMonthlyKopecks': 6_000_000,
      'billing.perExtraSeatKopecks': 100_000,
      'billing.yearlyDiscountRate': 0.8,
      'billing.baseSeatsIncluded': 31,
      'billing.baseMeetingsGrant': 150,
      'billing.perExtraSeatMeetingsGrant': 5,
    });
    const seat = buildSeat(6_000_000);
    const svc = new AdminPlansService(prisma, settings, seat);

    const snap = await svc.getCurrentSnapshot();

    expect(snap.tier).toBe('tier_standard');
    expect(snap.displayName).toBe('Стандартный');
    expect(snap.description).toBe('Единый тариф Z. Все фичи Z.');

    // base — пришла через SeatService.calculatePricing.
    expect(snap.base.monthlyPriceKopecks).toBe(6_000_000);
    expect(snap.base.monthlyPriceRub).toBe(60_000);
    expect(snap.base.seatsIncluded).toBe(31);
    expect(snap.base.meetingsIncludedPerMonth).toBe(150);

    // extraSeat — из AdminSetting напрямую.
    expect(snap.extraSeat.monthlyPriceKopecksPerSeat).toBe(100_000);
    expect(snap.extraSeat.monthlyPriceRubPerSeat).toBe(1_000);
    expect(snap.extraSeat.meetingsPerSeat).toBe(5);

    // yearly — производное от yearlyDiscountRate (0.8 → -20%).
    expect(snap.yearly.discountPercent).toBe(20);
    expect(snap.yearly.monthlyEquivalentRub).toBe(48_000);
    expect(snap.yearly.fullYearRub).toBe(576_000);

    // features/quotas — из TIER_CONFIG, не из AdminSetting.
    expect(snap.features).toEqual(TIER_CONFIG['tier_standard'].features);
    expect(snap.quotas).toEqual(TIER_CONFIG['tier_standard'].quotas);

    // COUNT'ы Org.
    expect(snap.orgsUsingCount).toBe(42);
    expect(snap.legacyOrgsRemainingCount).toBe(3);

    // editableSettings — ровно 6 ключей billing.*, все severity=high.
    expect(snap.editableSettings).toHaveLength(6);
    expect(snap.editableSettings.map((s) => s.key).sort()).toEqual([
      'billing.baseMeetingsGrant',
      'billing.baseMonthlyKopecks',
      'billing.baseSeatsIncluded',
      'billing.perExtraSeatKopecks',
      'billing.perExtraSeatMeetingsGrant',
      'billing.yearlyDiscountRate',
    ]);
    for (const s of snap.editableSettings) {
      expect(s.severity).toBe('high');
    }
  });

  it('использует code-fallback, если ключа нет в AdminSetting (bootstrap)', async () => {
    const prisma = buildPrisma({ standardCount: 0, legacyCount: 0 });
    // Возвращаем пустой объект — ни одного ключа billing.* не сидено.
    const settings = buildAdminSettings({});
    const seat = buildSeat(6_000_000);
    const svc = new AdminPlansService(prisma, settings, seat);

    const snap = await svc.getCurrentSnapshot();

    // Должны взяться дефолты 60 000 ₽ / 1 000 ₽ / 20% / 31 / 150 / 5.
    expect(snap.base.monthlyPriceKopecks).toBe(6_000_000);
    expect(snap.extraSeat.monthlyPriceKopecksPerSeat).toBe(100_000);
    expect(snap.yearly.discountPercent).toBe(20);
    expect(snap.base.seatsIncluded).toBe(31);
    expect(snap.base.meetingsIncludedPerMonth).toBe(150);
    expect(snap.extraSeat.meetingsPerSeat).toBe(5);
  });

  it('берёт code-fallback, если значение AdminSetting кривого типа', async () => {
    const prisma = buildPrisma({ standardCount: 1, legacyCount: 0 });
    const settings = buildAdminSettings({
      // Все 6 ключей — строки/null/NaN. Сервис должен warn'нуть и взять fallback.
      'billing.baseMonthlyKopecks': '6000000',
      'billing.perExtraSeatKopecks': null,
      'billing.yearlyDiscountRate': Number.NaN,
      'billing.baseSeatsIncluded': 'thirty-one',
      'billing.baseMeetingsGrant': {},
      'billing.perExtraSeatMeetingsGrant': true,
    });
    const seat = buildSeat(6_000_000);
    const svc = new AdminPlansService(prisma, settings, seat);

    const snap = await svc.getCurrentSnapshot();

    expect(snap.base.monthlyPriceKopecks).toBe(6_000_000);
    expect(snap.extraSeat.monthlyPriceKopecksPerSeat).toBe(100_000);
    expect(snap.yearly.discountPercent).toBe(20);
    expect(snap.base.seatsIncluded).toBe(31);
    expect(snap.base.meetingsIncludedPerMonth).toBe(150);
    expect(snap.extraSeat.meetingsPerSeat).toBe(5);
  });

  it('отражает изменение прайса: 70 000 ₽ → base.monthlyPriceRub=70000, discount пересчитан', async () => {
    const prisma = buildPrisma({ standardCount: 5, legacyCount: 0 });
    const settings = buildAdminSettings({
      'billing.baseMonthlyKopecks': 7_000_000,
      'billing.perExtraSeatKopecks': 150_000,
      'billing.yearlyDiscountRate': 0.75, // -25%
      'billing.baseSeatsIncluded': 50,
      'billing.baseMeetingsGrant': 200,
      'billing.perExtraSeatMeetingsGrant': 10,
    });
    // SeatService при baseMonthlyKopecks=7_000_000 и seatsExtra=0 вернёт 7_000_000.
    const seat = buildSeat(7_000_000);
    const svc = new AdminPlansService(prisma, settings, seat);

    const snap = await svc.getCurrentSnapshot();

    expect(snap.base.monthlyPriceRub).toBe(70_000);
    expect(snap.base.monthlyPriceKopecks).toBe(7_000_000);
    expect(snap.extraSeat.monthlyPriceRubPerSeat).toBe(1_500);
    expect(snap.yearly.discountPercent).toBe(25);
    expect(snap.yearly.monthlyEquivalentRub).toBe(52_500); // 70000 × 0.75
    expect(snap.yearly.fullYearRub).toBe(630_000); // 52500 × 12
    expect(snap.base.seatsIncluded).toBe(50);
    expect(snap.base.meetingsIncludedPerMonth).toBe(200);
    expect(snap.extraSeat.meetingsPerSeat).toBe(10);
  });

  it('legacyOrgsRemainingCount=0 после миграции — нормальное прод-состояние', async () => {
    const prisma = buildPrisma({ standardCount: 100, legacyCount: 0 });
    const settings = buildAdminSettings({});
    const seat = buildSeat(6_000_000);
    const svc = new AdminPlansService(prisma, settings, seat);

    const snap = await svc.getCurrentSnapshot();

    expect(snap.orgsUsingCount).toBe(100);
    expect(snap.legacyOrgsRemainingCount).toBe(0);
  });
});
