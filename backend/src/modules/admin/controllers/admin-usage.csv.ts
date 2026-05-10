import type { Response } from 'express';

/**
 * Streamer CSV-ответа для admin usage (Z-Admin Фаза 7, шаг 3).
 *
 * Без библиотек: ручная сериализация. Разделитель — `,`. Newline — `\n`.
 * Quote-policy: оборачиваем поле в `"..."` если оно содержит `,`/`"`/`\n`/`\r`,
 * экранируем внутренние `"` как `""`.
 *
 * Header'ы выводятся из ключей первой строки. Если items пуст — отдаём
 * только пустой ответ (без header'ов — фронт это обработает как 0 строк).
 */
export function streamUsageCsv<T extends object>(
  res: Response,
  rows: ReadonlyArray<T>,
): void {
  if (rows.length === 0) return;

  const first = rows[0];
  if (!first) return;
  const keys = Object.keys(first as Record<string, unknown>);
  res.write(keys.join(',') + '\n');
  for (const row of rows) {
    const line = keys
      .map((k) => csvCell((row as Record<string, unknown>)[k]))
      .join(',');
    res.write(line + '\n');
  }
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'string') {
    s = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    s = String(value);
  } else if (value instanceof Date) {
    s = value.toISOString();
  } else {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  }
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
