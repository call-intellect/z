/**
 * Доменная модель `CronSchedule` + `CronRunHistory` для `/admin/platform/crons`.
 * Фаза 8 редизайна Z-Admin.
 *
 * Контракт backend (`CronManagerController`,
 * префикс `/api/v1/admin/crons`):
 *   GET    /                   → CronScheduleApiDto[]
 *   GET    /with-history       → CronScheduleWithHistoryApiDto[]
 *   GET    /:name/history?limit=N → { items: CronRunHistoryApiDto[] }
 *   PATCH  /:name              → { ok: true }
 *   POST   /:name/run          → { ok: boolean, ... }
 *
 * Защита — `SuperAdminGuard` + `SuperAdminAuditInterceptor`
 * (severity='high' требует reason ≥ 10 символов на бэке).
 */

// ────────────────────────── ApiDto ──────────────────────────

export type CronRunHistoryApiDto = {
  startedAt: string;
  durationMs: number | null;
  status: string;
  error: string | null;
  triggeredBy: string | null;
};

export type CronScheduleApiDto = {
  name: string;
  expression: string;
  defaultExpression: string;
  enabled: boolean;
  description: string | null;
  lastRunAt: string | null;
  lastRunDurationMs: number | null;
  lastRunError: string | null;
  lastRun: CronRunHistoryApiDto | null;
};

export type CronScheduleWithHistoryApiDto = Omit<
  CronScheduleApiDto,
  'lastRun'
> & {
  recentRuns: CronRunHistoryApiDto[];
};

// ────────────────────────── DomainModel ──────────────────────────

export type CronRunHistoryDomain = {
  startedAt: Date;
  durationMs: number | null;
  status: string;
  error: string | null;
  triggeredBy: string | null;
};

export type CronScheduleDomain = {
  name: string;
  expression: string;
  defaultExpression: string;
  enabled: boolean;
  description: string | null;
  lastRunAt: Date | null;
  lastRunDurationMs: number | null;
  lastRunError: string | null;
  lastRun: CronRunHistoryDomain | null;
  /** Человеко-читаемое описание `expression`. */
  humanReadable: string;
};

// ────────────────────────── Mappers ──────────────────────────

export function cronRunHistoryFromApi(
  api: CronRunHistoryApiDto,
): CronRunHistoryDomain {
  return {
    startedAt: new Date(api.startedAt),
    durationMs: api.durationMs,
    status: api.status,
    error: api.error,
    triggeredBy: api.triggeredBy,
  };
}

export function cronScheduleFromApi(
  api: CronScheduleApiDto,
): CronScheduleDomain {
  return {
    name: api.name,
    expression: api.expression,
    defaultExpression: api.defaultExpression,
    enabled: api.enabled,
    description: api.description,
    lastRunAt: api.lastRunAt ? new Date(api.lastRunAt) : null,
    lastRunDurationMs: api.lastRunDurationMs,
    lastRunError: api.lastRunError,
    lastRun: api.lastRun ? cronRunHistoryFromApi(api.lastRun) : null,
    humanReadable: humanizeCronExpression(api.expression),
  };
}

// ────────────────────────── Cron expression → human ──────────────────────────

/**
 * Превращает базовые cron-выражения в русскоязычное описание.
 *
 * Поддерживается набор самых распространённых в кодовой базе Z паттернов:
 *   - "звёздочка-слэш-N звёздочка звёздочка звёздочка звёздочка" → «каждые N минут»
 *   - "0 звёздочка-слэш-6 ..." → «каждые 6 часов»
 *   - "0 N звёздочка звёздочка звёздочка" → «каждый день в N:00»
 *   - "N M звёздочка звёздочка звёздочка" (оба числа) → «каждый день в M:N»
 *   - "0 N звёздочка звёздочка D" (или с D1,D2,...) → «каждый <дни> в N:00»
 *   - "звёздочка звёздочка звёздочка звёздочка звёздочка" → «каждую минуту»
 *
 * Остальные выражения возвращаются как сырая строка. Это не парсер общего
 * назначения — задача UI лишь подсветить очевидные паттерны.
 */
const RU_WEEKDAYS: Record<string, string> = {
  '0': 'воскресенье',
  '1': 'понедельник',
  '2': 'вторник',
  '3': 'среда',
  '4': 'четверг',
  '5': 'пятница',
  '6': 'суббота',
  '7': 'воскресенье',
};

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function humanizeCronExpression(expr: string): string {
  const cleaned = expr.trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';

  const parts = cleaned.split(' ');
  // Поддерживаем 5-частный (классика) и 6-частный (с секундами) форматы.
  // Если 6 частей — первая часть это секунды; берём остальные 5.
  let segments = parts;
  if (segments.length === 6) {
    segments = segments.slice(1);
  }
  if (segments.length !== 5) return cleaned;

  const [minute, hour, dom, month, dow] = segments;

  // «Каждую минуту».
  if (
    minute === '*' &&
    hour === '*' &&
    dom === '*' &&
    month === '*' &&
    dow === '*'
  ) {
    return 'каждую минуту';
  }

  // «Каждые N минут» — `*/N * * * *`.
  const everyNMinutes = /^\*\/(\d+)$/.exec(minute);
  if (
    everyNMinutes &&
    hour === '*' &&
    dom === '*' &&
    month === '*' &&
    dow === '*'
  ) {
    const n = Number(everyNMinutes[1]);
    return `каждые ${n} ${pluralRu(n, 'минуту', 'минуты', 'минут')}`;
  }

  // «Каждые N часов в :00» — `0 */N * * *`.
  const everyNHours = /^\*\/(\d+)$/.exec(hour);
  if (
    minute === '0' &&
    everyNHours &&
    dom === '*' &&
    month === '*' &&
    dow === '*'
  ) {
    const n = Number(everyNHours[1]);
    return `каждые ${n} ${pluralRu(n, 'час', 'часа', 'часов')}`;
  }

  // «Каждый день в HH:MM» — фиксированные минута и час.
  const isFixedNum = (s: string) => /^\d+$/.test(s);
  if (isFixedNum(minute) && isFixedNum(hour) && dom === '*' && month === '*') {
    const hh = hour.padStart(2, '0');
    const mm = minute.padStart(2, '0');
    if (dow === '*') {
      return `каждый день в ${hh}:${mm}`;
    }
    // Дни недели — список или диапазон.
    const days = dow.split(',').map((d) => RU_WEEKDAYS[d.trim()] ?? d.trim());
    if (days.every((d) => Boolean(d))) {
      return `${days.join(', ')} в ${hh}:${mm}`;
    }
  }

  // «Каждый час в N» — `N * * * *`.
  if (
    isFixedNum(minute) &&
    hour === '*' &&
    dom === '*' &&
    month === '*' &&
    dow === '*'
  ) {
    return `каждый час в :${minute.padStart(2, '0')}`;
  }

  return cleaned;
}
