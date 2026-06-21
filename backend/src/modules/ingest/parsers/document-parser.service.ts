import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { DocumentKind } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';

import {
  DocumentParseFailedError,
  ParseSizeError,
  ParseTimeoutError,
} from './document-parser.errors';

export interface ParseResult {
  text: string;
  metadata: {
    pageCount?: number;
    pageOffsets?: number[];
    title?: string;
    author?: string;
    extractedAt: Date;
  };
}

export function joinPagesWithOffsets(
  pages: string[],
  separator = '\n\n',
): { text: string; pageOffsets: number[] } {
  let text = '';
  const pageOffsets: number[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    pageOffsets.push(text.length);
    text += pages[i] ?? '';
    if (i < pages.length - 1) text += separator;
  }
  return { text, pageOffsets };
}

@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

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

  private async parsePdf(buffer: Buffer): Promise<ParseResult> {
    try {
      const { extractText, getDocumentProxy, getMeta } = (await import('unpdf')) as unknown as {
        extractText: (
          pdf: unknown,
          options?: { mergePages?: boolean },
        ) => Promise<{ totalPages: number; text: string[] }>;
        getDocumentProxy: (data: Uint8Array) => Promise<unknown>;
        getMeta: (pdf: unknown) => Promise<{ info?: { Title?: string; Author?: string } }>;
      };

      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { totalPages, text: pages } = await extractText(pdf);
      const { info } = await getMeta(pdf);
      const { text, pageOffsets } = joinPagesWithOffsets(pages);

      return {
        text,
        metadata: {
          pageCount: totalPages,
          pageOffsets,
          title: info?.Title,
          author: info?.Author,
          extractedAt: new Date(),
        },
      };
    } catch (err) {
      if (err instanceof DocumentParseFailedError || err instanceof BadRequestException) {
        throw err;
      }
      throw new DocumentParseFailedError(err instanceof Error ? err.message : String(err), err);
    }
  }

  private async parseDocx(buffer: Buffer): Promise<ParseResult> {
    try {
      const mod = (await import('mammoth')) as unknown as {
        extractRawText: (input: { buffer: Buffer }) => Promise<{
          value: string;
          messages: Array<{ type: string; message: string }>;
        }>;
        default?: {
          extractRawText: (input: { buffer: Buffer }) => Promise<{
            value: string;
            messages: Array<{ type: string; message: string }>;
          }>;
        };
      };
      const extractRawText =
        typeof mod.extractRawText === 'function' ? mod.extractRawText : mod.default?.extractRawText;
      if (!extractRawText) {
        throw new DocumentParseFailedError('mammoth не предоставил extractRawText');
      }
      const result = await extractRawText({ buffer });
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
      throw new DocumentParseFailedError(err instanceof Error ? err.message : String(err), err);
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
      throw new DocumentParseFailedError(err instanceof Error ? err.message : String(err), err);
    }
  }

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
      throw new DocumentParseFailedError(err instanceof Error ? err.message : String(err), err);
    }
  }

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
      throw new DocumentParseFailedError(err instanceof Error ? err.message : String(err), err);
    }
  }

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

type OfficeParserFileType = 'pptx' | 'rtf' | 'odt' | 'csv' | 'html';

interface OfficeParserAstLike {
  toText: () => string;
}

async function runOfficeParser(buffer: Buffer, fileType: OfficeParserFileType): Promise<string> {
  const mod = (await import('officeparser')) as unknown as {
    parseOffice?: (file: Buffer, config?: { fileType?: string }) => Promise<OfficeParserAstLike>;
    default?: {
      parseOffice?: (file: Buffer, config?: { fileType?: string }) => Promise<OfficeParserAstLike>;
    };
  };
  const parseOffice = mod.parseOffice ?? mod.default?.parseOffice;
  if (typeof parseOffice !== 'function') {
    throw new DocumentParseFailedError('officeparser не предоставил parseOffice');
  }
  const ast = await parseOffice(buffer, { fileType });
  return typeof ast?.toText === 'function' ? ast.toText() : '';
}

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

function toBuffer(content: Buffer | string): Buffer {
  if (Buffer.isBuffer(content)) return content;
  return Buffer.from(content, 'utf-8');
}

function toStringUtf8(content: Buffer | string): string {
  if (typeof content === 'string') return content;
  return content.toString('utf-8');
}

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
