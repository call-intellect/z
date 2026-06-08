/**
 * TZ-1 Фаза 3.A (daily-value-engine) — чистая логика синтеза блокеров.
 *
 * Выделено отдельным модулем без зависимостей от Prisma/NestJS, чтобы покрыть
 * unit-тестами без БД/времени. Веса/окна приходят аргументами (источник —
 * AdminSetting в `BlockerSynthesisService`).
 */

export type BlockerStatus = 'new' | 'recurring' | 'resolved';

/** Веса бизнес-удара блокера (выше — приоритетнее). */
export interface BlockerImpactWeights {
  /** База за каждый блокер в кластере. */
  base: number;
  /** Бонус, если задевает клиента. */
  customer: number;
  /** Бонус, если задевает дедлайн/срок. */
  deadline: number;
  /** Бонус, если задевает обещание/договорённость. */
  commitment: number;
  /** Множитель за каждый день, что блокер открыт (хроника тяжелее). */
  perDayOpen: number;
}

export const DEFAULT_BLOCKER_IMPACT_WEIGHTS: BlockerImpactWeights = {
  base: 1,
  customer: 4,
  deadline: 3,
  commitment: 2,
  perDayOpen: 0.5,
};

export const DEFAULT_BLOCKER_LOOKBACK_DAYS = 7;
export const DEFAULT_BLOCKER_RECURRING_DAYS = 2;

/** Признаки, которые поднимают бизнес-удар блокера. */
export interface BlockerImpactSignals {
  /** Сколько блоков-источников в кластере (масштаб). */
  blockCount: number;
  touchesCustomer: boolean;
  touchesDeadline: boolean;
  touchesCommitment: boolean;
  /** Сколько дней блокер открыт (firstSeen→lastSeen). */
  daysOpen: number;
}

/**
 * Взвешенный бизнес-удар кластера блокеров. Чистая функция.
 * Неконечные/отрицательные значения трактуются как 0/false (защита от мусора).
 * Округление до 4 знаков (соответствует Decimal(8,4) в БД).
 */
export function computeBusinessImpact(
  signals: BlockerImpactSignals,
  weights: BlockerImpactWeights,
): number {
  const w = sanitizeWeights(weights);
  const count = safeNonNeg(signals.blockCount) || 1;
  const daysOpen = safeNonNeg(signals.daysOpen);

  let score = w.base * count;
  if (signals.touchesCustomer === true) score += w.customer;
  if (signals.touchesDeadline === true) score += w.deadline;
  if (signals.touchesCommitment === true) score += w.commitment;
  score += w.perDayOpen * daysOpen;

  return Math.round(score * 10_000) / 10_000;
}

/**
 * Классификация статуса кластера блокеров. Чистая функция (детерминированная по
 * датам — без обращения к «сегодня», чтобы быть тестируемой и идемпотентной).
 *
 * Логика:
 *   - `resolved` — кластер не появлялся в сегодняшнем прогоне, но был раньше
 *     (lastSeen < today), т.е. перестал упоминаться. Сигнал передаётся флагом
 *     `seenToday=false`.
 *   - `recurring` — упоминался сегодня И появлялся в предыдущие дни внутри окна
 *     (firstSeen < today). Хроника.
 *   - `new` — упоминался впервые сегодня (firstSeen === today).
 *
 * @param firstSeen YYYY-MM-DD первого появления кластера.
 * @param today     YYYY-MM-DD текущего прогона.
 * @param seenToday появлялся ли кластер в сегодняшнем срезе.
 */
export function classifyBlockerStatus(args: {
  firstSeen: string;
  today: string;
  seenToday: boolean;
}): BlockerStatus {
  if (!args.seenToday) return 'resolved';
  if (args.firstSeen < args.today) return 'recurring';
  return 'new';
}

/**
 * Календарная разница в днях между двумя YYYY-MM-DD (включительно: same day=0).
 * Чистая, через UTC-арифметику. Отрицательное → 0.
 */
export function daysBetween(fromDateLocal: string, toDateLocal: string): number {
  const a = Date.parse(`${fromDateLocal}T00:00:00.000Z`);
  const b = Date.parse(`${toDateLocal}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const diff = Math.round((b - a) / 86_400_000);
  return diff > 0 ? diff : 0;
}

/**
 * Нормализация текста блокера для дешёвого ratio-кластерного ключа (дешёвый
 * ratio-детект до embedding'ов): нижний регистр, схлоп пробелов, обрезка
 * пунктуации по краям, ограничение длины. Чистая функция.
 */
export function normalizeBlockerText(raw: string): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[«»"'`.,!?;:()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function safeNonNeg(v: unknown): number {
  const n = safeNumber(v);
  return n > 0 ? n : 0;
}

function sanitizeWeights(w: BlockerImpactWeights): BlockerImpactWeights {
  return {
    base: safeNonNeg(w.base),
    customer: safeNonNeg(w.customer),
    deadline: safeNonNeg(w.deadline),
    commitment: safeNonNeg(w.commitment),
    perDayOpen: safeNonNeg(w.perDayOpen),
  };
}
