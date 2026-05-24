import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { nanoid } from 'nanoid';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { S3Service } from '../../recordings/s3.service';

import { ActivityRecorderService } from './activity-recorder.service';
import { IssuesService } from './issues.service';

/**
 * Тип файла, который multer кладёт в req. Объявлен локально (а не через
 * `Express.Multer.File`), чтобы DTO-сервис не тянул `@types/express` в
 * compile-time, если кто-то расщепит модуль. Идентично `documents.controller`.
 */
export interface UploadedAttachmentInput {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

/**
 * Лимит размера одного файла приложения к задаче — 25 MB. Sharp / video не
 * обрабатываем; крупные видео идут в `documents` или Recording (это другой flow).
 */
const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * Допустимые MIME-типы — общий «офисный» набор + изображения. Запрещаем
 * исполняемые. Для расширения списка — добавить enum здесь (без миграций).
 */
const ALLOWED_MIME_PREFIXES = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/zip',
  'text/',
  'audio/',
  'video/',
];

export interface AttachmentResponseDto {
  id: string;
  issueId: string;
  commentId: string | null;
  uploaderId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

/**
 * AttachmentsService — загрузка/чтение/удаление приложений к задачам.
 *
 *   - `upload`         — multipart → S3 + IssueAttachment.
 *   - `getPresigned`   — короткоживущий signed URL для скачивания.
 *   - `delete`         — удаляет запись + объект в S3.
 *
 * S3-ключ: `issues/{issueId}/attachments/{nanoid}-{safeFilename}`. nanoid в
 * префиксе — анти-коллизия одинаковых имён. Имя файла санитизируется: оставляем
 * только `[A-Za-z0-9._-]`, остальное → `_`, чтобы не ломать ни URL ни S3.
 *
 * Thumbnail — НЕ генерируем (sharp в проекте не установлен). Если потребуется —
 * подключить позже отдельным воркером `attachment-thumbnail` (BullMQ).
 */
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
  ) {}

  /**
   * Загрузить файл к задаче. Сначала кладём в S3, потом — запись в БД
   * (если БД упадёт — в S3 останется orphan-объект, на retention-cron'е
   * выметается; это лучше, чем INSERT успешен, а Body не сохранён).
   */
  async upload(args: {
    tenantId: string;
    issueId: string;
    userId: string;
    file: UploadedAttachmentInput;
    commentId?: string | null;
  }): Promise<AttachmentResponseDto> {
    const { tenantId, issueId, userId, file, commentId } = args;
    this.validateFile(file);
    await this.issues.requireIssue(issueId, tenantId);

    if (commentId) {
      const comment = await this.prisma.issueComment.findFirst({
        where: { id: commentId, issueId },
        select: { id: true },
      });
      if (!comment) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'invalid_comment_id',
            message: 'Комментарий не найден на этой задаче',
          },
        });
      }
    }

    const safeName = this.sanitizeFileName(file.originalName);
    const objectKey = `issues/${issueId}/attachments/${nanoid()}-${safeName}`;

    // 1. S3 PUT — даже если потом INSERT упадёт, orphan не критичен.
    await this.s3.putObject({
      key: objectKey,
      body: file.buffer,
      contentType: file.mimeType,
    });

    // 2. INSERT в БД. fileUrl храним как s3 key (без host) — presigned URL
    //    выдаём через `getPresigned()`. На случай миграции bucket'а это
    //    минимизирует переписывание данных.
    const created = await this.prisma.issueAttachment.create({
      data: {
        issueId,
        commentId: commentId ?? null,
        uploaderId: userId,
        fileName: file.originalName,
        fileUrl: objectKey,
        fileSize: file.size,
        mimeType: file.mimeType,
      },
    });

    // 3. IssueActivity verb='attached'.
    await this.activity.record({
      tenantId,
      issueId,
      actorUserId: userId,
      actorType: 'user',
      verb: 'attached',
      newValue: {
        attachmentId: created.id,
        fileName: file.originalName,
        fileSize: file.size,
      },
    });

    return this.toResponseDto(created);
  }

  /**
   * Получить presigned URL для скачивания. TTL — по `cfg.s3.presignedTtlSeconds`.
   * Возвращает сам объект + URL (а не редирект): фронт сам решит, как открывать.
   */
  async getPresigned(
    attachmentId: string,
    tenantId: string,
  ): Promise<AttachmentResponseDto & { downloadUrl: string; expiresAt: string }> {
    const att = await this.requireAttachment(attachmentId, tenantId);
    const { url, expiresAt } = await this.s3.presignGet(att.fileUrl);
    return {
      ...this.toResponseDto(att),
      downloadUrl: url,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Удалить приложение: запись из БД + объект из S3 (best-effort).
   * IssueActivity verb='detached'.
   */
  async delete(
    attachmentId: string,
    tenantId: string,
    userId: string,
  ): Promise<{ ok: true }> {
    const att = await this.requireAttachment(attachmentId, tenantId);
    await this.prisma.issueAttachment.delete({ where: { id: att.id } });

    try {
      await this.s3.delete([att.fileUrl]);
    } catch (err) {
      // Не валим запрос — БД-запись уже удалена. Retention-cron подберёт.
      this.logger.warn(
        `S3 delete для ${att.fileUrl} не удался: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    await this.activity.record({
      tenantId,
      issueId: att.issueId,
      actorUserId: userId,
      actorType: 'user',
      verb: 'detached',
      oldValue: {
        attachmentId: att.id,
        fileName: att.fileName,
      },
    });

    return { ok: true };
  }

  /** Найти приложение + проверить tenant через issue. */
  private async requireAttachment(
    attachmentId: string,
    tenantId: string,
  ): Promise<{
    id: string;
    issueId: string;
    commentId: string | null;
    uploaderId: string;
    fileName: string;
    fileUrl: string;
    fileSize: number;
    mimeType: string;
    thumbnailUrl: string | null;
    createdAt: Date;
  }> {
    const att = await this.prisma.issueAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!att) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'attachment_not_found',
          message: 'Приложение не найдено',
        },
      });
    }
    // Проверка tenant — через issue ownership.
    await this.issues.requireIssue(att.issueId, tenantId);
    return att;
  }

  private validateFile(file: UploadedAttachmentInput): void {
    if (!file.buffer || file.size === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'empty_file', message: 'Файл пустой' },
      });
    }
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'file_too_large',
          message: `Размер файла превышает ${MAX_ATTACHMENT_SIZE_BYTES} байт`,
        },
      });
    }
    const mime = (file.mimeType ?? '').toLowerCase();
    const allowed = ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
    if (!allowed) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'mime_type_not_allowed',
          message: `MIME-тип "${file.mimeType}" не разрешён`,
        },
      });
    }
  }

  private sanitizeFileName(name: string): string {
    const trimmed = name.trim().replace(/\s+/g, '_');
    const safe = trimmed.replace(/[^A-Za-z0-9._-]/g, '_');
    // Защита от слишком длинных имён (S3 key limit 1024, но S3 префикс уже занят).
    return safe.length > 200 ? safe.slice(safe.length - 200) : safe;
  }

  private toResponseDto(att: {
    id: string;
    issueId: string;
    commentId: string | null;
    uploaderId: string;
    fileName: string;
    fileUrl: string;
    fileSize: number;
    mimeType: string;
    thumbnailUrl: string | null;
    createdAt: Date;
  }): AttachmentResponseDto {
    return {
      id: att.id,
      issueId: att.issueId,
      commentId: att.commentId,
      uploaderId: att.uploaderId,
      fileName: att.fileName,
      fileUrl: att.fileUrl,
      fileSize: att.fileSize,
      mimeType: att.mimeType,
      thumbnailUrl: att.thumbnailUrl,
      createdAt: att.createdAt.toISOString(),
    };
  }
}
