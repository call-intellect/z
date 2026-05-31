/**
 * DTO для эндпоинтов реферальной программы.
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §11.2 + §11.3 + §11.4.
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const InnSchema = z
  .string()
  .trim()
  .regex(/^(\d{10}|\d{12})$/, 'ИНН должен содержать 10 или 12 цифр');

const LegalFormSchema = z.enum([
  'self_employed',
  'individual_entrepreneur',
  'legal_entity',
]);

// ────────────────────────── Public (beacon) ──────────────────────────

export const PublicAttributionBodySchema = z.object({
  slug: z.string().trim().min(4).max(32),
  /**
   * audit С5 (2026-05-29): минимум 32 символа для fingerprint. Это
   * SHA-256 / SHA-1-подобный хэш с FingerprintJS / визитёр-сайта.
   * Короче 32 символов = либо подделка, либо устаревший клиент —
   * лучше отбросить, чем хранить «5-символьный fingerprint» который
   * будет коллизировать на atribution-расчёте.
   */
  fingerprint: z.string().trim().min(32).max(64).optional(),
  referer: z.string().trim().max(2000).optional(),
});
export type PublicAttributionBody = z.infer<typeof PublicAttributionBodySchema>;
export class PublicAttributionBodyDto extends createZodDto(
  PublicAttributionBodySchema,
) {}

// ────────────────────────── Cabinet ──────────────────────────

/**
 * Создание партнёрского профиля (ТЗ 2026-05-31-referrals-cabinet-revamp §7.6).
 *
 * Обязателен только `contractAccepted: true` — это согласие с офертой
 * партнёрской программы (фиксирует `contractAcceptedAt = now()`).
 *
 * Поля `inn`, `legalForm`, `payoutDetails` опциональны — реквизиты
 * заполняются позже, когда партнёр готовит вывод денег. Если задан
 * `inn` — обязателен `legalForm` (валидируется в сервисе через
 * `BadRequestException`).
 *
 * `z.literal(true)` — гарантия от ложного согласия: `contractAccepted: false`
 * провалит Zod-валидацию автоматически.
 */
export const CreateReferralBodySchema = z.object({
  contractAccepted: z.literal(true),
  inn: InnSchema.optional(),
  legalForm: LegalFormSchema.optional(),
  payoutDetails: z.record(z.string(), z.unknown()).optional(),
});
export type CreateReferralBody = z.infer<typeof CreateReferralBodySchema>;
export class CreateReferralBodyDto extends createZodDto(
  CreateReferralBodySchema,
) {}

export const UpdateReferralBodySchema = z.object({
  inn: InnSchema.optional(),
  legalForm: LegalFormSchema.optional(),
  payoutDetails: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateReferralBody = z.infer<typeof UpdateReferralBodySchema>;
export class UpdateReferralBodyDto extends createZodDto(
  UpdateReferralBodySchema,
) {}

export const ReferralViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  /** Optional после ТЗ referrals-cabinet-revamp §5.1. */
  inn: z.string().nullable(),
  innVerifiedAt: z.string().datetime().nullable(),
  /** Optional после ТЗ referrals-cabinet-revamp §5.1. */
  legalForm: LegalFormSchema.nullable(),
  contractAcceptedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ReferralViewBody = z.infer<typeof ReferralViewSchema>;
export class ReferralViewDto extends createZodDto(ReferralViewSchema) {}

/**
 * Расширенная статистика партнёра (ТЗ referrals-cabinet-revamp §7.2 + §7.4).
 *
 * legacy-поля: totalClients / activePaying / totalEarnedKopecks /
 *   totalPaidKopecks / totalPendingKopecks (как было раньше).
 *
 * Новые поля 30d:
 *   - clicks30d         — клики по партнёрской ссылке (ReferralAttribution).
 *   - signups30d        — регистрации Org за 30 дней (ClientReferralLink.attachedAt
 *                         + Org.pendingAttributionAt).
 *   - firstPayments30d  — первые оплаты Org за 30 дней (ClientReferralLink.firstPaidAt).
 *   - conversion*Percent — округление до 0.1; 0 при делении на 0.
 */
export const ReferralStatsExtendedSchema = z.object({
  totalClients: z.number().int().nonnegative(),
  activePaying: z.number().int().nonnegative(),
  totalEarnedKopecks: z.number().int().nonnegative(),
  totalPaidKopecks: z.number().int().nonnegative(),
  totalPendingKopecks: z.number().int().nonnegative(),
  clicks30d: z.number().int().nonnegative(),
  signups30d: z.number().int().nonnegative(),
  firstPayments30d: z.number().int().nonnegative(),
  conversionClickToPaidPercent: z.number().nonnegative(),
  conversionSignupToPaidPercent: z.number().nonnegative(),
});
export type ReferralStatsExtendedBody = z.infer<typeof ReferralStatsExtendedSchema>;
export class ReferralStatsExtendedDto extends createZodDto(
  ReferralStatsExtendedSchema,
) {}

/**
 * Маскированный клиент партнёра (ТЗ referrals-cabinet-revamp §6.4 + §7.4).
 *
 * **Юридический приоритет: ни одно поле не должно идентифицировать Org.**
 * Никаких `org.name`, `org.id`, `tenantId`, ИНН клиента, email/phone.
 * `clientCode` — детерминированный анонимный идентификатор:
 * `'C' + base36(crc32(ClientReferralLink.id))`.
 *
 * Статус:
 *   - `'active'`  — firstPaidAt != null & subscription.status='ACTIVE' & paymentMode='paid'
 *   - `'churned'` — firstPaidAt != null & (status != 'ACTIVE' || paymentMode != 'paid')
 *   - `'pending'` — firstPaidAt == null
 */
export const ReferralClientMaskedSchema = z.object({
  clientCode: z.string(),
  attachedAt: z.string().datetime(),
  firstPaidAt: z.string().datetime().nullable(),
  status: z.enum(['active', 'churned', 'pending']),
  monthlyEarningsKopecks: z.number().int().nonnegative(),
  totalEarnedKopecks: z.number().int().nonnegative(),
});
export type ReferralClientMaskedBody = z.infer<typeof ReferralClientMaskedSchema>;
export class ReferralClientMaskedDto extends createZodDto(
  ReferralClientMaskedSchema,
) {}

/**
 * Точка на графике дохода (ТЗ referrals-cabinet-revamp §7.3).
 *
 * `getIncomeChart` отдаёт ровно 12 точек: с месяца `now - 11mo` до `now`
 * включительно (UTC). Месяцы без данных — `{incomeRub: 0, activeClients: 0}`.
 */
export const MonthlyPointSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month должен быть YYYY-MM'),
  incomeRub: z.number().int().nonnegative(),
  activeClients: z.number().int().nonnegative(),
});
export type MonthlyPointBody = z.infer<typeof MonthlyPointSchema>;
export class MonthlyPointDto extends createZodDto(MonthlyPointSchema) {}

