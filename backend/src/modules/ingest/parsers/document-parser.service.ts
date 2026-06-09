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
 * Поддерживает `pdf`, `docx`, `markdown`, `text`, а также (ТЗ-4 Ф2)
 * `xlsx` (ExcelJS), `csv`, `pptx`, `rtf`, `odt`, `html` (officeparser).
 * `other` → `BadRequestException`.
 *
 * Архитектурные решения:
 *   - Внешние библиотеки (`pdf-parse`, `mammoth`, `marked`, `exceljs`,
 *     `officeparser`) подгружаются через
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
        case 'xlsx':
          return this.parseXlsx(toBuffer(input.content));
        case 'csv':
          return this.parseCsv(input.content);
        case 'pptx':
          return this.parseViaOfficeParser(toBuffer(input.content), 'pptx');
        case 'rtf':
          return this.parseViaOfficeParser(toBuffer(input.content), 'rtf');
        case 'odt':
          return this.parseViaOfficeParser(toBuffer(input.content), 'odt');
        case 'html':
          return this.parseHtml(input.content);
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

  /**
   * Парсинг Excel-таблицы (.xlsx) через `exceljs` (ТЗ-4 Ф2).
   *
   * НЕ используем `xlsx`/SheetJS (известная CVE, см. ТЗ). ExcelJS уже стоит
   * в проекте (рендер отчётов). Обходим все листы и строки, собираем текст
   * ячеек; листы разделяем строкой-заголовком с именем листа — так LLM/embedding
   * видит структуру «лист → строки».
   */
  private async parseXlsx(buffer: Buffer): Promise<ParseResult> {
    try {
      const mod = (await import('exceljs')) as unknown as {
        Workbook?: new () => ExcelWorkbookLike;
        default?: { Workbook?: new () => ExcelWorkbookLike };
      };
      const WorkbookCtor = mod.Workbook ?? mod.default?.Workbook;
      if (!WorkbookCtor) {
        throw new DocumentParseFailedError('exceljs не предоставил Workbook');
      }
      const wb = new WorkbookCtor();
      // ExcelJS принимает Buffer напрямую (поверх buffer.buffer как ArrayBuffer).
      await wb.xlsx.load(buffer);

      const lines: string[] = [];
      wb.eachSheet((worksheet) => {
        const sheetName =
          typeof worksheet.name === 'string' && worksheet.name.length > 0
            ? worksheet.name
            : `Лист ${worksheet.id ?? ''}`.trim();
        lines.push(`# ${sheetName}`);
        worksheet.eachRow((row) => {
          const cells: string[] = [];
          // includeEmpty:false по умолчанию — пробегаем только заполненные.
          row.eachCell((cell) => {
            const value = cellToText(cell.value);
            if (value.length > 0) cells.push(value);
          });
          if (cells.length > 0) lines.push(cells.join('\t'));
        });
      });

      return {
        text: lines.join('\n').trim(),
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

  /**
   * CSV (ТЗ-4 Ф2). officeparser умеет CSV (с `fileType: 'csv'`), но это
   * простой текстовый формат — если парсер споткнётся, безопасно отдаём сырой
   * UTF-8 (CSV самодостаточен как plain text для embedding'а/extract'а).
   */
  private async parseCsv(content: Buffer | string): Promise<ParseResult> {
    const raw = toStringUtf8(content);
    try {
      const text = await runOfficeParser(toBuffer(content), 'csv');
      const trimmed = text.trim();
      return {
        text: trimmed.length > 0 ? trimmed : raw.trim(),
        metadata: { extractedAt: new Date() },
      };
    } catch (err) {
      this.logger.debug(
        `officeparser упал на CSV (${err instanceof Error ? err.message : String(err)}) — fallback на сырой UTF-8`,
      );
      return {
        text: raw.trim(),
        metadata: { extractedAt: new Date() },
      };
    }
  }

  /**
   * Бинарные office-форматы (.pptx, .rtf, .odt) через `officeparser` (ТЗ-4 Ф2).
   * Эти форматы не синтезировать руками — отдаём как есть в parseOffice.
   */
  private async parseViaOfficeParser(
    buffer: Buffer,
    fileType: OfficeParserFileType,
  ): Promise<ParseResult> {
    try {
      const text = await runOfficeParser(buffer, fileType);
      return {
        text: text.trim(),
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

  /**
   * HTML-страница (выгрузка из вики/Confluence/Notion). Сначала officeparser
   * (он чистит разметку умнее), при пустом/ошибочном результате — fallback на
   * наш `stripHtmlTags` поверх сырого HTML.
   */
  private async parseHtml(content: Buffer | string): Promise<ParseResult> {
    const raw = toStringUtf8(content);
    try {
      const text = await runOfficeParser(toBuffer(content), 'html');
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        return { text: trimmed, metadata: { extractedAt: new Date() } };
      }
    } catch (err) {
      this.logger.debug(
        `officeparser упал на HTML (${err instanceof Error ? err.message : String(err)}) — fallback на stripHtmlTags`,
      );
    }
    return {
      text: stripHtmlTags(raw),
      metadata: { extractedAt: new Date() },
    };
  }
}

// ─────────────────────────── officeparser bridge ───────────────────────

/**
 * Поддерживаемые `officeparser` форматы, которые маршрутизирует наш switch.
 * Для бинарных (.pptx/.rtf/.odt) `fileType` опционален (автодетект по сигнатуре),
 * для текстовых (.csv/.html) — обязателен (см. Context7: IMPROPER_BUFFERS без хинта).
 */
type OfficeParserFileType = 'pptx' | 'rtf' | 'odt' | 'csv' | 'html';

/** Минимальный AST-контракт officeparser, который нам нужен (`toText()`). */
interface OfficeParserAstLike {
  toText: () => string;
}

/**
 * Единая обёртка над `officeparser.parseOffice(...)` (v7.x, проверено
 * эмпирически на 7.2.1: `parseOffice(buffer, { fileType }) → AST`, `ast.toText()`
 * синхронно отдаёт plain text). Вынесена в модульную функцию, чтобы юнит-тесты
 * могли подменить пакет через `vi.mock('officeparser')`.
 *
 * Для текстовых форматов (csv/html) `fileType` обязателен — без него v7 кидает
 * `IMPROPER_BUFFERS`. Для бинарных тоже передаём хинт — это безопасно и быстрее.
 */
async function runOfficeParser(
  buffer: Buffer,
  fileType: OfficeParserFileType,
): Promise<string> {
  const mod = (await import('officeparser')) as unknown as {
    parseOffice?: (
      file: Buffer,
      config?: { fileType?: string },
    ) => Promise<OfficeParserAstLike>;
    default?: {
      parseOffice?: (
        file: Buffer,
        config?: { fileType?: string },
      ) => Promise<OfficeParserAstLike>;
    };
  };
  const parseOffice = mod.parseOffice ?? mod.default?.parseOffice;
  if (typeof parseOffice !== 'function') {
    throw new DocumentParseFailedError('officeparser не предоставил parseOffice');
  }
  const ast = await parseOffice(buffer, { fileType });
  return typeof ast?.toText === 'function' ? ast.toText() : '';
}

/** Тип ячейки ExcelJS, который нам нужен (`value`). Не тянем полный тип либы. */
type ExcelCellLike = { value: unknown };
type ExcelRowLike = { eachCell: (cb: (cell: ExcelCellLike) => void) => void };
interface ExcelWorksheetLike {
  name?: string;
  id?: number;
  eachRow: (cb: (row: ExcelRowLike) => void) => void;
}
interface ExcelWorkbookLike {
  xlsx: { load: (data: Buffer) => Promise<unknown> };
  eachSheet: (cb: (worksheet: ExcelWorksheetLike) => void) => void;
}

/**
 * Приводит значение ячейки ExcelJS к строке. ExcelJS возвращает разные формы:
 * примитивы, `{ richText: [...] }`, `{ text, hyperlink }`, `{ formula, result }`,
 * `{ error }`, `Date`. Берём человекочитаемый текст; неизвестное — JSON/String.
 */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return v.richText
        .map((part) =>
          part && typeof part === 'object' && 'text' in part
            ? String((part as { text?: unknown }).text ?? '')
            : '',
        )
        .join('')
        .trim();
    }
    if (typeof v.text === 'string') return v.text.trim();
    if ('result' in v) return cellToText(v.result);
    if ('formula' in v) return `=${String(v.formula)}`;
    if ('error' in v) return String(v.error);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
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
