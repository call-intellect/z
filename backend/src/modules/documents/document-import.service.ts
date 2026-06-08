import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type DocumentImportSource, type DocumentType, Prisma } from '@prisma/client';
import { unzipSync } from 'fflate';

import { TypedConfigService } from '../../common/config/index';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CoreQueueService } from '../core-queue/core-queue.service';
import { S3Service } from '../recordings/s3.service';

import {
  ConfluenceAuthError,
  ConfluenceClient,
  type ConfluenceFetchArgs,
} from './confluence-client';
import { DocumentsService, formatToken, detectKind } from './documents.service';

/**
 * `DocumentImportService` (ТЗ-4 Ф7 — массовый импорт ZIP-архива).
 *
 * Контракт:
 *   - `createBatch(...)` (вызывается синхронно из контроллера) — валидирует
 *     размер архива (лимит `documents.maxZipSizeMb`), сохраняет ZIP (inline ≤
 *     inlineThreshold, иначе S3), создаёт `DocumentImport(status=pending)` и
 *     возвращает `{ importId }`. Контроллер сам enqueue'ит `core.document-import`.
 *   - `processImport(importId)` (вызывается воркером `DocumentImportWorker`) —
 *     status-guard (pending→processing), распаковывает ZIP через
 *     `fflate.unzipSync`, для каждой ПОДДЕРЖИВАЕМОЙ записи (по расширению из
 *     `documents.acceptedFormats`) зовёт `DocumentsService.createOne` с batch-
 *     атрибуцией + `importBatchId`. Неподдержанные/пустые → `errorLog`,
 *     `failedFiles++`. По завершении — status=completed. Битый архив →
 *     status=failed.
 *
 * Идемпотентность: `processImport` no-op'ит, если status !== 'pending'
 * (повторный job того же `docimport_<id>` после первого прогона).
 */
@Injectable()
export class DocumentImportService {
  private readonly logger = new Logger(DocumentImportService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(ConfluenceClient) private readonly confluence: ConfluenceClient,
    @Inject(CryptoService) private readonly crypto: CryptoService,
  ) {}

  // ─────────────────────────── createBatch ──────────────────────────────────

