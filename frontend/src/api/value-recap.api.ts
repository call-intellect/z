/**
 * ТЗ-2 Ф6.C / S1.5 (daily-value-engine) — API-клиент месячной витрины
 * «Что сделала Кора» (value-recap).
 *
 * Контракт:
 *   GET  /api/v1/dashboard/operations/value-recap?period=YYYY-MM
 *   POST /api/v1/dashboard/operations/value-recap/:id/opened
 *   GET  /api/v1/dashboard/operations/value-recap/:id/export?format=slides|json
 * (см. `backend/src/modules/operations/dto/value-recap.dto.ts`).
 * Auth: `CookieAuthGuard + TenantGuard` (cookie + `X-Org-Id` header).
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';

/** Твёрдые счётчики «снятой рутины» (из БД, без LLM). */
export interface ValueRecapRoutineApi {
  meetingsAutoProtocoled: number;
  tasksExtracted: number;
  decisionsExtracted: number;
  commitmentsExtracted: number;
  statusesCollected: number;
  questionsAnsweredWithCitation: number;
  ideasShipped: number;
}

/** Soft-слой «команда работает лучше» — каждая цифра «оценка» (estimate). */
export interface ValueRecapTeamApi {
  reliabilityPercent: number | null;
  reliabilityDenominator: number;
  reliabilityDelta: number | null;
  chatHelpedRatePercent: number | null;
  chatRated: number;
  chatAnsweredWithCitation: number;
  decisionsTotal: number;
  decisionsThroughputPercent: number;
  ideasShipped: number;
  estimate: true;
}

/** Дельта к прошлому месяцу по ведущим счётчикам (null — нет baseline). */
export interface ValueRecapDeltaApi {
  meetingsAutoProtocoled: number | null;
  tasksExtracted: number | null;
  decisionsExtracted: number | null;
  commitmentsExtracted: number | null;
  statusesCollected: number | null;
  questionsAnsweredWithCitation: number | null;
  ideasShipped: number | null;
}

export interface ValueRecapPayloadApi {
  periodYm: string;
  builtAt: string;
  isBaseline: boolean;
  routine: ValueRecapRoutineApi;
  team: ValueRecapTeamApi;
  delta: ValueRecapDeltaApi | null;
  narrative: string;
}

export interface ValueRecapSnapshotApi {
  id: string;
  periodYm: string;
  payload: ValueRecapPayloadApi | null;
  deliveredAt: string | null;
  openedAt: string | null;
  createdAt: string;
}

/** Один слайд минимального структурного экспорта. */
export interface ValueRecapSlideApi {
  title: string;
  subtitle?: string;
  bullets: string[];
}

export interface ValueRecapExportApi {
  format: 'slides' | 'json';
  periodYm: string;
  slides?: ValueRecapSlideApi[];
  payload?: ValueRecapPayloadApi | null;
}

export const valueRecapApi = {
  /**
   * `GET /dashboard/operations/value-recap?period=YYYY-MM`.
   * `period` не передан — backend резолвит прошлый месяц.
   */
  get: (orgId: string, period?: string) =>
    apiClient.get<ValueRecapSnapshotApi>(
      `/api/v1/dashboard/operations/value-recap${buildQuery({ period })}`,
      { headers: orgHeaders(orgId) },
    ),

  /** `POST /dashboard/operations/value-recap/:id/opened` — отметить просмотр. */
  markOpened: (orgId: string, id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/dashboard/operations/value-recap/${encodeURIComponent(id)}/opened`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * `GET /dashboard/operations/value-recap/:id/export?format=slides|json`.
   * Минимальный структурный экспорт (слайды или сырой payload).
   */
  exportRecap: (orgId: string, id: string, format: 'slides' | 'json') =>
    apiClient.get<ValueRecapExportApi>(
      `/api/v1/dashboard/operations/value-recap/${encodeURIComponent(id)}/export${buildQuery({ format })}`,
      { headers: orgHeaders(orgId) },
    ),
};
