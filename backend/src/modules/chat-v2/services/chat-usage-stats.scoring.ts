/**
 * TZ-1 Фаза 5 (daily-value-engine) — чистая логика метрики AI-чата (несущая
 * часть месячной витрины value-recap). Без зависимостей от Prisma/NestJS —
 * unit-тестируется без БД.
 *
 * Честность (Р6/Р7):
 *   - `answeredWithCitation` — это grounding-proxy (ответ с привязкой к
 *     источнику), НЕ «дефлекция»/«сэкономлено». Имя/смысл соответствуют.
 *   - helped-rate = helpedUp / rated (НЕ / answered) — доля ИЗ ОЦЕНЁННЫХ.
 *   - при `rated < min` процент СКРЫВАЕМ («мало данных») — 1/1=100% врёт.
 */

/** Порог, ниже которого helped-rate скрывается («мало данных»). */
export const DEFAULT_CHAT_FEEDBACK_MIN_RATED = 10;

/** Окно дедупа повторных user-сообщений (ретраев) — < N секунд = один вопрос. */
export const DEFAULT_CHAT_RETRY_DEDUP_SECONDS = 30;

export interface ChatUsageRawCounts {
  /** count(role='user') за окно (до дедупа ретраев). */
  asked: number;
  /** count(role='assistant') за окно. */
  answered: number;
  /**
   * count(assistant с непустым массивом citations) — grounding-proxy.
   * Type-guard массива гарантируется на стороне SQL.
   */
  answeredWithCitation: number;
  /** count(helpful IS NOT NULL) — сколько ответов оценили. */
  rated: number;
  /** count(helpful='up'). */
  helpedUp: number;
}

export interface ChatUsageStats {
  asked: number;
  answered: number;
  answeredWithCitation: number;
  rated: number;
  helpedUp: number;
  /**
   * helpedUp/rated в процентах (0..100), округлено до целого. NULL когда
   * `rated < minRated` — «мало данных», процент скрыт.
   */
  helpedRatePercent: number | null;
  /**
   * rated / answered в процентах (0..100). Покрытие фидбеком — сколько
   * ответов вообще оценили. Не скрывается (это не оценка качества).
   */
  feedbackCoveragePercent: number;
  /**
   * Доля ответов с привязкой к источнику (grounding-proxy) в процентах
   * (answeredWithCitation/answered). НЕ «дефлекция».
   */
  groundedRatePercent: number;
  /** true когда helped-rate скрыт из-за малого знаменателя. */
  helpedRateHidden: boolean;
  /** Порог, при котором helped-rate скрывается (для прозрачности UI). */
  minRated: number;
}

/**
 * helped-rate = helpedUp / rated, в процентах (0..100, округление до целого).
 * При `rated <= 0` → null. НЕ делим на answered (Р7). Чистая функция.
 */
export function computeHelpedRate(
  helpedUp: number,
  rated: number,
): number | null {
  const r = nonNeg(rated);
  if (r <= 0) return null;
  const up = Math.min(nonNeg(helpedUp), r);
  return Math.round((up / r) * 100);
}

/**
 * Скрывать ли helped-rate: знаменатель оценок меньше порога. Чистая функция.
 * (1/1=100% при крошечном знаменателе вводит в заблуждение — «мало данных».)
 */
export function shouldHideRate(rated: number, minRated: number): boolean {
  return nonNeg(rated) < nonNeg(minRated);
}

/**
 * Собрать `ChatUsageStats` из сырых счётчиков. Применяет `shouldHideRate`
 * к helped-rate. Чистая функция (тестируется без БД).
 */
export function buildChatUsageStats(
  raw: ChatUsageRawCounts,
  minRated: number = DEFAULT_CHAT_FEEDBACK_MIN_RATED,
): ChatUsageStats {
  const asked = nonNeg(raw.asked);
  const answered = nonNeg(raw.answered);
  const answeredWithCitation = Math.min(nonNeg(raw.answeredWithCitation), answered);
  const rated = Math.min(nonNeg(raw.rated), answered === 0 ? nonNeg(raw.rated) : answered);
  const helpedUp = Math.min(nonNeg(raw.helpedUp), rated);
  const minR = nonNeg(minRated);

  const hidden = shouldHideRate(rated, minR);
  const helpedRatePercent = hidden ? null : computeHelpedRate(helpedUp, rated);

  return {
    asked,
    answered,
    answeredWithCitation,
    rated,
    helpedUp,
    helpedRatePercent,
    feedbackCoveragePercent: pct(rated, answered),
    groundedRatePercent: pct(answeredWithCitation, answered),
    helpedRateHidden: hidden,
    minRated: minR,
  };
}

function pct(num: number, denom: number): number {
  const n = nonNeg(num);
  const d = nonNeg(denom);
  if (d <= 0) return 0;
  return Math.round((Math.min(n, d) / d) * 100);
}

function nonNeg(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}
