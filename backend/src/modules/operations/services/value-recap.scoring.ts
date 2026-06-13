/**
 * TZ-1 Фаза 5 (daily-value-engine) — чистая логика месячной витрины
 * value-recap. Без зависимостей от Prisma/NestJS — unit-тестируется без БД.
 *
 * Честность (Р6/Р7) — ВСТРОЕНА В КОД, не только в комментарии:
 *   - В payload НЕТ запрещённых ключей (₽/часы×ставка, было→стало «до Коры»,
 *     medianHoursToAnswer, roiScore/alignment как KPI, «N знаний спасено»).
 *     Гарантия — `assertNoForbiddenMetricKeys` (вызывается в build + тест).
 *   - Ведущая ось — твёрдые счётчики «снятой рутины» (из БД).
 *   - soft-цифры — с флагом «оценка» (estimate:true) + знаменателем.
 *   - count решений/задач — всегда в паре с throughputPercent (Ф3.B).
 */

/** Твёрдые счётчики «снятой рутины» (из БД, без LLM). */
export interface ValueRecapRoutine {
  /** Встреч запротоколировано авто (Meeting+AiResult). */
  meetingsAutoProtocoled: number;
  /** Задач извлечено (Task). */
  tasksExtracted: number;
  /** Решений извлечено (Decision). */
  decisionsExtracted: number;
  /** Договорённостей извлечено (IdeaBlock signalType=commitment). */
  commitmentsExtracted: number;
  /** Статусов собрано дайджестом (DailyCheckIn completed). */
  statusesCollected: number;
  /** Вопросов отвечено памятью с привязкой к источнику (grounding-proxy). */
  questionsAnsweredWithCitation: number;
  /** Идей доведено до релиза (Idea status=shipped). */
  ideasShipped: number;
}

/**
 * Soft-слой «команда работает лучше». Каждая цифра — «оценка» (estimate:true)
 * + знаменатель. count решений/задач — В ПАРЕ с «% доведённых».
 */
export interface ValueRecapTeam {
  /** Тренд надёжности обещаний. NULL — мало данных (denominator < min). */
  reliabilityPercent: number | null;
  reliabilityDenominator: number;
  /** Дельта надёжности к прошлому окну (может быть null). */
  reliabilityDelta: number | null;
  /** helped-rate чата. NULL — скрыто при rated<min («мало данных»). */
  chatHelpedRatePercent: number | null;
  /** Сколько ответов оценили (знаменатель для helped-rate). */
  chatRated: number;
  /** Ответов с привязкой к источнику (grounding-proxy, НЕ «дефлекция»). */
  chatAnsweredWithCitation: number;
  /** count решений за месяц (всегда в паре с throughputPercent). */
  decisionsTotal: number;
  /** % решений, доведённых до actualOutcomes (Ф3.B getDecisionThroughput). */
  decisionsThroughputPercent: number;
  /** Идей доведено до релиза (дублирует routine.ideasShipped для слоя). */
  ideasShipped: number;
  /** Каждая soft-цифра — «оценка», не KPI. Флаг для UI/honesty. */
  estimate: true;
}

/**
 * Одно решение месяца со статусом доведения (Ф3 редизайн — список решений в
 * витрине). count месяца идёт В ПАРЕ с team.decisionsThroughputPercent (Р7);
 * построчный `throughputPercent` — грубая шкала по статусу.
 */
export interface ValueRecapDecision {
  id: string;
  statement: string;
  /** Статус внедрения: done/in_progress/stalled/not_started. */
  status: string;
  /** % доведения по статусу (done=100, in_progress=50, иначе 0). */
  throughputPercent: number;
}

/** Дельта к прошлому месяцу по ведущим счётчикам (null — нет baseline). */
export interface ValueRecapDelta {
  meetingsAutoProtocoled: number | null;
  tasksExtracted: number | null;
  decisionsExtracted: number | null;
  commitmentsExtracted: number | null;
  statusesCollected: number | null;
  questionsAnsweredWithCitation: number | null;
  ideasShipped: number | null;
}

/** Полный payload витрины (хранится в `ValueRecapSnapshot.payloadJson`). */
export interface ValueRecapPayload {
  periodYm: string;
  /** ISO-момент сборки. */
  builtAt: string;
  /**
   * true — это первый снимок Org (baseline при онбординге). Дельты null:
   * без контрольной группы атрибуции продукту не делаем.
   */
  isBaseline: boolean;
  routine: ValueRecapRoutine;
  team: ValueRecapTeam;
  delta: ValueRecapDelta | null;
  /**
   * Топ-N решений месяца со статусом доведения (Ф3 редизайн). Пустой массив —
   * если решений нет. count в team.decisionsTotal + % в decisionsThroughputPercent.
   */
  decisions: ValueRecapDecision[];
  /** Человекочитаемая сводка (LLM или детерминированный fallback). */
  narrative: string;
}

