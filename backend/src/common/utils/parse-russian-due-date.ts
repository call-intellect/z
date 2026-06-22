const WEEKDAY_FORMS: Array<{ pattern: RegExp; day: number }> = [
  { pattern: /понедельник[а-я]*/, day: 1 },
  { pattern: /вторник[а-я]*/, day: 2 },
  { pattern: /сред[а-я]*/, day: 3 },
  { pattern: /четверг[а-я]*/, day: 4 },
  { pattern: /пятниц[а-я]*/, day: 5 },
  { pattern: /суббот[а-я]*/, day: 6 },
  { pattern: /воскресен[а-я]*/, day: 0 },
];

const MONTHS: Array<{ pattern: RegExp; month: number }> = [
  { pattern: /^январ/, month: 0 },
  { pattern: /^феврал/, month: 1 },
  { pattern: /^март/, month: 2 },
  { pattern: /^апрел/, month: 3 },
  { pattern: /^ма[йя]/, month: 4 },
  { pattern: /^июн/, month: 5 },
  { pattern: /^июл/, month: 6 },
  { pattern: /^август/, month: 7 },
  { pattern: /^сентябр/, month: 8 },
  { pattern: /^октябр/, month: 9 },
  { pattern: /^ноябр/, month: 10 },
  { pattern: /^декабр/, month: 11 },
];

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function makeUtcDate(year: number, monthIndex: number, day: number): Date | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(monthIndex) ||
    !Number.isInteger(day) ||
    monthIndex < 0 ||
    monthIndex > 11 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseExplicitDate(norm: string, now: Date): Date | null {
  const iso = norm.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return makeUtcDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const dmy = norm.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dmy) {
    return makeUtcDate(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  }

  const dm = norm.match(/(\d{1,2})\.(\d{1,2})(?!\.)/);
  if (dm) {
    const day = Number(dm[1]);
    const monthIndex = Number(dm[2]) - 1;
    const candidate = makeUtcDate(now.getUTCFullYear(), monthIndex, day);
    if (!candidate) return null;
    if (candidate.getTime() < startOfUtcDay(now).getTime()) {
      return makeUtcDate(now.getUTCFullYear() + 1, monthIndex, day);
    }
    return candidate;
  }

  return null;
}

function parseDayMonthWord(norm: string, now: Date): Date | null {
  const match = norm.match(/(\d{1,2})\s+([а-я]+)/);
  if (!match) return null;
  const day = Number(match[1]);
  const monthWord = match[2] ?? '';
  const found = MONTHS.find((m) => m.pattern.test(monthWord));
  if (!found) return null;
  const candidate = makeUtcDate(now.getUTCFullYear(), found.month, day);
  if (!candidate) return null;
  if (candidate.getTime() < startOfUtcDay(now).getTime()) {
    return makeUtcDate(now.getUTCFullYear() + 1, found.month, day);
  }
  return candidate;
}

function parseRelativeWords(norm: string, now: Date): Date | null {
  const today = startOfUtcDay(now);
  if (/послезавтра/.test(norm)) return addDays(today, 2);
  if (/завтра/.test(norm)) return addDays(today, 1);
  if (/сегодня/.test(norm)) return today;
  return null;
}

function parseThrough(norm: string, now: Date): Date | null {
  const today = startOfUtcDay(now);

  const days = norm.match(/через\s+(\d+)\s+(день|дня|дней)/);
  if (days) return addDays(today, Number(days[1]));

  const weeks = norm.match(/через\s+(\d+)\s+недел[а-я]+/);
  if (weeks) return addDays(today, Number(weeks[1]) * 7);

  if (/через\s+недел[а-я]+/.test(norm)) return addDays(today, 7);

  if (/через\s+месяц[а-я]*/.test(norm)) {
    return makeUtcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
  }

  return null;
}

function parseWeekday(norm: string, now: Date): Date | null {
  const today = startOfUtcDay(now);
  const found = WEEKDAY_FORMS.find((w) => w.pattern.test(norm));
  if (!found) return null;
  const currentDow = today.getUTCDay();
  let diff = (found.day - currentDow + 7) % 7;
  if (diff === 0) diff = 7;
  return addDays(today, diff);
}

export function parseRussianDueDate(text: string, now: Date): Date | null {
  if (typeof text !== 'string') return null;
  const norm = normalize(text);
  if (!norm) return null;

  return (
    parseExplicitDate(norm, now) ??
    parseRelativeWords(norm, now) ??
    parseThrough(norm, now) ??
    parseWeekday(norm, now) ??
    parseDayMonthWord(norm, now) ??
    null
  );
}
