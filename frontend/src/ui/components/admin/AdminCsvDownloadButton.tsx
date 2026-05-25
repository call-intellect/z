'use client';

import { Download } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';

export type CsvColumn<TRow extends Record<string, unknown>> = {
  key: keyof TRow & string;
  label: string;
  /**
   * Опциональный форматтер значения. По умолчанию — `String(value ?? '')`.
   * Для дат/булевых/объектов имеет смысл передать свой.
   */
  format?: (value: TRow[keyof TRow], row: TRow) => string;
};

type Props<TRow extends Record<string, unknown>> = {
  rows: TRow[];
  columns: CsvColumn<TRow>[];
  filename: string;
  /** Текст кнопки. По умолчанию «Скачать CSV». */
  label?: string;
  disabled?: boolean;
};

/**
 * AdminCsvDownloadButton — кнопка экспорта набора строк в CSV.
 *
 * Никаких внешних зависимостей: формируем CSV в памяти, оборачиваем в `Blob`
 * и эмулируем клик по скрытой ссылке через `URL.createObjectURL`.
 *
 * Особенности:
 *   - BOM `﻿` в начале файла, чтобы Excel корректно открыл UTF-8.
 *   - Разделитель — точка с запятой (русский Excel чаще ждёт `;`).
 *   - Кавычки эскейпятся удвоением (`"` → `""`), значения с `;`, `\n` или
 *     кавычкой оборачиваются в `"…"`.
 */
export function AdminCsvDownloadButton<TRow extends Record<string, unknown>>({
  rows,
  columns,
  filename,
  label = 'Скачать CSV',
  disabled,
}: Props<TRow>) {
  const handleDownload = (): void => {
    const csv = buildCsv(rows, columns);
    const blob = new Blob(['﻿', csv], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleDownload}
      disabled={disabled || rows.length === 0}
      title={
        rows.length === 0 ? 'Нет данных для экспорта' : 'Скачать таблицу в CSV'
      }
    >
      <Download size={14} aria-hidden />
      {label}
    </Button>
  );
}

/** Чистая функция для unit-тестов. */
export function buildCsv<TRow extends Record<string, unknown>>(
  rows: TRow[],
  columns: CsvColumn<TRow>[],
): string {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(';');
  const body = rows
    .map((row) =>
      columns
        .map((c) => {
          const raw = row[c.key];
          const value = c.format
            ? c.format(raw as TRow[keyof TRow], row)
            : raw === undefined || raw === null
              ? ''
              : String(raw);
          return escapeCsvCell(value);
        })
        .join(';'),
    )
    .join('\r\n');
  return `${header}\r\n${body}`;
}

function escapeCsvCell(value: string): string {
  const needsQuotes = /[";\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}
