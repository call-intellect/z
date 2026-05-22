import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { DocumentKind } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';

import {
  DocumentParseFailedError,
  ParseSizeError,
  ParseTimeoutError,
} from './document-parser.errors';

/**
 * Результат парсинга документа. `text` — основной выход для дальнейшего
 * extraction'а; `metadata` — попытка вытащить «дешёвые» данные (заголовок,
 * автор, число страниц), которые удобно показывать в `/documents/:id`.
 *
 * `extractedAt` всегда заполнен (момент окончания парсинга, UTC).
 */
export interface ParseResult {
  text: string;
  metadata: {
    pageCount?: number;
    title?: string;
    author?: string;
    extractedAt: Date;
  };
}

/**
 * `DocumentParserService` (Фаза 0b knowledge-core).
 *
 * Унифицированный парсер документов. Используется:
 *   - `DocumentIngestAdapter` (BullMQ-job `document.uploaded`) — основной путь.
 *   - Будущие e-mail вложения / IMAP / Telegram attachments (Фаза γ).
 *
 * Поддерживает `pdf`, `docx`, `markdown`, `text`. `other` → `BadRequestException`.
 *
 * Архитектурные решения:
 *   - Внешние библиотеки (`pdf-parse`, `mammoth`, `marked`) подгружаются через
 *     `await import(...)` — это убирает их из cold-start'а Nest и позволяет
 *     приложению подняться даже если для текущей задачи парсер документов не
 *     нужен. Кроме того, `pdf-parse` имеет известные особенности с
 *     CommonJS/ESM-резолвом — динамический import обходит проблему.
 *   - Лимиты (size / timeout) — через `TypedConfigService` (см. `cfg.document`).
 *   - На превышении — типизированные ошибки (`ParseSizeError`/`ParseTimeoutError`)
 *     с человекочитаемыми русскими сообщениями.
 *   - Парсер НЕ обновляет БД и НЕ публикует события — это ответственность
 *     адаптера. Чистая функция `input → ParseResult | throws`.
 */
