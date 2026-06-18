import { Readable } from 'node:stream';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';

@Injectable()
export class TableFileParserService {
  private readonly logger = new Logger(TableFileParserService.name);

  private static readonly HARD_MAX_DATA_ROWS = 50_000;

  static readonly MAX_IMPORT_COLUMNS = 50;

  async parseFileToTable(args: { buffer: Buffer; filename: string; mimeType?: string }): Promise<{
    kind: 'xlsx' | 'csv';
    headers: string[];
    rows: string[][];
    truncatedColumns: boolean;
  }> {
    const kind = this.detectKind(args.filename, args.mimeType);

    const parsed =
      kind === 'csv' ? await this.parseCsv(args.buffer) : await this.parseXlsx(args.buffer);

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

  private async parseXlsx(
    buffer: Buffer,
  ): Promise<{ headers: string[]; rows: string[][]; truncatedColumns: boolean }> {
    const workbook = new ExcelJS.Workbook();
    try {
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

  private async parseCsv(
    buffer: Buffer,
  ): Promise<{ headers: string[]; rows: string[][]; truncatedColumns: boolean }> {
    const workbook = new ExcelJS.Workbook();
    let worksheet: ExcelJS.Worksheet;
    try {
      const stream = Readable.from(buffer);
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

  private worksheetToTable(worksheet: ExcelJS.Worksheet): {
    headers: string[];
    rows: string[][];
    truncatedColumns: boolean;
  } {
    const matrix: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      if (matrix.length > TableFileParserService.HARD_MAX_DATA_ROWS + 1) return;
      const values: string[] = [];
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
    let lastNonEmpty = -1;
    for (let i = 0; i < rawHeaders.length; i++) {
      if ((rawHeaders[i] ?? '').trim().length > 0) lastNonEmpty = i;
    }
    const headers: string[] = [];
    for (let i = 0; i <= lastNonEmpty; i++) {
      const h = (rawHeaders[i] ?? '').trim();
      headers.push(h.length > 0 ? h : `Столбец ${i + 1}`);
    }

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

  private cellToString(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v === null || v === undefined) return '';
    const text = cell.text;
    if (typeof text === 'string') return text.trim();
    if (typeof v === 'object') {
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
