/**
 * ТЗ-2 Ф6.C / S1.5 (daily-value-engine) — API-клиент месячной витрины
 * «Что сделала Кора» (value-recap).
 *
 * Контракт:
 *   GET  /api/v1/dashboard/operations/value-recap?period=YYYY-MM
 *   POST /api/v1/dashboard/operations/value-recap/:id/opened
 *   GET  /api/v1/dashboard/operations/value-recap/:id/export?format=slides|json|pptx
 * (см. `backend/src/modules/operations/dto/value-recap.dto.ts`).
 * Auth: `CookieAuthGuard + TenantGuard` (cookie + `X-Org-Id` header).
 *
 * NB: format=pptx отдаёт binary (Content-Type pptx), поэтому JSON-only
 * `apiClient` для него не подходит — качаем прямым `fetch` с тем же
 * cookie-сессией и заголовком `X-Org-Id` (паттерн `voice.api.ts`).
 */

import { apiClient } from './api-client';
import { ApiError } from './api-error';
import { buildQuery, orgHeaders } from './admin-helpers';

const BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000'
).replace(/\/+$/, '');

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

/** Статус доведения решения. */
export type ValueRecapDecisionStatus =
  | 'done'
  | 'in_progress'
  | 'stalled'
  | 'not_started';

/** Одно решение месяца с прогрессом доведения (топ-10 из payload). */
export interface ValueRecapDecisionApi {
  id: string;
  statement: string;
  status: ValueRecapDecisionStatus;
  throughputPercent: number;
}

export interface ValueRecapPayloadApi {
  periodYm: string;
  builtAt: string;
  isBaseline: boolean;
  routine: ValueRecapRoutineApi;
  team: ValueRecapTeamApi;
  delta: ValueRecapDeltaApi | null;
  /** Топ-10 решений месяца со статусом и % доведения. */
  decisions: ValueRecapDecisionApi[];
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

/** Результат binary-экспорта (PPTX): blob + имя файла из Content-Disposition. */
export interface ValueRecapExportBlob {
  blob: Blob;
  filename: string;
}

/** Достаёт filename из заголовка Content-Disposition (`attachment; filename=...`). */
function parseFilename(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  // filename*=UTF-8''… (RFC 5987) имеет приоритет над простым filename=…
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/^"|"$/g, ''));
    } catch {
      // fall through
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1] ?? fallback;
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

  /**
   * `GET /dashboard/operations/value-recap/:id/export?format=pptx` — binary.
   * Возвращает blob презентации + имя файла из Content-Disposition.
   * Идёт мимо JSON-only `apiClient` (ответ бинарный).
   */
  exportRecapPptx: async (
    orgId: string,
    id: string,
    periodYm: string,
  ): Promise<ValueRecapExportBlob> => {
    const url = `${BASE_URL}/api/v1/dashboard/operations/value-recap/${encodeURIComponent(
      id,
    )}/export${buildQuery({ format: 'pptx' })}`;
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { ...orgHeaders(orgId), Accept: '*/*' },
    });
    if (!res.ok) {
      let message = 'Не удалось выгрузить презентацию.';
      let code = `http_${res.status}`;
      try {
        const body = (await res.json()) as {
          error?: { code?: string; message?: string };
        };
        if (body.error?.message) message = body.error.message;
        if (body.error?.code) code = body.error.code;
      } catch {
        // тело не JSON — оставляем дефолтную русскую фразу
      }
      throw new ApiError({ code, message });
    }
    const blob = await res.blob();
    const filename = parseFilename(
      res.headers.get('Content-Disposition'),
      `kora-itogi-${periodYm}.pptx`,
    );
    return { blob, filename };
  },
};