/**
 * Запрещённые наружу метрики (Р6). Любой такой ключ в payload — баг честности.
 * Сверяем по подстроке (case-insensitive), чтобы поймать варианты написания.
 */
export const FORBIDDEN_METRIC_KEY_SUBSTRINGS: readonly string[] = [
  'rubles',
  'rubl',
  'kopeck',
  'kopek',
  'money',
  // часы × ставка → ₽ (именно денежная ставка, не «helped-rate»/«rated»).
  'hourlyrate',
  'hourrate',
  'raterub',
  'costrate',
  'hourssaved',
  'savedhours',
  'savedrub',
  'savedmoney',
  'savedcost',
  'medianhourstoanswer',
  'roiscore',
  'alignmentscore',
  'beforeafter',
  'knowledgesaved',
];

/**
 * Глубоко обойти объект и собрать ключи, чьё имя матчит запрещённый паттерн.
 * `helpedRate`/`throughputPercent` НЕ запрещены (это не ₽/ROI как KPI) —
 * исключены явным allow-list нормализованных имён.
 */
export function findForbiddenMetricKeys(payload: unknown): string[] {
  const allow = new Set([
    'helpedrate',
    'helpedratepercent',
    'feedbackcoveragepercent',
    'groundedratepercent',
    'helpedratehidden',
    'reliabilitypercent',
    'reliabilitydelta',
    'reliabilitydenominator',
    'throughputpercent',
    'decisionsthroughputpercent',
    'estimate',
  ]);
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const norm = key.toLowerCase().replace(/[^a-z]/g, '');
      if (!allow.has(norm)) {
        for (const bad of FORBIDDEN_METRIC_KEY_SUBSTRINGS) {
          if (norm.includes(bad)) {
            found.add(key);
            break;
          }
        }
      }
      visit(value);
    }
  };
  visit(payload);
  return [...found];
}

/**
 * Бросает, если в payload есть запрещённая наружу метрика (Р6). Вызывается
 * в `ValueRecapService.build` ПЕРЕД upsert — честность гарантируется кодом.
 */
export function assertNoForbiddenMetricKeys(payload: unknown): void {
  const bad = findForbiddenMetricKeys(payload);
  if (bad.length > 0) {
    throw new Error(
      `value-recap: payload содержит запрещённые наружу метрики (Р6): ${bad.join(', ')}`,
    );
  }
}

/** Дельта двух счётчиков; baseline (prev=null) → null (без атрибуции). */
export function computeCounterDelta(
  current: number,
  previous: number | null,
): number | null {
  if (previous === null) return null;
  return nonNeg(current) - nonNeg(previous);
}

/**
 * Собрать дельту по ведущим счётчикам к прошлому месяцу. Если baseline
 * (нет прошлого снимка) — вся дельта null.
 */
export function buildDelta(
  current: ValueRecapRoutine,
  previous: ValueRecapRoutine | null,
): ValueRecapDelta | null {
  if (!previous) return null;
  return {
    meetingsAutoProtocoled: computeCounterDelta(
      current.meetingsAutoProtocoled,
      previous.meetingsAutoProtocoled,
    ),
    tasksExtracted: computeCounterDelta(
      current.tasksExtracted,
      previous.tasksExtracted,
    ),
    decisionsExtracted: computeCounterDelta(
      current.decisionsExtracted,
      previous.decisionsExtracted,
    ),
    commitmentsExtracted: computeCounterDelta(
      current.commitmentsExtracted,
      previous.commitmentsExtracted,
    ),
    statusesCollected: computeCounterDelta(
      current.statusesCollected,
      previous.statusesCollected,
    ),
    questionsAnsweredWithCitation: computeCounterDelta(
      current.questionsAnsweredWithCitation,
      previous.questionsAnsweredWithCitation,
    ),
    ideasShipped: computeCounterDelta(
      current.ideasShipped,
      previous.ideasShipped,
    ),
  };
}

/**
 * Собрать полный payload витрины из посчитанных частей. Применяет
 * `assertNoForbiddenMetricKeys` к итогу (честность — в коде). Чистая функция.
 */
export function assembleValueRecapPayload(args: {
  periodYm: string;
  builtAt: Date;
  routine: ValueRecapRoutine;
  team: ValueRecapTeam;
  previousRoutine: ValueRecapRoutine | null;
  decisions: ValueRecapDecision[];
  narrative: string;
}): ValueRecapPayload {
  const isBaseline = args.previousRoutine === null;
  const payload: ValueRecapPayload = {
    periodYm: args.periodYm,
    builtAt: args.builtAt.toISOString(),
    isBaseline,
    routine: args.routine,
    team: args.team,
    delta: buildDelta(args.routine, args.previousRoutine),
    decisions: args.decisions ?? [],
    narrative: args.narrative,
  };
  assertNoForbiddenMetricKeys(payload);
  return payload;
}

function nonNeg(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}
