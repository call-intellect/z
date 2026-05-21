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
 * Skeleton-тесты DocumentParserService (Фаза 0b knowledge-core).
 *
 * Сейчас skip — динамические импорты `pdf-parse`/`mammoth`/`marked` требуют
 * установленных пакетов, что произойдёт после `bun install` (отдельный шаг
 * оркестратора). После установки разблокировать через `describe(...)`.
 *
 * Тесты — pure-unit, без БД и без сети.
 */
describe.skip('DocumentParserService', () => {
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

  it('parsePdf — не падает на пустом PDF (graceful empty result)', async () => {
    // pdf-parse на пустом buffer бросит — ожидаем ParseFailedError, не unhandled.
    const svc = new DocumentParserService(cfg());
    await expect(
      svc.parse({
        kind: 'pdf',
        content: Buffer.alloc(0),
        mimeType: 'application/pdf',
      }),
    ).rejects.toThrow();
  });

  it('other → BadRequestException', async () => {
    const svc = new DocumentParserService(cfg());
    await expect(
      svc.parse({
        kind: 'other',
        content: Buffer.from(''),
        mimeType: 'application/octet-stream',
      }),
    ).rejects.toThrow();
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
});

// Чтобы vitest не ругался "no tests in file" — ставим один always-pass
// проверки, что класс инстанцируется.
describe('DocumentParserService (smoke)', () => {
  it('конструктор не падает', () => {
    expect(new DocumentParserService(cfg())).toBeInstanceOf(
      DocumentParserService,
    );
  });
});

// Tip: vi.mock('pdf-parse'), vi.mock('mammoth'), vi.mock('marked') можно
// будет подключить здесь после `bun install`, чтобы не зависеть от того,
// установлены ли пакеты в окружении test:unit.
void vi; // явный импорт для подавления unused-warning'а