  /**
   * Создаёт batch-импорт ZIP. Сохраняет архив (inline/S3) и заводит
   * `DocumentImport(status=pending)`. enqueue делает caller (контроллер).
   *
   * Атрибуция (`attachedThemeId`/`attachedProjectId`) проверяется на
   * принадлежность tenantId — зеркалит `DocumentsService.uploadMany`.
   */
  async createBatch(args: {
    tenantId: string;
    createdById: string;
    zip: { buffer: Buffer; size: number };
    /**
     * ТЗ-4 Ф8 — источник ZIP: `upload_zip` (обычный архив) или `notion`
     * (экспорт Notion — те же `.md`/`.csv`, но имена несут tree + 32-hex id,
     * которые чистятся при создании Document'ов). По умолчанию `upload_zip`.
     */
    source?: Extract<DocumentImportSource, 'upload_zip' | 'notion'>;
    attachedThemeId?: string;
    attachedProjectId?: string;
    docType?: DocumentType;
  }): Promise<{ importId: string }> {
    const { tenantId, createdById, zip, attachedThemeId, attachedProjectId, docType } =
      args;
    const source = args.source ?? 'upload_zip';

    if (zip.size === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'file_required', message: 'Архив обязателен' },
      });
    }

    const limits = await this.cfg.documentLimits();
    if (zip.size > limits.maxZipSizeBytes) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'zip_too_large',
          message: `Архив превышает лимит ${limits.maxZipSizeMb} МБ`,
        },
      });
    }

    await this.assertAttributionBelongsToTenant({
      tenantId,
      attachedThemeId,
      attachedProjectId,
    });

    // inline vs S3 — тот же порог, что и у Document.
    const useS3 = zip.size > this.cfg.document.inlineThresholdBytes;
    let zipS3Key: string | null = null;
    if (useS3) {
      zipS3Key = `documents/${tenantId}/imports/${randomUUID()}.zip`;
      await this.s3.putObject({
        key: zipS3Key,
        body: zip.buffer,
        contentType: 'application/zip',
      });
    }
    const zipInline = useS3 ? null : Uint8Array.from(zip.buffer);

    const batch = await this.prisma.documentImport.create({
      data: {
        tenantId,
        source,
        status: 'pending',
        totalFiles: 0,
        createdById,
        attachedThemeId: attachedThemeId ?? null,
        attachedProjectId: attachedProjectId ?? null,
        docType: docType ?? null,
        zipS3Key,
        zipInline,
        zipSize: zip.size,
      },
      select: { id: true },
    });

    this.logger.log(
      { importId: batch.id, tenantId, source, zipSize: zip.size, storage: useS3 ? 's3' : 'inline' },
      'documentImport.createBatch: DocumentImport создан (pending)',
    );
    return { importId: batch.id };
  }

  // ─────────────────────────── createConfluenceImport ───────────────────────

  /**
   * ТЗ-4 Ф9 — заводит `DocumentImport(source=confluence, status=pending)` без
   * ZIP. Атрибуция проверяется на принадлежность tenantId (как у ZIP-batch'а).
   * Сами страницы тянет воркер (`processImport` → confluence-ветка), получая
   * креды из job-payload'а. Токен здесь НЕ персистится — caller (контроллер)
   * шифрует его и кладёт в payload при enqueue.
   */
  async createConfluenceImport(args: {
    tenantId: string;
    createdById: string;
    attachedThemeId?: string;
    attachedProjectId?: string;
    docType?: DocumentType;
  }): Promise<{ importId: string }> {
    const { tenantId, createdById, attachedThemeId, attachedProjectId, docType } = args;

    await this.assertAttributionBelongsToTenant({
      tenantId,
      attachedThemeId,
      attachedProjectId,
    });

    const batch = await this.prisma.documentImport.create({
      data: {
        tenantId,
        source: 'confluence',
        status: 'pending',
        totalFiles: 0,
        createdById,
        attachedThemeId: attachedThemeId ?? null,
        attachedProjectId: attachedProjectId ?? null,
        docType: docType ?? null,
        zipS3Key: null,
        zipInline: null,
        zipSize: 0,
      },
      select: { id: true },
    });

    this.logger.log(
      { importId: batch.id, tenantId, source: 'confluence' },
      'documentImport.createConfluenceImport: DocumentImport создан (pending)',
    );
    return { importId: batch.id };
  }

  // ─────────────────────────── processImport ────────────────────────────────

  /**
   * Точка входа воркера. Идемпотентно по status-guard (pending → processing),
   * затем диспатчит по `batch.source`:
   *   - `upload_zip` / `notion` — распаковка ZIP + per-entry `createOne`
   *     (Notion дополнительно чистит имена страниц).
   *   - `confluence` — тянет страницы пространства через `ConfluenceClient`
   *     (креды + расшифрованный токен передаёт воркер через `confluence`-arg) и
   *     для каждой страницы зовёт `createOne(kind=text)`.
   *
   * `confluence` (опц.) — креды Confluence с УЖЕ расшифрованным `apiToken`.
   * Воркер расшифровывает `encryptedToken` из job-payload и передаёт сюда.
   */
  async processImport(
    importId: string,
    confluence?: ConfluenceFetchArgs,
  ): Promise<void> {
    const batch = await this.prisma.documentImport.findUnique({
      where: { id: importId },
    });
    if (!batch) {
      this.logger.warn({ importId }, 'documentImport.process: батч не найден — skip');
      return;
    }
    // Status-guard: только pending → processing. Повторный job (тот же
    // jobId после первого прогона) увидит processing/completed/failed → no-op.
    const claimed = await this.prisma.documentImport.updateMany({
      where: { id: importId, status: 'pending' },
      data: { status: 'processing' },
    });
    if (claimed.count === 0) {
      this.logger.log(
        { importId, status: batch.status },
        'documentImport.process: уже не pending — идемпотентный skip',
      );
      return;
    }

    if (batch.source === 'confluence') {
      await this.processConfluenceBatch(batch, confluence);
      return;
    }

    await this.processZipBatch(batch);
  }

  // ─────────────────────────── processZipBatch (ZIP / Notion) ───────────────

  /**
   * Распаковывает ZIP и создаёт Document'ы. Для `source=notion` имена записей —
   * это дерево страниц Notion с 32-hex id-суффиксом; чистим их через
   * `cleanNotionName` (id убираем, путь каталога оставляем хлебной крошкой).
   * Status-guard уже сделан в `processImport`.
   */
  private async processZipBatch(batch: DocumentImportRow): Promise<void> {
    const importId = batch.id;
    const isNotion = batch.source === 'notion';
    const { tenantId, createdById } = batch;

    // 1. Достаём байты архива (inline или S3).
    let zipBuffer: Buffer;
    try {
      zipBuffer = await this.loadZipBytes(batch);
    } catch (err) {
      await this.markFailed(importId, [
        { file: '(архив)', error: err instanceof Error ? err.message : String(err) },
      ]);
      return;
    }

    // 2. Распаковываем. Битый архив — фатальный фейл всего батча.
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(Uint8Array.from(zipBuffer));
    } catch (err) {
      await this.markFailed(importId, [
        {
          file: '(архив)',
          error: `Не удалось распаковать архив: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
      return;
    }

    const limits = await this.cfg.documentLimits();
    const accepted = new Set(limits.acceptedFormats.map((f) => f.toLowerCase()));

    // 3. Фильтруем записи: только файлы (не каталоги), пропускаем служебные
    //    пути ZIP (__MACOSX, .DS_Store, скрытые).
    const fileNames = Object.keys(entries).filter((name) => {
      if (name.endsWith('/')) return false; // каталог
      const base = baseName(name);
      if (base.length === 0) return false;
      if (name.startsWith('__MACOSX/')) return false;
      if (base === '.DS_Store') return false;
      return true;
    });

    const errorLog: Array<{ file: string; error: string }> = [];
    let doneFiles = 0;
    let failedFiles = 0;

    for (const name of fileNames) {
      const bytes = entries[name];
      const base = baseName(name);
      try {
        if (!bytes || bytes.byteLength === 0) {
          errorLog.push({ file: name, error: 'Пустой файл' });
          failedFiles += 1;
          continue;
        }
        if (bytes.byteLength > limits.maxSizeBytes) {
          errorLog.push({
            file: name,
            error: `Файл превышает лимит ${limits.maxSizeMb} МБ`,
          });
          failedFiles += 1;
          continue;
        }
        const kind = detectKind('application/octet-stream', base);
        const ext = formatToken(kind, base);
        if (!accepted.has(ext)) {
          errorLog.push({ file: name, error: `Формат «${ext}» не поддерживается` });
          failedFiles += 1;
          continue;
        }

        const buffer = Buffer.from(bytes);
        // Notion-экспорт: имя записи несёт дерево страниц + 32-hex id-суффикс
        // (`Folder/Page Title abc123…0123456789.md`). Чистим в человекочитаемое
        // имя с хлебной крошкой каталога; формат (kind/ext) уже выведен из base.
        const originalName = isNotion ? cleanNotionName(name) : base;
        await this.documents.createOne({
          tenantId,
          uploaderPersonId: createdById,
          file: {
            buffer,
            originalName,
            mimeType: 'application/octet-stream',
            size: buffer.length,
          },
          kind,
          attachedThemeId: batch.attachedThemeId ?? undefined,
          attachedProjectId: batch.attachedProjectId ?? undefined,
          docType: batch.docType ?? undefined,
          importBatchId: importId,
        });
        doneFiles += 1;
      } catch (err) {
        errorLog.push({
          file: name,
          error: err instanceof Error ? err.message : String(err),
        });
        failedFiles += 1;
      }
    }

    const totalFiles = doneFiles + failedFiles;
    await this.prisma.documentImport.update({
      where: { id: importId },
      data: {
        status: 'completed',
        totalFiles,
        doneFiles,
        failedFiles,
        errorLog: errorLog.length > 0 ? (errorLog as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    this.logger.log(
      { importId, tenantId, totalFiles, doneFiles, failedFiles },
      'documentImport.process: завершён',
    );
  }

  // ─────────────────────────── processConfluenceBatch (Ф9) ──────────────────

  /**
   * Тянет все страницы пространства Confluence через `ConfluenceClient` и для
   * каждой создаёт `Document(kind=text)` с batch-атрибуцией + `importBatchId`.
   * Status-guard уже сделан в `processImport`.
   *
   * `creds` — креды Confluence с УЖЕ расшифрованным `apiToken` (воркер
   * расшифровал `encryptedToken` из job-payload). Если creds нет — это баг
   * вызова (ZIP-путь не должен попадать сюда): помечаем импорт failed.
   *
   * Неверный токен/пространство (`ConfluenceAuthError`) → импорт `failed` с
   * machine-кодом `confluence_auth_failed` в `errorLog` (не «тихий краш»).
   */
  private async processConfluenceBatch(
    batch: DocumentImportRow,
    creds?: ConfluenceFetchArgs,
  ): Promise<void> {
    const importId = batch.id;
    const { tenantId, createdById } = batch;

    if (!creds) {
      await this.markFailed(importId, [
        {
          file: '(confluence)',
          error:
            'Внутренняя ошибка: не переданы параметры подключения к Confluence',
        },
      ]);
      return;
    }

    // 1. Тянем страницы. Auth/доступ — отдельный machine-код.
    let pages: Array<{ title: string; text: string }>;
    try {
      pages = await this.confluence.fetchSpacePages(creds);
    } catch (err) {
      if (err instanceof ConfluenceAuthError) {
        await this.markFailed(importId, [
          { file: '(confluence)', error: `confluence_auth_failed: ${err.message}` },
        ]);
        return;
      }
      await this.markFailed(importId, [
        {
          file: '(confluence)',
          error: `Не удалось получить страницы Confluence: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
      return;
    }

    const limits = await this.cfg.documentLimits();
    const errorLog: Array<{ file: string; error: string }> = [];
    let doneFiles = 0;
    let failedFiles = 0;

    // 2. Per-page → Document(kind=text). Имя = заголовок страницы.
    for (const page of pages) {
      const fileLabel = page.title || 'Без названия';
      try {
        const text = page.text ?? '';
        if (text.trim().length === 0) {
          errorLog.push({ file: fileLabel, error: 'Пустая страница' });
          failedFiles += 1;
          continue;
        }
        const buffer = Buffer.from(text, 'utf8');
        if (buffer.byteLength > limits.maxSizeBytes) {
          errorLog.push({
            file: fileLabel,
            error: `Страница превышает лимит ${limits.maxSizeMb} МБ`,
          });
          failedFiles += 1;
          continue;
        }
        await this.documents.createOne({
          tenantId,
          uploaderPersonId: createdById,
          file: {
            buffer,
            originalName: `${fileLabel}.txt`,
            mimeType: 'text/plain',
            size: buffer.length,
          },
          kind: 'text',
          attachedThemeId: batch.attachedThemeId ?? undefined,
          attachedProjectId: batch.attachedProjectId ?? undefined,
          docType: batch.docType ?? undefined,
          importBatchId: importId,
        });
        doneFiles += 1;
      } catch (err) {
        errorLog.push({
          file: fileLabel,
          error: err instanceof Error ? err.message : String(err),
        });
        failedFiles += 1;
      }
    }

    const totalFiles = doneFiles + failedFiles;
    await this.prisma.documentImport.update({
      where: { id: importId },
      data: {
        status: 'completed',
        totalFiles,
        doneFiles,
        failedFiles,
        errorLog:
          errorLog.length > 0
            ? (errorLog as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });

    this.logger.log(
      { importId, tenantId, source: 'confluence', totalFiles, doneFiles, failedFiles },
      'documentImport.process: confluence завершён',
    );
  }

  // ─────────────────────────── helpers ──────────────────────────────────────

  private async loadZipBytes(batch: {
    zipInline: Uint8Array | null;
    zipS3Key: string | null;
  }): Promise<Buffer> {
    if (batch.zipInline) {
      return Buffer.from(batch.zipInline);
    }
    if (batch.zipS3Key) {
      return this.s3.getObject(batch.zipS3Key);
    }
    throw new Error('DocumentImport не содержит ни zipInline, ни zipS3Key');
  }

  private async markFailed(
    importId: string,
    errorLog: Array<{ file: string; error: string }>,
  ): Promise<void> {
    await this.prisma.documentImport.update({
      where: { id: importId },
      data: {
        status: 'failed',
        errorLog: errorLog as unknown as Prisma.InputJsonValue,
      },
    });
    this.logger.warn({ importId, errorLog }, 'documentImport.process: фатальный фейл');
  }

  private async assertAttributionBelongsToTenant(args: {
    tenantId: string;
    attachedThemeId?: string;
    attachedProjectId?: string;
  }): Promise<void> {
    const { tenantId, attachedThemeId, attachedProjectId } = args;
    if (attachedThemeId) {
      const theme = await this.prisma.theme.findUnique({
        where: { id: attachedThemeId },
        select: { tenantId: true },
      });
      if (!theme || theme.tenantId !== tenantId) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'theme_not_found', message: 'Тема не найдена' },
        });
      }
    }
    if (attachedProjectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: attachedProjectId },
        select: { tenantId: true },
      });
      if (!project || project.tenantId !== tenantId) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'project_not_found', message: 'Проект не найден' },
        });
      }
    }
  }

  // ─────────────────────────── crypto (Ф9 token) ────────────────────────────

  /**
   * Шифрует API-токен Confluence для безопасного транзита в BullMQ-payload'е
   * (Redis). Контроллер вызывает перед enqueue; токен НЕ хранится в БД.
   */
  encryptConfluenceToken(apiToken: string): string {
    return this.crypto.encrypt(apiToken);
  }

  /**
   * Расшифровывает токен из job-payload'а. Вызывает воркер непосредственно перед
   * `processImport` (токен в открытом виде живёт только в памяти воркера).
   */
  decryptConfluenceToken(encryptedToken: string): string {
    return this.crypto.decrypt(encryptedToken);
  }
}

