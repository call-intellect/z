import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type DocumentType, Prisma } from '@prisma/client';
import { unzipSync } from 'fflate';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CoreQueueService } from '../core-queue/core-queue.service';
import { S3Service } from '../recordings/s3.service';

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
    attachedThemeId?: string;
    attachedProjectId?: string;
    docType?: DocumentType;
  }): Promise<{ importId: string }> {
    const { tenantId, createdById, zip, attachedThemeId, attachedProjectId, docType } =
      args;

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
        source: 'upload_zip',
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
      { importId: batch.id, tenantId, zipSize: zip.size, storage: useS3 ? 's3' : 'inline' },
      'documentImport.createBatch: DocumentImport создан (pending)',
    );
    return { importId: batch.id };
  }

  // ─────────────────────────── processImport ────────────────────────────────

  /**
   * Распаковывает ZIP и создаёт Document'ы. Идемпотентно по status-guard.
   */
  async processImport(importId: string): Promise<void> {
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
        await this.documents.createOne({
          tenantId,
          uploaderPersonId: createdById,
          file: {
            buffer,
            originalName: base,
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
