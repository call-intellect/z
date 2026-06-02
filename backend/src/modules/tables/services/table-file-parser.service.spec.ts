import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { TableFileParserService } from './table-file-parser.service';

/**
 * Unit-тесты `TableFileParserService` (Smart-tables Фаза 4, Document-to-Table).
 *
 * XLSX-буфер генерируем через сам ExcelJS (writeBuffer), CSV — из inline-строки.
 * Проверяем: headers/rows, выравнивание, неподдерживаемый формат → 400.
 */
describe('TableFileParserService', () => {
  const svc = new TableFileParserService();

  async function xlsxBuffer(rows: Array<Array<string | number>>): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Лист1');
    ws.addRows(rows);
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  it('XLSX: первая строка — заголовки, остальные — данные', async () => {
    const buffer = await xlsxBuffer([
      ['Название', 'Сумма', 'Стадия'],
      ['ООО Ромашка', 100000, 'Переговоры'],
      ['АО Бета', 250000, 'Сделка'],
    ]);

    const res = await svc.parseFileToTable({
      buffer,
      filename: 'clients.xlsx',
    });

    expect(res.kind).toBe('xlsx');
    expect(res.headers).toEqual(['Название', 'Сумма', 'Стадия']);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toEqual(['ООО Ромашка', '100000', 'Переговоры']);
    expect(res.rows[1]).toEqual(['АО Бета', '250000', 'Сделка']);
  });

  it('XLSX: ≤50 колонок → truncatedColumns=false, все колонки сохранены', async () => {
    const headers = Array.from({ length: 50 }, (_, i) => `Кол${i + 1}`);
    const dataRow = Array.from({ length: 50 }, (_, i) => `v${i + 1}`);
    const buffer = await xlsxBuffer([headers, dataRow]);

    const res = await svc.parseFileToTable({ buffer, filename: 'wide50.xlsx' });

    expect(res.headers).toHaveLength(50);
    expect(res.truncatedColumns).toBe(false);
    expect(res.rows[0]).toHaveLength(50);
  });

  it('XLSX: >50 колонок → обрезаются до 50, truncatedColumns=true', async () => {
    const headers = Array.from({ length: 60 }, (_, i) => `Кол${i + 1}`);
    const dataRow = Array.from({ length: 60 }, (_, i) => `v${i + 1}`);
    const buffer = await xlsxBuffer([headers, dataRow]);

    const res = await svc.parseFileToTable({ buffer, filename: 'wide60.xlsx' });

    // Лишние столбцы отброшены до MAX_IMPORT_COLUMNS=50.
    expect(res.headers).toHaveLength(50);
    expect(res.headers[49]).toBe('Кол50');
    expect(res.truncatedColumns).toBe(true);
    // Ячейки строк тоже обрезаны до 50.
    expect(res.rows[0]).toHaveLength(50);
    expect(res.rows[0]?.[49]).toBe('v50');
  });

  it('XLSX: пустые строки данных пропускаются, столбцы выравниваются', async () => {
    const buffer = await xlsxBuffer([
      ['A', 'B', 'C'],
      ['x', 'y', 'z'],
      ['only-a'], // короткая строка → дополняется ''
    ]);

    const res = await svc.parseFileToTable({ buffer, filename: 'd.xlsx' });
    expect(res.headers).toEqual(['A', 'B', 'C']);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[1]).toEqual(['only-a', '', '']);
  });

  it('CSV: разбирает заголовки и строки из буфера', async () => {
    const csv = 'Имя,Email,Телефон\nИван,ivan@example.com,+79990001122\nПётр,petr@example.com,+79993334455\n';
    const buffer = Buffer.from(csv, 'utf8');

    const res = await svc.parseFileToTable({ buffer, filename: 'people.csv' });

    expect(res.kind).toBe('csv');
    expect(res.headers).toEqual(['Имя', 'Email', 'Телефон']);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toEqual(['Иван', 'ivan@example.com', '+79990001122']);
  });

  it('CSV: формат определяется по mimeType при отсутствии расширения', async () => {
    const buffer = Buffer.from('Колонка1,Колонка2\nа,б\n', 'utf8');
    const res = await svc.parseFileToTable({
      buffer,
      filename: 'noext',
      mimeType: 'text/csv',
    });
    expect(res.kind).toBe('csv');
    expect(res.headers).toEqual(['Колонка1', 'Колонка2']);
  });

  it('неподдерживаемый формат → BadRequestException (unsupported_file_format)', async () => {
    const buffer = Buffer.from('%PDF-1.4 ...', 'utf8');
    await expect(
      svc.parseFileToTable({ buffer, filename: 'scan.pdf' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('PDF → отдельное сообщение «появятся позже»', async () => {
    const buffer = Buffer.from('%PDF', 'utf8');
    await expect(
      svc.parseFileToTable({ buffer, filename: 'doc.pdf', mimeType: 'application/pdf' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'unsupported_file_format' } },
    });
  });
});
