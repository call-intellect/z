import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

  async createBatch(args: {
    tenantId: string;
    createdById: string;
    zip: { buffer: Buffer; size: number };
    source?: Extract<DocumentImportSource, 'upload_zip' | 'notion'>;
    attachedThemeId?: string;
    attachedProjectId?: string;
    docType?: DocumentType;
  }): Promise<{ importId: string }> {
    const { tenantId, createdById, zip, attachedThemeId, attachedProjectId, docType } = args;
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

  async processImport(importId: string, confluence?: ConfluenceFetchArgs): Promise<void> {
    const batch = await this.prisma.documentImport.findUnique({
      where: { id: importId },
    });
    if (!batch) {
      this.logger.warn({ importId }, 'documentImport.process: батч не найден — skip');
      return;
    }
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

  private async processZipBatch(batch: DocumentImportRow): Promise<void> {
    const importId = batch.id;
    const isNotion = batch.source === 'notion';
    const { tenantId, createdById } = batch;

    let zipBuffer: Buffer;
    try {
      zipBuffer = await this.loadZipBytes(batch);
    } catch (err) {
      await this.markFailed(importId, [
        { file: '(архив)', error: err instanceof Error ? err.message : String(err) },
      ]);
      return;
    }

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

    const fileNames = Object.keys(entries).filter((name) => {
      if (name.endsWith('/')) return false;
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
        errorLog:
          errorLog.length > 0 ? (errorLog as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    this.logger.log(
      { importId, tenantId, totalFiles, doneFiles, failedFiles },
      'documentImport.process: завершён',
    );
  }

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
          error: 'Внутренняя ошибка: не переданы параметры подключения к Confluence',
        },
      ]);
      return;
    }

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
          errorLog.length > 0 ? (errorLog as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    this.logger.log(
      { importId, tenantId, source: 'confluence', totalFiles, doneFiles, failedFiles },
      'documentImport.process: confluence завершён',
    );
  }

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

  encryptConfluenceToken(apiToken: string): string {
    return this.crypto.encrypt(apiToken);
  }

  decryptConfluenceToken(encryptedToken: string): string {
    return this.crypto.decrypt(encryptedToken);
  }
}

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

function baseName(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const parts = norm.split('/');
  return parts[parts.length - 1] ?? '';
}

function cleanNotionName(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const segments = norm.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return baseName(path);

  const cleaned = segments.map((seg, idx) => {
    let s = seg;
    if (idx === segments.length - 1) {
      s = s.replace(/\.[A-Za-z0-9]+$/, '');
    }
    s = s.replace(/[ _-]?[0-9a-f]{32}$/i, '');
    return s.trim();
  });

  const result = cleaned.filter((s) => s.length > 0).join(' / ');
  return result.length > 0 ? result : baseName(path);
}