/**
 * Узкий тип строки `DocumentImport`, нужный методам обработки. Берём только
 * поля, которые читают `processZipBatch` / `processConfluenceBatch` — это
 * совместимо с `prisma.documentImport.findUnique(...)` без жёсткой зависимости
 * от генерируемого `DocumentImport` (упрощает мок в тестах).
 */
interface DocumentImportRow {
  id: string;
  tenantId: string;
  createdById: string;
  source: DocumentImportSource;
  status: string;
  attachedThemeId: string | null;
  attachedProjectId: string | null;
  docType: DocumentType | null;
  zipInline: Uint8Array | null;
  zipS3Key: string | null;
}

/**
 * Базовое имя файла из ZIP-пути (`docs/sub/file.pdf` → `file.pdf`). ZIP всегда
 * использует прямой слэш как разделитель (PKZIP spec), но на всякий случай
 * нормализуем и обратный.
 */
function baseName(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const parts = norm.split('/');
  return parts[parts.length - 1] ?? '';
}

/**
 * ТЗ-4 Ф8 — чистка имени записи Notion-экспорта в человекочитаемое имя
 * документа. Notion кодирует дерево страниц в путь, а к каждому сегменту
 * добавляет 32-символьный hex-id страницы:
 *
 *   `Команда abc.../Регламент онбординга 0123456789abcdef0123456789abcdef.md`
 *     → `Команда / Регламент онбординга`
 *
 * Алгоритм:
 *   1. Нормализуем разделитель, режем на сегменты.
 *   2. Из КАЖДОГО сегмента убираем хвостовой ` <32-hex>` (и расширение у
 *      последнего сегмента — это имя файла).
 *   3. Склеиваем сегменты через ` / ` как хлебную крошку (контекст дерева).
 *   4. Пустой результат → fallback на исходный base.
 */
function cleanNotionName(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const segments = norm.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return baseName(path);

  const cleaned = segments.map((seg, idx) => {
    let s = seg;
    // У последнего сегмента (файл) снимаем расширение.
    if (idx === segments.length - 1) {
      s = s.replace(/\.[A-Za-z0-9]+$/, '');
    }
    // Снимаем хвостовой 32-hex id Notion (с пробелом-разделителем или без).
    s = s.replace(/[ _-]?[0-9a-f]{32}$/i, '');
    return s.trim();
  });

  const result = cleaned.filter((s) => s.length > 0).join(' / ');
  return result.length > 0 ? result : baseName(path);
}
