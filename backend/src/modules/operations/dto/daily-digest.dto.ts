import { z } from 'zod';

/**
 * SBA β-8.3 — DTO `DailyOperationsDigest`.
 *
 * Источник: plans/tz/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md §1.2, §1.5.
 *
 * Зеркало `WeeklyOperationsDigest` с окном «вчерашние сутки в МСК».
 *
 *   - `metrics` — структурированные показатели (для виджетов на странице
 *     /dashboard/operations/daily).
 *   - `sources` — провенанс (id источников, для drill-down).
 *   - `bodyMarkdown` — связный текст комментария от LLM (markdown).
 *   - `shortSummary` — 3-4 предложения для Telegram-рассылки и блока на главной.
 *   - `deliveredAt` — отметка успешной Telegram-доставки (NULL — не отправлено).
 */

export interface DailyDigestMetricsDto {
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  /** Топ-3 «красных» чек-инов (имя + первые 200 симв. rawResponseText). */
  topRedCheckIns: Array<{
    checkInId: string;
    personName: string | null;
    excerpt: string;
  }>;
  /** Новые блокеры за день (топ-5 по severity high → medium → low). */
  newBlockers: Array<{
    blockId: string;
    name: string;
    confidence: number;
  }>;
  /** Просроченные обещания на сегодня (топ-5). */
  overdueCommitments: Array<{
    blockId: string;
    name: string;
    dueDate: string | null;
    recipientPersonId: string | null;
  }>;
  /** Цели, у которых вчера изменился статус (completed / abandoned / active). */
  goals: {
    completed: number;
    failed: number;
    activated: number;
    /** Список id для drill-down. */
    completedIds: string[];
    failedIds: string[];
  };
  /** Новые high-severity инсайты за вчера. */
  newHighInsights: Array<{
    insightId: string;
    statement: string;
    kind: string;
    causeCategory: string | null;
  }>;
  /** Принятые / отвергнутые решения вчера. */
  decisions: Array<{
    decisionId: string;
    statement: string;
    status: string;
  }>;
}

export interface DailyDigestSourcesDto {
  checkInIds: string[];
  blockerIds: string[];
  commitmentIds: string[];
  goalIds: string[];
  insightIds: string[];
  decisionIds: string[];
}

/**
 * Pulse Wave 2 §2.1 (2026-05-30) — Событие дня для хронологии.
 *
 * Может быть: завершённой встречей, принятым решением, либо критическим
 * сигналом (IdeaBlock с signalType ∈ {churn_risk, risk, pain} и confidence ≥ 0.8).
 *
 * Все 3 типа объединяются в один отсортированный по времени массив для
 * вкладки «Что произошло вчера» в ежедневном отчёте.
 */
export interface DailyDigestEventDto {
  kind: 'meeting' | 'decision' | 'signal';
  id: string;
  title: string;
  /** ISO timestamp когда произошло. */
  occurredAt: string;
  /** Drill-down путь на frontend. */
  link: string;
  /** Опц. краткое описание (для signal — kind/severity, для meeting — длительность). */
  detail?: string;
}

/**
 * Pulse Wave 2 §2.1 — Срочный пункт, требующий действия сегодня.
 *
 *   - `overdue_commitment` — обещание просрочено.
 *   - `raised_decision` — решение поднималось ≥2 раз (Фаза 1.2 raisedCount).
 *   - `high_insight` — high-severity Insight, ещё активный.
 *
 * `urgency` — для UI-приоритизации (high → красный badge, medium → жёлтый).
 */
export interface DailyDigestUrgentItemDto {
  kind: 'overdue_commitment' | 'raised_decision' | 'high_insight';
  id: string;
  title: string;
  link: string;
  /** Для overdue_commitment — дней просрочки; для raised_decision — raisedCount. */
  badge: string;
  urgency: 'high' | 'medium';
}

/**
 * Pulse Wave 2 §2.1 — Человек, который выделился позитивом вчера.
 *
 * V1: возвращаем пустой массив; полная реализация (recognition events,
 * helpful acts, kept commitments) — в Фазе 2.2/2.3, когда подключим
 * инфраструктуру признания.
 */
export interface DailyDigestPersonShinedDto {
  personId: string;
  personName: string;
  reason: 'recognition_received' | 'helpful_acts' | 'commitments_kept';
  detail: string;
  link: string;
}

