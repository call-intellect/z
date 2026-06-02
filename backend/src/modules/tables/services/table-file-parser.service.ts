import { Readable } from 'node:stream';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';

/**
 * Smart-tables auto-creation (2026-06-02, Фаза 4) — Document-to-Table, парсер
 * загруженного файла в плоскую таблицу `{ headers, rows }`.
 *
 * Поддерживаются ТОЛЬКО офисные форматы, которые читаются транзитно в памяти:
 *   - XLSX/XLS — через `ExcelJS.Workbook().xlsx.load(buffer)` (первый лист);
 *   - CSV      — через `workbook.csv.read(stream)`.
 *
 * PDF и сканы НЕ поддерживаются в Фазе 4 — для них нужен отдельный микросервис
 * конвертации (DCS из ТЗ document-ingest, которого пока нет). Для таких файлов
 * возвращаем понятное русское сообщение.
 *
 * Multi-table (несколько таблиц/листов в одном файле) — вне scope: берём только
 * ПЕРВЫЙ лист и первую непустую строку как заголовки.
 */
@Injectable()
export class TableFileParserService {
  private readonly logger = new Logger(TableFileParserService.name);

  /**
   * Защита от гигантских файлов: читаем не больше этого числа строк ДАННЫХ
   * (без строки заголовков). Caller (контроллер) дополнительно режет по
   * admin-лимиту `importMaxRows` — здесь жёсткий технический потолок.
   */
  private static readonly HARD_MAX_DATA_ROWS = 50_000;

  /**
   * Жёсткий потолок числа колонок импорта. Совпадает с `properties.max(50)` в
   * commit-DTO: при большем числе столбцов лишние отбрасываются, чтобы analyze
   * никогда не отдал больше 50 properties (иначе commit-DTO упал бы валидацией).
   */
  static readonly MAX_IMPORT_COLUMNS = 50;

