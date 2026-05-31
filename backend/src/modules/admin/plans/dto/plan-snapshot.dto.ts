/**
 * Admin-redesign Фаза 4 (collapse-to-standard, ТЗ 2026-05-31) —
 * DTO снимка единого тарифа `tier_standard`.
 *
 * Источник: `plans/tz/2026-05-31-admin-plans-collapse-to-standard.md` §3.4.
 *
 * Возвращается единственным эндпоинтом
 * `GET /api/v1/admin/orgs/plans/current` и используется UI карточки
 * «Стандартный тариф Z» на `/admin/orgs/plans`.
 *
 * Источник цены — `AdminSetting` (ключи `billing.*`, см. §3.1 ТЗ),
 * features/quotas — статический реестр `TIER_CONFIG['tier_standard']`.
 *
 * Структура `editableSettings` — это метаданные «какие поля UI показывает
 * как редактируемые через существующий `AdminSettingField`», чтобы фронт
 * не дублировал список ключей в коде.
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Базовая строка тарифа: цена/мест/встреч ВКЛЮЧЕНЫ в стандартный пакет
 * (без учёта доп. мест). Все деньги — копейки + рубли (для UI без деления
 * на 100 на каждом рендере).
 */
export const PlanSnapshotBaseSchema = z.object({
  monthlyPriceRub: z.number().int().nonnegative(),
  monthlyPriceKopecks: z.number().int().nonnegative(),
  seatsIncluded: z.number().int().positive(),
  meetingsIncludedPerMonth: z.number().int().nonnegative(),
});

/**
 * Доп. сотрудник: единственная опция расширения тарифа (по решению
 * владельца, см. §0 ТЗ — никаких других аддонов нет).
 */
export const PlanSnapshotExtraSeatSchema = z.object({
  monthlyPriceRubPerSeat: z.number().int().nonnegative(),
  monthlyPriceKopecksPerSeat: z.number().int().nonnegative(),
  meetingsPerSeat: z.number().int().nonnegative(),
});

/**
 * Параметры годовой подписки. `discountPercent` — производное от
 * `billing.yearlyDiscountRate` (`(1 - rate) * 100`), для UI.
 */
export const PlanSnapshotYearlySchema = z.object({
  discountPercent: z.number().min(0).max(100),
  monthlyEquivalentRub: z.number().int().nonnegative(),
  fullYearRub: z.number().int().nonnegative(),
});

/**
 * Метаданные одного редактируемого AdminSetting-ключа. Используется фронтом,
 * чтобы построить форму через существующий `AdminSettingField`.
 */
export const PlanSnapshotEditableSettingSchema = z.object({
  key: z.string().min(1),
  currentValue: z.number(),
  severity: z.enum(['low', 'medium', 'high', 'destructive']),
});

/**
 * features/quotas — JSON-объекты из `TIER_CONFIG['tier_standard']`. Структура
 * фиксирована типами `FeatureKey`/`QuotaKey`, но для DTO остаётся
 * `record<string, boolean|number>` — это интерфейс между бэком и UI, который
 * не должен ломаться при добавлении новых feature/quota.
 */
const FeaturesSchema = z.record(z.string(), z.boolean());
const QuotasSchema = z.record(z.string(), z.number());

export const PlanSnapshotSchema = z.object({
  tier: z.literal('tier_standard'),
  displayName: z.string().min(1),
  description: z.string(),
  base: PlanSnapshotBaseSchema,
  extraSeat: PlanSnapshotExtraSeatSchema,
  yearly: PlanSnapshotYearlySchema,
  features: FeaturesSchema,
  quotas: QuotasSchema,
  /** Сколько Org сейчас на `tier_standard` (через `OrgEntitlement.tier`). */
  orgsUsingCount: z.number().int().nonnegative(),
  /**
   * Сколько Org остались на legacy-тарифах (`tier_basic` / `tier_pro` /
   * `tier_enterprise`). Должно быть `0` после прогона
   * `migrate-entitlements-to-standard.ts`.
   */
  legacyOrgsRemainingCount: z.number().int().nonnegative(),
  editableSettings: z.array(PlanSnapshotEditableSettingSchema),
});

/**
 * Класс-DTO для NestJS (`@ApiResponse({ type: PlanSnapshotDto })` +
 * автогенерация Swagger через nestjs-zod).
 */
export class PlanSnapshotDto extends createZodDto(PlanSnapshotSchema) {}

/** Тип-инференс для использования в сервисе (без instance-обёртки). */
export type PlanSnapshot = z.infer<typeof PlanSnapshotSchema>;