/**
 * Pulse Wave 2 §2.1 — Человек, у которого вчера просел сигнал.
 *
 * Для разговора 1:1 с глазу на глаз. Дедуп по personId: один человек —
 * одна карточка, даже если просел по нескольким причинам.
 */
export interface DailyDigestPersonStruggledDto {
  personId: string;
  personName: string;
  reason: 'red_checkin' | 'broken_commitment' | 'silent_3_days';
  detail: string;
  link: string;
}

/**
 * TZ-1 Фаза 1 (daily-value-engine) — клиент под риском в COO-дайджесте.
 *
 * Топ-N по riskScore из `CustomerRiskSnapshot` (critical/warning). Runtime-
 * вычислено, не персистится в metricsJson. Если снимков нет — секция пуста.
 */
export interface DailyDigestCustomerAtRiskDto {
  customerName: string;
  riskLevel: 'critical' | 'warning';
  /** Краткий бейдж по преобладающим сигналам (без ₽). */
  badge: string;
}

/**
 * ТЗ-2 Ф3 — хронический блокер в ежедневном дайджесте.
 *
 * Топ-N из `BlockerSynthesis` (status ∈ new|recurring) по businessImpactScore.
 * Runtime-вычислено через `BlockerSynthesisService.listChronicForTenant`,
 * не персистится в metricsJson. Best-effort: если синтез пуст / упал — `[]`.
 */
export interface DailyDigestChronicBlockerDto {
  id: string;
  representativeText: string;
  /** new | recurring | resolved. */
  status: string;
  daysOpen: number;
  linkedInsightId: string | null;
  responsiblePersonId: string | null;
}

export interface DailyOperationsDigestDto {
  id: string;
  tenantId: string;
  /** YYYY-MM-DD — дата отчёта в МСК (день, ЗА который сделан отчёт). */
  dateLocal: string;
  bodyMarkdown: string;
  shortSummary: string | null;
  metrics: DailyDigestMetricsDto;
  sources: DailyDigestSourcesDto;
  llmTaskRouteId: string | null;
  deliveredAt: string | null;
  createdAt: string;
  // ────────── Pulse Wave 2 §2.1 — расширенные секции (runtime-вычислены) ──────────
  /** Хронология событий вчерашних суток. */
  eventsToday: DailyDigestEventDto[];
  /** Срочные пункты — требуют действия сегодня. */
  urgentItems: DailyDigestUrgentItemDto[];
  /** Кто выделился позитивом вчера. */
  whoShined: DailyDigestPersonShinedDto[];
  /** Кто просел вчера — для разговора с глазу на глаз. */
  whoStruggled: DailyDigestPersonStruggledDto[];
  /** TZ-1 Ф1 — клиенты под риском (топ по riskScore). Пусто, если снимков нет. */
  customersAtRisk: DailyDigestCustomerAtRiskDto[];
  /** ТЗ-2 Ф3 — хронические блокеры (топ по businessImpactScore). Пусто, если синтеза нет. */
  chronicBlockers: DailyDigestChronicBlockerDto[];
}

/**
 * Тип данных, передаваемых из `DailyDigestService.aggregate` в промпт.
 * Совпадает с `DailyDigestMetricsDto`, но без drill-down полей с id —
 * только то, что нужно LLM для генерации связного текста.
 */
export interface DailyDigestAggregates {
  dateLocal: string;
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  topRedCheckIns: Array<{ personName: string | null; excerpt: string }>;
  newBlockers: Array<{ name: string; confidence: number }>;
  overdueCommitments: Array<{ name: string; dueDate: string | null }>;
  goals: {
    completed: number;
    failed: number;
    activated: number;
  };
  newHighInsights: Array<{
    statement: string;
    kind: string;
    causeCategory: string | null;
  }>;
  decisions: Array<{ statement: string; status: string }>;
}

/**
 * Query-схема для `GET /api/v1/dashboard/operations/daily-digest?date=YYYY-MM-DD`
 * и `POST /generate?date=YYYY-MM-DD`.
 */
export const GetDailyDigestQuerySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date должен быть YYYY-MM-DD'),
  })
  .strict();

export type GetDailyDigestQuery = z.infer<typeof GetDailyDigestQuerySchema>;
