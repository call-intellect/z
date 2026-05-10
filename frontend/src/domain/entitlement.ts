/**
 * Доменная модель Entitlement (Фаза 12 knowledge-core).
 *
 * Контракт: `backend/src/modules/entitlements/dto/entitlement.dto.ts` +
 *           `backend/src/modules/entitlements/tier-config.ts`.
 *
 * Слои:
 *   - `EntitlementApi` — что приходит с бэка.
 *   - `EntitlementDomain` — нормализованная модель (Date вместо string,
 *     удобные геттеры через mapper).
 *
 * Лейблы (`tierLabel`, `featureLabel`, `quotaLabel`) — для отображения в UI.
 */

// ─── Tier / Feature / Quota — строго те же ключи, что у backend ────────────

export type TierKey = 'tier_basic' | 'tier_pro' | 'tier_enterprise';

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

export type QuotaKey =
  | 'meetings_per_month'
  | 'blocks_per_org'
  | 'chat_requests_per_day_per_user'
  | 'sources_meeting'
  | 'sources_other'
  | 'ingest_bytes_per_month'
  | 'links_per_day';

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

export const ALL_QUOTAS: readonly QuotaKey[] = [
  'meetings_per_month',
  'blocks_per_org',
  'chat_requests_per_day_per_user',
  'sources_meeting',
  'sources_other',
  'ingest_bytes_per_month',
  'links_per_day',
] as const;

export const ALL_TIERS: readonly TierKey[] = [
  'tier_basic',
  'tier_pro',
  'tier_enterprise',
] as const;

// ─── Лейблы для UI ──────────────────────────────────────────────────────────

export const TIER_LABELS: Record<TierKey, string> = {
  tier_basic: 'Basic',
  tier_pro: 'Pro',
  tier_enterprise: 'Enterprise',
};

/** Минимальный tier, на котором фича включена в дефолте (для CTA «Доступно на …»). */
export const FEATURE_MIN_TIER: Record<FeatureKey, TierKey> = {
  'feature.meeting': 'tier_basic',
  'feature.ai_report': 'tier_basic',
  'feature.card_rollup': 'tier_basic',
  'feature.chat_per_meeting': 'tier_basic',
  'feature.adapter_web_form': 'tier_basic',
  'feature.theme': 'tier_pro',
  'feature.graph': 'tier_pro',
  'feature.chat_org': 'tier_pro',
  'feature.dashboard_director': 'tier_pro',
  'feature.adapter_telegram': 'tier_pro',
  'feature.adapter_email': 'tier_pro',
  'feature.adapter_call': 'tier_pro',
  'feature.public_api': 'tier_pro',
  'feature.export_advanced': 'tier_pro',
  'feature.goals_strategy': 'tier_enterprise',
  'feature.strict_visibility': 'tier_enterprise',
};

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  'feature.meeting': 'Видеовстречи',
  'feature.ai_report': 'AI-отчёт по встрече',
  'feature.card_rollup': 'Сводка карточки',
  'feature.chat_per_meeting': 'Чат по встрече',
  'feature.theme': 'AI-темы',
  'feature.graph': 'Граф связей',
  'feature.chat_org': 'AI-чат по всей Org',
  'feature.dashboard_director': 'Дашборд директора',
  'feature.adapter_telegram': 'Источник: Telegram',
  'feature.adapter_email': 'Источник: e-mail',
  'feature.adapter_call': 'Источник: телефонные звонки',
  'feature.adapter_web_form': 'Источник: веб-форма',
  'feature.public_api': 'Публичный API',
  'feature.export_advanced': 'Расширенные экспорты',
  'feature.goals_strategy': 'Цели и стратегия',
  'feature.strict_visibility': 'Строгая видимость / приватность',
};

export const QUOTA_LABELS: Record<QuotaKey, string> = {
  meetings_per_month: 'Встреч в месяц',
  blocks_per_org: 'Блоков знаний на Org',
  chat_requests_per_day_per_user: 'AI-запросов в день / пользователь',
  sources_meeting: 'Источников типа «Встреча»',
  sources_other: 'Источников остальных типов',
  ingest_bytes_per_month: 'Объём загрузки в месяц',
  links_per_day: 'AI-связей в день',
};

/** True — если строка корректный TierKey. */
export function isTierKey(value: string): value is TierKey {
  return (ALL_TIERS as readonly string[]).includes(value);
}

/**
 * Группировка фич для таблицы /settings/billing.
 *
 * Заголовок группы → перечень фич в этой группе. Порядок — для UI.
 */
