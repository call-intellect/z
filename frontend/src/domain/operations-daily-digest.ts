/**
 * SBA β-8.3 Wave 1 — доменная модель ежедневного отчёта COO.
 *
 * Маппит ApiDto → Domain: даты ISO → Date; всё остальное передаётся как есть.
 * Контракт ApiDto — `frontend/src/api/operations-daily-digest.api.ts`.
 */

import type {
  DailyDigestApi,
  DailyDigestChronicBlockerApi,
  DailyDigestEventApi,
  DailyDigestMetricsApi,
  DailyDigestPersonShinedApi,
  DailyDigestPersonStruggledApi,
  DailyDigestSourcesApi,
  DailyDigestUrgentItemApi,
} from '@/api/operations-daily-digest.api';

export interface DailyDigestMetricsDomain extends DailyDigestMetricsApi {
  // На уровне domain метрики структурно совпадают с API DTO — числа и строки
  // приходят готовыми к рендеру. Если потребуется postprocessing (например,
  // округление shares) — делать здесь, а не в UI.
}

export interface DailyDigestSourcesDomain extends DailyDigestSourcesApi {}

/**
 * Pulse Wave 2 §2.1 — domain-зеркала расширенных секций.
 * `occurredAt` остаётся строкой ISO — UI рендерит как локальное время
 * прямо из строки, а не Date (избегаем drift между серверным и клиентским TZ).
 */
export interface DailyDigestEventDomain extends DailyDigestEventApi {}
export interface DailyDigestUrgentItemDomain extends DailyDigestUrgentItemApi {}
export interface DailyDigestPersonShinedDomain
  extends DailyDigestPersonShinedApi {}
export interface DailyDigestPersonStruggledDomain
  extends DailyDigestPersonStruggledApi {}
/** ТЗ-2 Ф3 — domain-зеркало хронического блокера (identity-маппинг). */
export interface DailyDigestChronicBlockerDomain
  extends DailyDigestChronicBlockerApi {}

/** ТЗ-2 Ф3 — русские лейблы статуса хронического блокера. */
export const CHRONIC_BLOCKER_STATUS_LABEL: Record<
  DailyDigestChronicBlockerDomain['status'],
  string
> = {
  new: 'новый',
  recurring: 'повторяется',
  resolved: 'закрыт',
};

export interface DailyDigestDomain {
  id: string;
  tenantId: string;
  /** YYYY-MM-DD в МСК. */
  dateLocal: string;
  bodyMarkdown: string;
  shortSummary: string | null;
  metrics: DailyDigestMetricsDomain;
  sources: DailyDigestSourcesDomain;
  llmTaskRouteId: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
  // Pulse Wave 2 §2.1 — расширенные секции.
  eventsToday: DailyDigestEventDomain[];
  urgentItems: DailyDigestUrgentItemDomain[];
  whoShined: DailyDigestPersonShinedDomain[];
  whoStruggled: DailyDigestPersonStruggledDomain[];
  // ТЗ-2 Ф3 — хронические блокеры.
  chronicBlockers: DailyDigestChronicBlockerDomain[];
}

export function fromDailyDigestApi(dto: DailyDigestApi): DailyDigestDomain {
  return {
    id: dto.id,
    tenantId: dto.tenantId,
    dateLocal: dto.dateLocal,
    bodyMarkdown: dto.bodyMarkdown,
    shortSummary: dto.shortSummary ?? null,
    metrics: dto.metrics,
    sources: dto.sources,
    llmTaskRouteId: dto.llmTaskRouteId ?? null,
    deliveredAt: dto.deliveredAt ? new Date(dto.deliveredAt) : null,
    createdAt: new Date(dto.createdAt),
    // Backend гарантирует массивы; default `?? []` страхует от старых ответов.
    eventsToday: dto.eventsToday ?? [],
    urgentItems: dto.urgentItems ?? [],
    whoShined: dto.whoShined ?? [],
    whoStruggled: dto.whoStruggled ?? [],
    chronicBlockers: dto.chronicBlockers ?? [],
  };
}