@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Главная точка входа. Применяет лимит размера, выбирает парсер по `kind`,
   * оборачивает вызов в timeout.
   */
  async parse(input: {
    kind: DocumentKind;
    content: Buffer | string;
    mimeType: string;
  }): Promise<ParseResult> {
    const sizeBytes = Buffer.isBuffer(input.content)
      ? input.content.byteLength
      : Buffer.byteLength(input.content, 'utf-8');
    if (sizeBytes > this.cfg.document.maxSizeBytes) {
      throw new ParseSizeError(sizeBytes, this.cfg.document.maxSizeBytes);
    }

    const timeoutMs = this.cfg.document.parseTimeoutMs;
    const work = (async (): Promise<ParseResult> => {
      switch (input.kind) {
        case 'pdf':
          return this.parsePdf(toBuffer(input.content));
        case 'docx':
          return this.parseDocx(toBuffer(input.content));
        case 'markdown':
          return this.parseMarkdown(toStringUtf8(input.content));
        case 'text':
          return {
            text: toStringUtf8(input.content),
            metadata: { extractedAt: new Date() },
          };
        case 'other':
        default:
          throw new BadRequestException({
            ok: false,
            error: {
              code: 'unsupported_document_kind',
              message: 'Тип документа не поддерживается',
            },
          });
      }
    })();

    return withTimeout(work, timeoutMs);
  }

  // ─────────────────────────── private parsers ──────────────────────────

  private async parsePdf(buffer: Buffer): Promise<ParseResult> {
    try {
      // Динамический импорт — см. JSDoc класса. Пакет может быть не
      // установлен в окружении до `bun install`; в рантайме после установки
      // импорт резолвится. Cast через `unknown` достаточен — `@ts-ignore`
      // выше становится unused после установки типов.
      const mod = (await import('pdf-parse')) as unknown as {
        PDFParse?: new (opts: { data: Buffer | Uint8Array }) => {
          getText: () => Promise<{
            text: string;
            pages?: Array<unknown>;
            info?: { Title?: string; Author?: string };
          }>;
          destroy: () => Promise<void>;
        };
        default?: (
          data: Buffer,
        ) => Promise<{
          text: string;
          numpages?: number;
          info?: { Title?: string; Author?: string };
        }>;
      };

      // Современный API (`PDFParse` class).
      if (mod.PDFParse) {
        const parser = new mod.PDFParse({ data: buffer });
        try {
          const result = await parser.getText();
          return {
            text: result.text ?? '',
            metadata: {
              pageCount: Array.isArray(result.pages)
                ? result.pages.length
                : undefined,
              title: result.info?.Title,
              author: result.info?.Author,
              extractedAt: new Date(),
            },
          };
        } finally {
          await parser.destroy().catch((err) => {
            this.logger.warn(
              `pdf-parse destroy упал: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      }

      // Fallback на legacy-API (`require('pdf-parse')(buffer)`).
      if (typeof mod.default === 'function') {
        const result = await mod.default(buffer);
        return {
          text: result.text ?? '',
          metadata: {
            pageCount: result.numpages,
            title: result.info?.Title,
            author: result.info?.Author,
            extractedAt: new Date(),
          },
        };
      }

      throw new DocumentParseFailedError(
        'pdf-parse не предоставил ожидаемый API (PDFParse class или default function)',
      );
    } catch (err) {
      if (
        err instanceof DocumentParseFailedError ||
        err instanceof BadRequestException
      ) {
        throw err;
      }
      throw new DocumentParseFailedError(
        err instanceof Error ? err.message : String(err),
        err,
      );
    }
  }

  private async parseDocx(buffer: Buffer): Promise<ParseResult> {
    try {
      const mod = (await import('mammoth')) as unknown as {
        extractRawText: (input: {
          buffer: Buffer;
        }) => Promise<{
          value: string;
          messages: Array<{ type: string; message: string }>;
        }>;
        default?: {
          extractRawText: (input: {
            buffer: Buffer;
          }) => Promise<{
            value: string;
            messages: Array<{ type: string; message: string }>;
          }>;
        };
      };
      const extractRawText =
        typeof mod.extractRawText === 'function'
          ? mod.extractRawText
          : mod.default?.extractRawText;
      if (!extractRawText) {
        throw new DocumentParseFailedError(
          'mammoth не предоставил extractRawText',
        );
      }
      const result = await extractRawText({ buffer });
      // mammoth.messages может содержать warning'и (неподдерживаемые стили) —
      // не считаем это фейлом, но логируем.
      if (result.messages && result.messages.length > 0) {
        this.logger.debug(
          { messages: result.messages.slice(0, 5) },
          `mammoth: ${result.messages.length} warnings при парсинге DOCX`,
        );
      }
      return {
        text: result.value ?? '',
        metadata: { extractedAt: new Date() },
      };
    } catch (err) {
      if (err instanceof DocumentParseFailedError) throw err;
      throw new DocumentParseFailedError(
        err instanceof Error ? err.message : String(err),
        err,
      );
    }
  }

  private async parseMarkdown(content: string): Promise<ParseResult> {
    try {
      const mod = (await import('marked')) as unknown as {
        marked: {
          parse: (md: string) => string | Promise<string>;
        };
      };
      const html = await Promise.resolve(mod.marked.parse(content));
      const text = stripHtmlTags(html);
      return {
        text,
        metadata: { extractedAt: new Date() },
      };
    } catch (err) {
      if (err instanceof DocumentParseFailedError) throw err;
      throw new DocumentParseFailedError(
        err instanceof Error ? err.message : String(err),
        err,
      );
    }
  }
}

// ─────────────────────────── helpers ───────────────────────────────────

function toBuffer(content: Buffer | string): Buffer {
  if (Buffer.isBuffer(content)) return content;
  return Buffer.from(content, 'utf-8');
}

function toStringUtf8(content: Buffer | string): string {
  if (typeof content === 'string') return content;
  return content.toString('utf-8');
}

/**
 * Простая обёртка `Promise.race` с таймером — на наших объёмах достаточно,
 * не тянем `p-timeout` отдельной зависимостью. Если задача не успела —
 * бросаем `ParseTimeoutError`. Реальный процесс парсера не «отменяется»
 * (Node не даёт прервать sync-цикл), но resolved-результат после таймаута
 * проигнорируется.
 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ParseTimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Удаляет HTML-теги из строки. Для markdown→plain text-конвертации.
 * Не парсер HTML — но для наших нужд (заглушающий plain-text для
 * embedding'ов и LLM-extract'а) достаточно.
 *
 *   - Удаляет `<tag>...</tag>` и self-closing `<tag/>`.
 *   - Декодирует базовые HTML-сущности (`&amp;`, `&lt;`, `&gt;`, `&quot;`,
 *     `&#39;`, `&nbsp;`).
 *   - Схлопывает множественные whitespace в один space, trim'ит концы.
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