/**
 * Воронка партнёра (ТЗ referrals-cabinet-revamp §7.3).
 *
 * Период `'30d' | '90d' | 'all'` фильтрует createdAt / attachedAt / firstPaidAt
 * (для `'all'` — без фильтра). `activeNow` — снимок «сейчас» (как
 * `getStats.activePaying`). Конверсии — проценты до 0.1, 0 при делении на 0.
 */
export const FunnelPeriodSchema = z.enum(['30d', '90d', 'all']);
export type FunnelPeriod = z.infer<typeof FunnelPeriodSchema>;

export const FunnelSchema = z.object({
  period: FunnelPeriodSchema,
  clicks: z.number().int().nonnegative(),
  signups: z.number().int().nonnegative(),
  firstPayments: z.number().int().nonnegative(),
  activeNow: z.number().int().nonnegative(),
  conversions: z.object({
    clickToSignupPercent: z.number().nonnegative(),
    signupToPaidPercent: z.number().nonnegative(),
    clickToPaidPercent: z.number().nonnegative(),
  }),
});
export type FunnelBody = z.infer<typeof FunnelSchema>;
export class FunnelDto extends createZodDto(FunnelSchema) {}

/**
 * Query-параметр `?period=` для `GET /referrals/me/funnel`.
 *
 * Default `'30d'` — самый частый кейс «как у меня дела за последний месяц».
 */
export const FunnelQuerySchema = z.object({
  period: FunnelPeriodSchema.default('30d'),
});
export type FunnelQuery = z.infer<typeof FunnelQuerySchema>;
export class FunnelQueryDto extends createZodDto(FunnelQuerySchema) {}

/**
 * Body для POST /api/v1/referrals/me/promo-event
 * (ТЗ referrals-cabinet-revamp §8.3a).
 *
 * Эндпоинт инкрементит Prometheus-counter и возвращает 204. Никаких
 * мутаций БД, никакой бизнес-логики — только метрики.
 *
 * - `type` — какое событие пришло с фронта (`impression` отправляется
 *   один раз за сессию при первом показе, `click` — клик «Получить
 *   ссылку», `dismissed` — клик «×»).
 * - `role` — кто видит полосу: `owner` (руководитель Org, ему
 *   рекомендуется приводить других руководителей) или `member`
 *   (рядовой сотрудник, личная подработка).
 */
export const PromoEventBodySchema = z.object({
  type: z.enum(['impression', 'click', 'dismissed']),
  role: z.enum(['owner', 'member']),
});
export type PromoEventBody = z.infer<typeof PromoEventBodySchema>;
export class PromoEventBodyDto extends createZodDto(PromoEventBodySchema) {}

// ────────────────────────── Admin ──────────────────────────

export const AdminMarkPayoutPaidBodySchema = z.object({
  payoutDocumentUrl: z.string().url().optional(),
});
export type AdminMarkPayoutPaidBody = z.infer<
  typeof AdminMarkPayoutPaidBodySchema
>;
export class AdminMarkPayoutPaidBodyDto extends createZodDto(
  AdminMarkPayoutPaidBodySchema,
) {}

export const AdminVoidPayoutBodySchema = z.object({
  voidReason: z.string().trim().min(3),
});
export type AdminVoidPayoutBody = z.infer<typeof AdminVoidPayoutBodySchema>;
export class AdminVoidPayoutBodyDto extends createZodDto(
  AdminVoidPayoutBodySchema,
) {}

export const AdminClosePeriodBodySchema = z.object({
  periodMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodMonth должен быть YYYY-MM'),
});
export type AdminClosePeriodBody = z.infer<typeof AdminClosePeriodBodySchema>;
export class AdminClosePeriodBodyDto extends createZodDto(
  AdminClosePeriodBodySchema,
) {}
