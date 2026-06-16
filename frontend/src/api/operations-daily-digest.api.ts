import { apiClient } from './api-client';

/**
 * SBA β-8.3 Wave 1 — API-клиент ежедневного отчёта операционного директора.
 *
 *   GET  /api/v1/dashboard/operations/daily-digest?date=YYYY-MM-DD
 *   GET  /api/v1/dashboard/operations/daily-digest/latest
 *   POST /api/v1/dashboard/operations/daily-digest/generate?date=YYYY-MM-DD
 *
 * Контракт DTO зеркалит `backend/src/modules/operations/dto/daily-digest.dto.ts`
 * (`DailyOperationsDigestDto`).
 *
 * Доступ:
 *   - read (GET) — coo / owner / admin / super_admin (через
 *     `RbacService.canViewOperationsDashboard`).
 *   - write (POST /generate) — admin / super_admin.
 *
 * Поведение API: при 404 (отчёт за дату ещё не сгенерирован) бэк отдаёт
 * `error.code === 'digest_not_found'`. Здесь мы перехватываем эту ситуацию
 * и возвращаем `null`, чтобы вызывающая сторона могла легко отличить
 * «нет отчёта» от настоящей ошибки сети / прав.
 */

import { ApiError } from './api-error';

/** Зеркало `DailyDigestMetricsDto` из backend. */
export interface DailyDigestMetricsApi {
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  topRedCheckIns: Array<{
    checkInId: string;
    personName: string | null;
    excerpt: string;
  }>;
  newBlockers: Array<{
    blockId: string;
    name: string;
    confidence: number;
  }>;
  overdueCommitments: Array<{
    blockId: string;
    name: string;
    dueDate: string | null;
    recipientPersonId: string | null;
  }>;
  goals: {
    completed: number;
    failed: number;
    activated: number;
    completedIds: string[];
    failedIds: string[];
  };
  newHighInsights: Array<{
    insightId: string;
    statement: string;
    kind: string;
    causeCategory: string | null;
  }>;
  decisions: Array<{
    decisionId: string;
    statement: string;
    status: string;
  }>;
}

export interface DailyDigestSourcesApi {
  checkInIds: string[];
  blockerIds: string[];
  commitmentIds: string[];
  goalIds: string[];
  insightIds: string[];
  decisionIds: string[];
}

/**
 * Pulse Wave 2 §2.1 — событие в хронологии «Что произошло вчера».
 * Зеркалит `DailyDigestEventDto` в backend.
 */
export interface DailyDigestEventApi {
  kind: 'meeting' | 'decision' | 'signal';
  id: string;
  title: string;
  occurredAt: string;
  link: string;
  detail?: string;
}

/** Pulse Wave 2 §2.1 — срочный пункт, требующий действия сегодня. */
export interface DailyDigestUrgentItemApi {
  kind: 'overdue_commitment' | 'raised_decision' | 'high_insight';
  id: string;
  title: string;
  link: string;
  badge: string;
  urgency: 'high' | 'medium';
}

/** Pulse Wave 2 §2.1 — человек, выделившийся позитивом вчера. */
export interface DailyDigestPersonShinedApi {
  personId: string;
  personName: string;
  reason: 'recognition_received' | 'helpful_acts' | 'commitments_kept';
  detail: string;
  link: string;
}

/** Pulse Wave 2 §2.1 — человек, у которого просел сигнал. */
export interface DailyDigestPersonStruggledApi {
  personId: string;
  personName: string;
  reason: 'red_checkin' | 'broken_commitment' | 'silent_3_days';
  detail: string;
  link: string;
}

/**
 * ТЗ-2 Ф3 — хронический (повторяющийся) блокер за сутки.
 * Зеркалит runtime-поле `chronicBlockers` из backend (committed 95dd16ae).
 */
export interface DailyDigestChronicBlockerApi {
  id: string;
  representativeText: string;
  status: 'new' | 'recurring' | 'resolved';
  daysOpen: number;
  linkedInsightId: string | null;
  responsiblePersonId: string | null;
}

/**
 * ТЗ coo-orphan-agents Ф4 — клиент под риском в дневном дайджесте (зеркало
 * backend DailyDigestCustomerAtRiskDto). Без ₽.
 */
export interface DailyDigestCustomerAtRiskApi {
  customerName: string;
  riskLevel: 'critical' | 'warning';
  badge: string;
}

/**
 * Ф1b редизайна дашбордов — точка исторического тренда (зеркало backend
 * `DailyDigestTrendPointDto`). Считается из persisted-снимков metricsJson.
 */
export interface DailyDigestTrendPointApi {
  dateLocal: string;
  totalCheckIns: number;
  greenShare: number;
  redShare: number;
  blockers: number;
  overdueCommitments: number;
  goalsCompleted: number;
  goalsFailed: number;
}

export interface DailyDigestApi {
  id: string;
  tenantId: string;
  /** YYYY-MM-DD в МСК. */
  dateLocal: string;
  bodyMarkdown: string;
  shortSummary: string | null;
  metrics: DailyDigestMetricsApi;
  sources: DailyDigestSourcesApi;
  llmTaskRouteId: string | null;
  deliveredAt: string | null;
  createdAt: string;
  // Pulse Wave 2 §2.1 — расширенные секции (runtime-вычислены на backend).
  eventsToday: DailyDigestEventApi[];
  urgentItems: DailyDigestUrgentItemApi[];
  whoShined: DailyDigestPersonShinedApi[];
  whoStruggled: DailyDigestPersonStruggledApi[];
  // ТЗ coo-orphan-agents Ф4 — клиенты под риском (runtime на backend).
  customersAtRisk: DailyDigestCustomerAtRiskApi[];
  // ТЗ-2 Ф3 — хронические блокеры (runtime-вычислены на backend).
  chronicBlockers: DailyDigestChronicBlockerApi[];
  // Ф1b — исторический тренд (runtime из persisted-снимков на backend), old→new.
  trend: DailyDigestTrendPointApi[];
}

/** Обёртка-helper: ловит digest_not_found и превращает в `null`. */
async function tolerantGet(path: string): Promise<DailyDigestApi | null> {
  try {
    return await apiClient.get<DailyDigestApi>(path);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'digest_not_found') {
      return null;
    }
    throw e;
  }
}

export const operationsDailyDigestApi = {
  /** Получить дайджест за конкретную дату (YYYY-MM-DD в МСК) или null. */
  getByDate: (date: string) =>
    tolerantGet(`/api/v1/dashboard/operations/daily-digest?date=${date}`),

  /** Последний доступный дайджест (по dateLocal DESC) или null. */
  getLatest: () =>
    tolerantGet('/api/v1/dashboard/operations/daily-digest/latest'),

  /** Принудительно пересобрать дайджест (admin / super_admin). */
  generate: (date: string) =>
    apiClient.post<DailyDigestApi>(
      `/api/v1/dashboard/operations/daily-digest/generate?date=${date}`,
      undefined,
    ),
};