  /**
   * Парсит буфер файла в плоскую таблицу.
   *
   * @returns `{ kind, headers, rows, truncatedColumns }` где:
   *   - `kind`    — определённый формат ('xlsx' | 'csv');
   *   - `headers` — массив имён колонок (первая непустая строка файла), не
   *     длиннее `MAX_IMPORT_COLUMNS`;
   *   - `rows`    — массив строк данных; каждая строка — массив строковых
   *     значений ячеек, выровненный по длине `headers` (недостающие → '');
   *   - `truncatedColumns` — true, если исходных колонок было больше
   *     `MAX_IMPORT_COLUMNS` и лишние столбцы отброшены.
   * @throws BadRequestException code `unsupported_file_format` — формат не
   *   поддержан (включая PDF/скан с отдельным сообщением).
   * @throws BadRequestException code `file_parse_failed` — файл повреждён.
   * @throws BadRequestException code `file_empty_or_no_table` — нет данных.
   */
  async parseFileToTable(args: {
    buffer: Buffer;
    filename: string;
    mimeType?: string;
  }): Promise<{
    kind: 'xlsx' | 'csv';
    headers: string[];
    rows: string[][];
    truncatedColumns: boolean;
  }> {
    const kind = this.detectKind(args.filename, args.mimeType);

    const parsed =
      kind === 'csv'
        ? await this.parseCsv(args.buffer)
        : await this.parseXlsx(args.buffer);

    if (parsed.headers.length === 0) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'file_empty_or_no_table',
          message:
            'В файле не найдено ни одной таблицы с заголовками. Проверьте, что первая строка содержит названия столбцов.',
        },
      });
    }

    this.logger.log(
      {
        kind,
        columns: parsed.headers.length,
        rows: parsed.rows.length,
        truncatedColumns: parsed.truncatedColumns,
      },
      'table-file-parser: файл разобран',
    );
    return { kind, ...parsed };
  }

  // ──────────────────────────── private ────────────────────────────────────

  /** Определяет формат по расширению имени файла и/или MIME-типу. */
  private detectKind(filename: string, mimeType?: string): 'xlsx' | 'csv' {
    const name = (filename ?? '').toLowerCase();
    const mime = (mimeType ?? '').toLowerCase();

    if (name.endsWith('.csv') || mime === 'text/csv') return 'csv';
    if (
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      name.endsWith('.xlsm') ||
      mime.includes('spreadsheetml') ||
      mime === 'application/vnd.ms-excel'
    ) {
      return 'xlsx';
    }

    // PDF / сканы — явное отдельное сообщение (ждут отдельный сервис конвертации).
    if (name.endsWith('.pdf') || mime === 'application/pdf') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'unsupported_file_format',
          message:
            'PDF и сканы появятся позже. Пока загрузите таблицу в формате Excel (.xlsx) или CSV.',
        },
      });
    }

    throw new BadRequestException({
      ok: false,
      error: {
        code: 'unsupported_file_format',
        message:
          'Неподдерживаемый формат файла. Загрузите таблицу в формате Excel (.xlsx) или CSV.',
      },
    });
  }

  /** Разбирает XLSX-буфер: первый лист, первая непустая строка = заголовки. */
  private async parseXlsx(
    buffer: Buffer,
  ): Promise<{ headers: string[]; rows: string[][]; truncatedColumns: boolean }> {
    const workbook = new ExcelJS.Workbook();
    try {
      // ExcelJS принимает Buffer; типы ожидают ArrayBuffer-подобное — приводим.
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch (err) {
      throw this.parseFailed(err);
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return { headers: [], rows: [], truncatedColumns: false };
    }
    return this.worksheetToTable(worksheet);
  }

  /** Разбирает CSV-буфер через поток (ExcelJS строит лист в памяти). */
  private async parseCsv(
    buffer: Buffer,
  ): Promise<{ headers: string[]; rows: string[][]; truncatedColumns: boolean }> {
    const workbook = new ExcelJS.Workbook();
    let worksheet: ExcelJS.Worksheet;
    try {
      const stream = Readable.from(buffer);
      // map: оставляем КАЖДОЕ значение как есть (строкой). Без этого ExcelJS
      // авто-типизирует CSV-ячейки (например «+79990001122» → число 79990001122,
      // теряя ведущий «+»). Для импорта нам важны сырые строки — приведение
      // типов делает уже TableImportService по типу колонки.
      worksheet = await workbook.csv.read(stream, {
        map: (value: unknown) => (value == null ? '' : String(value)),
        parserOptions: { headers: false },
      } as unknown as Parameters<typeof workbook.csv.read>[1]);
    } catch (err) {
      throw this.parseFailed(err);
    }
    if (!worksheet) {
      return { headers: [], rows: [], truncatedColumns: false };
    }
    return this.worksheetToTable(worksheet);
  }

  /**
   * Превращает лист ExcelJS в `{ headers, rows, truncatedColumns }`.
   *
   * Заголовки = первая строка, в которой есть хотя бы одно непустое значение.
   * Все строки ниже — данные. Каждая строка данных выравнивается по длине
   * заголовков: лишние ячейки отбрасываются, недостающие дополняются ''.
   * Полностью пустые строки данных пропускаются.
   *
   * Колонки обрезаются до `MAX_IMPORT_COLUMNS`: если исходных столбцов было
   * больше — лишние отбрасываются и в `truncatedColumns` возвращается true.
   */
  private worksheetToTable(worksheet: ExcelJS.Worksheet): {
    headers: string[];
    rows: string[][];
    truncatedColumns: boolean;
  } {
    const matrix: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      if (matrix.length > TableFileParserService.HARD_MAX_DATA_ROWS + 1) return;
      const values: string[] = [];
      // row.eachCell нумерует колонки с 1; includeEmpty=true сохраняет позиции,
      // чтобы не «съезжали» столбцы при пустых ячейках в середине.
      let maxCol = 0;
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        values[colNumber - 1] = this.cellToString(cell);
        if (colNumber > maxCol) maxCol = colNumber;
      });
      for (let i = 0; i < maxCol; i++) {
        if (values[i] === undefined) values[i] = '';
      }
      matrix.push(values);
    });

    // Найти первую непустую строку — это заголовки.
    let headerIdx = -1;
    for (let i = 0; i < matrix.length; i++) {
      const r = matrix[i];
      if (r && r.some((v) => v.trim().length > 0)) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return { headers: [], rows: [], truncatedColumns: false };

    const rawHeaders = matrix[headerIdx] ?? [];
    // Обрезаем хвостовые пустые заголовки (Excel часто отдаёт лишние пустые колонки).
    let lastNonEmpty = -1;
    for (let i = 0; i < rawHeaders.length; i++) {
      if ((rawHeaders[i] ?? '').trim().length > 0) lastNonEmpty = i;
    }
    const headers: string[] = [];
    for (let i = 0; i <= lastNonEmpty; i++) {
      const h = (rawHeaders[i] ?? '').trim();
      headers.push(h.length > 0 ? h : `Столбец ${i + 1}`);
    }

    // Жёсткий потолок числа колонок: если столбцов больше MAX_IMPORT_COLUMNS —
    // отбрасываем лишние и сигналим truncatedColumns (см. JSDoc + commit-DTO).
    const MAX = TableFileParserService.MAX_IMPORT_COLUMNS;
    const truncatedColumns = headers.length > MAX;
    if (truncatedColumns) headers.length = MAX;

    const rows: string[][] = [];
    for (let i = headerIdx + 1; i < matrix.length; i++) {
      if (rows.length >= TableFileParserService.HARD_MAX_DATA_ROWS) break;
      const src = matrix[i] ?? [];
      const aligned: string[] = [];
      let hasValue = false;
      for (let c = 0; c < headers.length; c++) {
        const v = (src[c] ?? '').toString();
        aligned.push(v);
        if (v.trim().length > 0) hasValue = true;
      }
      if (hasValue) rows.push(aligned);
    }

    return { headers, rows, truncatedColumns };
  }

  /** Приводит значение ячейки ExcelJS к строке (text покрывает формулы/даты/ссылки). */
  private cellToString(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v === null || v === undefined) return '';
    // ExcelJS `cell.text` корректно сериализует даты/формулы/числа/гиперссылки.
    const text = cell.text;
    if (typeof text === 'string') return text.trim();
    if (typeof v === 'object') {
      // rich text / hyperlink / formula объекты — пробуем извлечь .text/.result.
      const obj = v as { text?: unknown; result?: unknown };
      if (typeof obj.text === 'string') return obj.text.trim();
      if (obj.result !== undefined && obj.result !== null) {
        return String(obj.result).trim();
      }
      return '';
    }
    return String(v).trim();
  }

  private parseFailed(err: unknown): BadRequestException {
    this.logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'table-file-parser: не удалось разобрать файл',
    );
    return new BadRequestException({
      ok: false,
      error: {
        code: 'file_parse_failed',
        message:
          'Не удалось прочитать файл. Возможно, он повреждён или сохранён в неподдерживаемом формате.',
      },
    });
  }
}
