import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Export, ExportType } from '@prisma/client';
import { Queue } from 'bullmq';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT } from '../audit/audit.types';
import { S3Service } from '../recordings/s3.service';

import type { BulkExportDto } from './dto/export.dto';
import { ExportsRepository } from './exports.repository';
import {
  EXPORT_QUEUE,
  EXPORT_JOB_OPTIONS,
  type ExportJobData,
} from './exports-queue';

/**
 * Бизнес-сервис экспортов. Постановка job в очередь, выдача presigned URL,
 * валидация лимитов и идемпотентности.
 */
@Injectable()
export class ExportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExportsService.name);
  private queue: Queue<ExportJobData> | null = null;

  constructor(
    @Inject(ExportsRepository) private readonly repo: ExportsRepository,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  onModuleInit(): void {
    this.queue = new Queue<ExportJobData>(EXPORT_QUEUE, {
      connection: this.redis.client,
      defaultJobOptions: EXPORT_JOB_OPTIONS,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
  }

  list(userId: string): Promise<Export[]> {
    return this.repo.listByUser(userId);
  }

  async createMeetingExport(
    userId: string,
    meetingId: string,
    type: 'meeting_md' | 'meeting_docx' | 'meeting_pdf',
  ): Promise<{ exportId: string }> {
    if (type === 'meeting_pdf') {
      throw new HttpException(
        {
          ok: false,
          error: { code: 'pdf_not_implemented', message: 'PDF-экспорт пока не реализован' },
        },
        HttpStatus.NOT_IMPLEMENTED,
      );
    }
    await this.assertMeetingOwner(meetingId, userId);
    // Идемпотентность: если уже queued/processing — возвращаем тот же id.
    const inProgress = await this.repo.findInProgress({
      userId,
      type,
      meetingIds: [meetingId],
    });
    if (inProgress) {
      return { exportId: inProgress.id };
    }
    const created = await this.repo.create({
      userId,
      type,
      meetingIds: [meetingId],
      options: {},
    });
    await this.enqueue(created.id);
    await this.audit.log({
      userId,
      action: AUDIT.EXPORT_CREATE,
      resourceId: created.id,
      metadata: { type, meetingId },
    });
    return { exportId: created.id };
  }

  async createBulkExport(
    userId: string,
    dto: BulkExportDto,
  ): Promise<{ exportId: string }> {
    const limitMeetings = this.cfg.workspace.exportZipMaxMeetings;
    if (dto.meetingIds.length > limitMeetings) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'too_many_meetings',
          message: `Максимум ${limitMeetings} встреч за один экспорт`,
        },
      });
    }
    // Daily quota.
    const usedToday = await this.repo.countCompletedToday(userId, 'bulk_zip');
    const maxPerDay = this.cfg.workspace.maxBulkExportsPerDay;
    if (usedToday >= maxPerDay) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'quota_exceeded',
            message: `Превышен лимит bulk экспортов в сутки (${maxPerDay})`,
            quotaName: 'bulk_exports_per_day',
            max: maxPerDay,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // Все meetingIds должны принадлежать юзеру.
    const owned = await this.prisma.meeting.count({
      where: {
        id: { in: dto.meetingIds },
        ownerId: userId,
        deletedAt: null,
      },
    });
    if (owned !== dto.meetingIds.length) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'meetings_not_owned',
          message: 'Не все meetingIds принадлежат вам или часть удалена',
        },
      });
    }
    // Идемпотентность.
    const inProgress = await this.repo.findInProgress({
      userId,
      type: 'bulk_zip',
      meetingIds: dto.meetingIds,
    });
    if (inProgress) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'export_in_progress',
          message: 'Точно такой же bulk экспорт уже в очереди',
          exportId: inProgress.id,
        },
      });
    }
    const created = await this.repo.create({
      userId,
      type: 'bulk_zip',
      meetingIds: dto.meetingIds,
      options: dto.options,
    });
    await this.enqueue(created.id);
    await this.audit.log({
      userId,
      action: AUDIT.EXPORT_CREATE,
      resourceId: created.id,
      metadata: { type: 'bulk_zip', count: dto.meetingIds.length },
    });
    return { exportId: created.id };
  }

  async getDownloadUrl(
    id: string,
    userId: string,
  ): Promise<{
    url?: string;
    expiresAt?: string;
    status: Export['status'];
    error?: string | null;
  }> {
    const exp = await this.repo.findById(id);
    if (!exp || exp.userId !== userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'export_not_found', message: 'Export не найден' },
      });
    }
    if (exp.status === 'queued' || exp.status === 'processing') {
      // 425 Too Early — Nest 10 не имеет константы, используем код напрямую.
      throw new HttpException(
        {
          ok: false,
          error: { code: 'export_not_ready', message: 'Export ещё в обработке', status: exp.status },
        },
        425,
      );
    }
    if (exp.status === 'failed') {
      throw new HttpException(
        {
          ok: false,
          error: { code: 'export_failed', message: 'Export упал', detail: exp.error },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    if (exp.status === 'expired' || !exp.s3Key) {
      throw new HttpException(
        {
          ok: false,
          error: { code: 'export_expired', message: 'Export истёк' },
        },
        HttpStatus.GONE,
      );
    }
    const presigned = await this.s3.presignGet(exp.s3Key);
    return {
      url: presigned.url,
      expiresAt: presigned.expiresAt.toISOString(),
      status: exp.status,
    };
  }

  async delete(id: string, userId: string): Promise<void> {
    const exp = await this.repo.findById(id);
    if (!exp || exp.userId !== userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'export_not_found', message: 'Export не найден' },
      });
    }
    if (exp.s3Key) {
      await this.s3.delete([exp.s3Key]).catch((err) => {
        this.logger.warn(
          `s3.delete failed для export=${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    await this.repo.delete(id);
    await this.audit.log({
      userId,
      action: AUDIT.EXPORT_DELETE,
      resourceId: id,
    });
  }

  // ─────────────────────────── helpers ──────────────────────────────────

  private async enqueue(exportId: string): Promise<void> {
    if (!this.queue) {
      throw new NotImplementedException('Export queue не инициализирован');
    }
    await this.queue.add(
      'export',
      { exportId },
      { jobId: `export:${exportId}` },
    );
  }

  private async assertMeetingOwner(meetingId: string, userId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { ownerId: true, deletedAt: true },
    });
    if (!meeting || meeting.deletedAt !== null || meeting.ownerId !== userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'meeting_not_found', message: 'Встреча не найдена' },
      });
    }
  }
}
