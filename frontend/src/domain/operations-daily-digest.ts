/**
 * SBA β-8.3 Wave 1 — доменная модель ежедневного отчёта COO.
 *
 * Маппит ApiDto → Domain: даты ISO → Date; всё остальное передаётся как есть.
 * Контракт ApiDto — `frontend/src/api/operations-daily-digest.api.ts`.
 */

import type {
  DailyDigestApi,
  DailyDigestMetricsApi,
  DailyDigestSourcesApi,
} from '@/api/operations-daily-digest.api';

export interface DailyDigestMetricsDomain extends DailyDigestMetricsApi {
  // На уровне domain метрики структурно совпадают с API DTO — числа и строки
  // приходят готовыми к рендеру. Если потребуется postprocessing (например,
  // округление shares) — делать здесь, а не в UI.
}

export interface DailyDigestSourcesDomain extends DailyDigestSourcesApi {}

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
  };
}