export const FEATURE_GROUPS: ReadonlyArray<{
  title: string;
  features: readonly FeatureKey[];
}> = [
  {
    title: 'Знания',
    features: [
      'feature.theme',
      'feature.graph',
      'feature.goals_strategy',
      'feature.strict_visibility',
    ],
  },
  {
    title: 'Коммуникация',
    features: [
      'feature.chat_per_meeting',
      'feature.chat_org',
      'feature.dashboard_director',
    ],
  },
  {
    title: 'Источники',
    features: [
      'feature.adapter_telegram',
      'feature.adapter_email',
      'feature.adapter_call',
      'feature.adapter_web_form',
    ],
  },
  {
    title: 'Базовые',
    features: [
      'feature.meeting',
      'feature.ai_report',
      'feature.card_rollup',
      'feature.public_api',
      'feature.export_advanced',
    ],
  },
];

// ─── API / Domain ───────────────────────────────────────────────────────────

export type EntitlementApi = {
  tenantId: string;
  tier: TierKey;
  rawTier: string;
  failedSafe: boolean;
  features: Record<FeatureKey, boolean>;
  quotas: Record<QuotaKey, number>;
  featureOverrides: Partial<Record<FeatureKey, boolean>> | null;
  quotaOverrides: Partial<Record<QuotaKey, number>> | null;
  notes?: string | null;
  /** В DTO нет поля `updatedAt` явно, оно вычисляется на бэке (см. ResolvedEntitlement). */
  updatedAt?: string;
};

export type EntitlementDomain = {
  tenantId: string;
  tier: TierKey;
  rawTier: string;
  failedSafe: boolean;
  features: Record<FeatureKey, boolean>;
  quotas: Record<QuotaKey, number>;
  featureOverrides: Partial<Record<FeatureKey, boolean>>;
  quotaOverrides: Partial<Record<QuotaKey, number>>;
  notes: string | null;
  updatedAt: Date | null;
};

/**
 * Дефолтные карты features/quotas — на случай, если бэкенд (внезапно) вернёт
 * частичный объект. UI всегда работает с полным Record.
 */
function emptyFeatures(): Record<FeatureKey, boolean> {
  return ALL_FEATURES.reduce<Record<FeatureKey, boolean>>((acc, k) => {
    acc[k] = false;
    return acc;
  }, {} as Record<FeatureKey, boolean>);
}

function emptyQuotas(): Record<QuotaKey, number> {
  return ALL_QUOTAS.reduce<Record<QuotaKey, number>>((acc, k) => {
    acc[k] = 0;
    return acc;
  }, {} as Record<QuotaKey, number>);
}

export function entitlementFromApi(api: EntitlementApi): EntitlementDomain {
  const features = { ...emptyFeatures(), ...(api.features ?? {}) };
  const quotas = { ...emptyQuotas(), ...(api.quotas ?? {}) };
  return {
    tenantId: api.tenantId,
    tier: api.tier,
    rawTier: api.rawTier,
    failedSafe: api.failedSafe,
    features,
    quotas,
    featureOverrides: api.featureOverrides ?? {},
    quotaOverrides: api.quotaOverrides ?? {},
    notes: api.notes ?? null,
    updatedAt: api.updatedAt ? new Date(api.updatedAt) : null,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function tierLabel(tier: TierKey): string {
  return TIER_LABELS[tier];
}

export function featureLabel(feature: FeatureKey): string {
  return FEATURE_LABELS[feature] ?? feature;
}

export function quotaLabel(quota: QuotaKey): string {
  return QUOTA_LABELS[quota] ?? quota;
}

/**
 * Форматирование объёма в человекочитаемом виде (Б / КБ / МБ / ГБ).
 *
 * Используется для квоты `ingest_bytes_per_month` в /settings/billing.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[i]}`;
}

/**
 * Форматирование квоты для UI — байтовые квоты через formatBytes,
 * остальные — просто число с разделителями.
 */
export function formatQuotaValue(quota: QuotaKey, value: number): string {
  if (quota === 'ingest_bytes_per_month') return formatBytes(value);
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('ru-RU');
}

// ─── PATCH DTO для Z-Admin ──────────────────────────────────────────────────

export type PatchEntitlementBody = {
  tier?: TierKey;
  featureOverrides?: Partial<Record<FeatureKey, boolean>>;
  quotaOverrides?: Partial<Record<QuotaKey, number>>;
  notes?: string | null;
  /** Обязательное — попадает в AuditLog. */
  reason: string;
};
