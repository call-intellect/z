import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

import { DocumentParserService } from './document-parser.service';

function cfg(): TypedConfigService {
  return {
    document: {
      parseTimeoutMs: 30_000,
      maxSizeMb: 50,
      maxSizeBytes: 50 * 1024 * 1024,
      inlineThresholdMb: 10,
      inlineThresholdBytes: 10 * 1024 * 1024,
      s3Bucket: 'z-documents',
    },
  } as unknown as TypedConfigService;
}

/**
 * Unit-тесты DocumentParserService (Фаза 0b + ТЗ-4 Ф2).
 *
 * Пакеты (`exceljs`/`officeparser`/`marked`/`mammoth`/`pdf-parse`) установлены —
 * динамические импорты резолвятся в рантайме vitest. Тесты — pure-unit, без БД
 * и без сети. Бинарные форматы (pptx/odt/rtf) проверяем через `vi.mock`
 * (синтезировать настоящий .pptx/.odt/.rtf руками непрактично).
 */
describe('DocumentParserService', () => {
  it('parseMarkdown — strip HTML tags + декодирование сущностей', async () => {
    const svc = new DocumentParserService(cfg());
    const result = await svc.parse({
      kind: 'markdown',
      content: '# Заголовок\n\n**Жирный** &amp; обычный текст',
      mimeType: 'text/markdown',
    });
    expect(result.text).not.toContain('<');
    expect(result.text).not.toContain('>');
    expect(result.text).toContain('Заголовок');
    expect(result.text).toContain('Жирный');
    expect(result.text).toContain('&'); // decoded &amp;
    expect(result.metadata.extractedAt).toBeInstanceOf(Date);
  });

  it('parseText — buffer.toString utf-8', async () => {
    const svc = new DocumentParserService(cfg());
    const buf = Buffer.from('Привет, мир', 'utf-8');
    const result = await svc.parse({
      kind: 'text',
      content: buf,
      mimeType: 'text/plain',
    });
    expect(result.text).toBe('Привет, мир');
  });

  it('parsePdf — не падает на пустом PDF (graceful ParseFailedError)', async () => {
    const svc = new DocumentParserService(cfg());
    await expect(
      svc.parse({
        kind: 'pdf',
        content: Buffer.alloc(0),
        mimeType: 'application/pdf',
      }),
    ).rejects.toThrow();
  });

  it('other → BadRequestException (unsupported_document_kind)', async () => {
    const svc = new DocumentParserService(cfg());
    await expect(
      svc.parse({
        kind: 'other',
        content: Buffer.from(''),
        mimeType: 'application/octet-stream',
      }),
    ).rejects.toThrow();
    // Проверяем именно код ошибки.
    try {
      await svc.parse({
        kind: 'other',
        content: Buffer.from(''),
        mimeType: 'application/octet-stream',
      });
      expect.unreachable('должно было бросить');
    } catch (err) {
      const body = (err as { response?: unknown; getResponse?: () => unknown })
        .getResponse?.();
      expect(JSON.stringify(body)).toContain('unsupported_document_kind');
    }
  });

  it('size > maxSizeBytes → ParseSizeError', async () => {
    const cfgSmall = {
      document: {
        ...cfg().document,
        maxSizeBytes: 10, // 10 байт лимит
      },
    } as unknown as TypedConfigService;
    const svc = new DocumentParserService(cfgSmall);
    await expect(
      svc.parse({
        kind: 'text',
        content: Buffer.from('larger than 10 bytes content'),
        mimeType: 'text/plain',
      }),
    ).rejects.toThrow(/Превышен лимит размера/);
  });

  // ─────────────────────── ТЗ-4 Ф2 — новые форматы ──────────────────────

  it('parseXlsx — синтетический .xlsx (exceljs) → текст по листам', async () => {
    // Строим настоящий xlsx-буфер через ту же exceljs, что использует парсер.
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    const sheet = wb.addWorksheet('Бюджет');
    sheet.addRow(['Статья', 'Сумма']);
    sheet.addRow(['Аренда', 100000]);
    sheet.addRow(['Зарплаты', 500000]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const svc = new DocumentParserService(cfg());
    const result = await svc.parse({
      kind: 'xlsx',
      content: buffer,
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).toContain('Бюджет'); // имя листа как заголовок
    expect(result.text).toContain('Статья');
    expect(result.text).toContain('Аренда');
    expect(result.text).toContain('100000');
    expect(result.metadata.extractedAt).toBeInstanceOf(Date);
  });

  it('parseCsv — строка CSV → текст (officeparser или fallback на сырой UTF-8)', async () => {
    const svc = new DocumentParserService(cfg());
    const csv = 'Имя,Город\nАнна,Москва\nПётр,Казань';
    const result = await svc.parse({
      kind: 'csv',
      content: csv,
      mimeType: 'text/csv',
    });
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).toContain('Анна');
    expect(result.text).toContain('Казань');
  });
});

/**
 * Бинарные форматы (pptx/odt/rtf) — маршрутизацию проверяем через мок
 * `officeparser`: подменяем `parseOffice` на sentinel и убеждаемся, что нужная
 * ветка switch вызвала именно его. Настоящие бинарные фикстуры не требуются.
 */
describe('DocumentParserService — officeparser routing (mocked)', () => {
  const sentinel = 'SENTINEL-OFFICEPARSER-OUTPUT';

  it('pptx/odt/rtf → вызывают officeparser.parseOffice и возвращают его toText()', async () => {
    const parseOffice = vi.fn(async (_buf: Buffer, cfgArg?: { fileType?: string }) => ({
      toText: () => `${sentinel}:${cfgArg?.fileType ?? 'auto'}`,
    }));
    vi.doMock('officeparser', () => ({ parseOffice }));

    // Импортируем сервис ПОСЛЕ установки мока (иначе dynamic import возьмёт реальный модуль).
    vi.resetModules();
    const { DocumentParserService: SvcMocked } = await import(
      './document-parser.service'
    );
    const svc = new SvcMocked(cfg());

    for (const kind of ['pptx', 'odt', 'rtf'] as const) {
      const result = await svc.parse({
        kind,
        content: Buffer.from('fake-binary'),
        mimeType: 'application/octet-stream',
      });
      expect(result.text).toContain(sentinel);
      expect(result.text).toContain(kind); // fileType хинт прокинут
    }
    expect(parseOffice).toHaveBeenCalledTimes(3);

    vi.doUnmock('officeparser');
    vi.resetModules();
  });
});
