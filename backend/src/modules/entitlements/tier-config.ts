/**
 * TierConfigRegistry — статический реестр тарифов knowledge-core (Фаза 12).
 *
 * См. plans/2026-05-10-phase-12-execution.md §«Принципиальные решения» и шаг 2.
 *
 * Реестр живёт в коде, а не в БД: смена features/quotas tier'а — релиз. Это
 * намеренно: «бизнес-config в БД» приводит к рассинхрону кода и данных. Per-Org
 * исключения делаются через `OrgEntitlement.featureOverrides` / `quotaOverrides`.
 *
 * Если в БД окажется неизвестный `tier`, `EntitlementService` fail-safe деградирует
 * до `tier_basic` + log warning.
 */

/** Ключ тарифа. Хранится в `OrgEntitlement.tier` строкой (не enum-Prisma). */
export type TierKey = 'tier_basic' | 'tier_pro' | 'tier_enterprise';

/** Все feature-флаги knowledge-core. См. ТЗ Фазы 12 §Шаг 2. */
export type FeatureKey =
  | 'feature.meeting'
  | 'feature.ai_report'
  | 'feature.card_rollup'
  | 'feature.chat_per_meeting'
  | 'feature.theme'
  | 'feature.graph'
  | 'feature.chat_org'
  | 'feature.dashboard_director'
  | 'feature.adapter_telegram'
  | 'feature.adapter_email'
  | 'feature.adapter_call'
  | 'feature.adapter_web_form'
  | 'feature.public_api'
  | 'feature.export_advanced'
  | 'feature.goals_strategy'
  | 'feature.strict_visibility';

/** Все quota-ключи. */
export type QuotaKey =
  | 'meetings_per_month'
  | 'blocks_per_org'
  | 'chat_requests_per_day_per_user'
  | 'sources_meeting'
  | 'sources_other'
  | 'ingest_bytes_per_month'
  | 'links_per_day';

export interface TierConfig {
  features: Record<FeatureKey, boolean>;
  quotas: Record<QuotaKey, number>;
}

/** Полный список фич — для итерации в UI и сериализации. */
export const ALL_FEATURES: readonly FeatureKey[] = [
  'feature.meeting',
  'feature.ai_report',
  'feature.card_rollup',
  'feature.chat_per_meeting',
  'feature.theme',
  'feature.graph',
  'feature.chat_org',
  'feature.dashboard_director',
  'feature.adapter_telegram',
  'feature.adapter_email',
  'feature.adapter_call',
  'feature.adapter_web_form',
  'feature.public_api',
  'feature.export_advanced',
  'feature.goals_strategy',
  'feature.strict_visibility',
] as const;

/** Полный список квот. */
export const ALL_QUOTAS: readonly QuotaKey[] = [
  'meetings_per_month',
  'blocks_per_org',
  'chat_requests_per_day_per_user',
  'sources_meeting',
  'sources_other',
  'ingest_bytes_per_month',
  'links_per_day',
] as const;

/** Все известные tier-ключи (для валидации в DTO). */
export const ALL_TIERS: readonly TierKey[] = [
  'tier_basic',
  'tier_pro',
  'tier_enterprise',
] as const;

// ──────────────────────────── Базовые квоты tier_basic ────────────────────────────

const BASIC_QUOTAS: Record<QuotaKey, number> = {
  meetings_per_month: 50,
  blocks_per_org: 5_000,
  chat_requests_per_day_per_user: 30,
  sources_meeting: 10,
  sources_other: 0,
  ingest_bytes_per_month: 100 * 1024 * 1024, // 100 MB
  links_per_day: 1_000,
};

/** Pro = basic ×10. */
const PRO_QUOTAS: Record<QuotaKey, number> = {
  meetings_per_month: 500,
  blocks_per_org: 50_000,
  chat_requests_per_day_per_user: 300,
  sources_meeting: 100,
  sources_other: 50,
  ingest_bytes_per_month: 1024 * 1024 * 1024, // 1 GB
  links_per_day: 10_000,
};

/** Enterprise = basic ×100 (фактически безлимит). */
const ENTERPRISE_QUOTAS: Record<QuotaKey, number> = {
  meetings_per_month: 5_000,
  blocks_per_org: 500_000,
  chat_requests_per_day_per_user: 3_000,
  sources_meeting: 1_000,
  sources_other: 500,
  ingest_bytes_per_month: 10 * 1024 * 1024 * 1024, // 10 GB
  links_per_day: 100_000,
};

// ──────────────────────────── Фичи по тарифам ────────────────────────────

const BASIC_FEATURES: Record<FeatureKey, boolean> = {
  'feature.meeting': true,
  'feature.ai_report': true,
  'feature.card_rollup': true,
  'feature.chat_per_meeting': true,
  'feature.adapter_web_form': true,
  // ── всё остальное на basic — выключено ──
  'feature.theme': false,
  'feature.graph': false,
  'feature.chat_org': false,
  'feature.dashboard_director': false,
  'feature.adapter_telegram': false,
  'feature.adapter_email': false,
  'feature.adapter_call': false,
  'feature.public_api': false,
  'feature.export_advanced': false,
  'feature.goals_strategy': false,
  'feature.strict_visibility': false,
};

const PRO_FEATURES: Record<FeatureKey, boolean> = {
  ...BASIC_FEATURES,
  'feature.theme': true,
  'feature.graph': true,
  'feature.chat_org': true,
  'feature.dashboard_director': true,
  'feature.adapter_telegram': true,
  'feature.adapter_email': true,
  'feature.adapter_call': true,
  'feature.public_api': true,
  'feature.export_advanced': true,
};

const ENTERPRISE_FEATURES: Record<FeatureKey, boolean> = {
  ...PRO_FEATURES,
  'feature.goals_strategy': true,
  'feature.strict_visibility': true,
};

// ──────────────────────────── Реестр ────────────────────────────

/**
 * Главный реестр тарифов. TS-проверка `Record<TierKey, TierConfig>` гарантирует
 * полноту перечисления тарифов; внутренние Record'ы гарантируют полноту
 * features/quotas (опечатки ловятся компилятором).
 */
export const TIER_CONFIG: Record<TierKey, TierConfig> = {
  tier_basic: {
    features: BASIC_FEATURES,
    quotas: BASIC_QUOTAS,
  },
  tier_pro: {
    features: PRO_FEATURES,
    quotas: PRO_QUOTAS,
  },
  tier_enterprise: {
    features: ENTERPRISE_FEATURES,
    quotas: ENTERPRISE_QUOTAS,
  },
};

/** True — если строка корректный TierKey. Используется в DTO-валидации/fail-safe. */
export function isTierKey(value: string): value is TierKey {
  return (ALL_TIERS as readonly string[]).includes(value);
}

/** True — если строка корректный FeatureKey. */
export function isFeatureKey(value: string): value is FeatureKey {
  return (ALL_FEATURES as readonly string[]).includes(value);
}

/** True — если строка корректный QuotaKey. */
export function isQuotaKey(value: string): value is QuotaKey {
  return (ALL_QUOTAS as readonly string[]).includes(value);
}
