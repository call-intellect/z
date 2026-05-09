import { Inject, Injectable, Logger } from '@nestjs/common';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TypedConfigService } from '../../common/config/index';
import { S3Service } from '../recordings/s3.service';
import { extractKeyFromUrl } from '../recordings/s3-keys';

/**
 * Сервис retention: удаление просроченных записей.
 *
 * Алгоритм:
 *   1. Найти все Recording, у которых `expiresAt < NOW` и status НЕ
 *      `deleted` / `archived`.
 *   2. Для каждого собрать ключи (composite + per-track audio).
 *   3. `S3Service.delete([keys])` — multi-object delete.
 *   4. Recording.status = 'deleted', deletedAt = now, RecordingAction.
 *   5. Прометей-счётчик `recordings_deleted_total{reason='tariff_expired'}`.
 *
 * Запускается из `RetentionCron` (раз в `cfg.retention.cron`, по умолчанию
 * раз в час) либо вручную из админки (V2).
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  /** Сколько записей за один проход — чтобы не «съесть» БД на больших объёмах. */
  private static readonly BATCH_SIZE = 100;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async processExpired(): Promise<{ processed: number; failed: number }> {
    const now = new Date();
    const candidates = await this.prisma.recording.findMany({
      where: {
        expiresAt: { lt: now },
        status: { notIn: ['deleted', 'archived'] },
      },
      include: { audioTracks: true },
      take: RetentionService.BATCH_SIZE,
    });

    if (candidates.length === 0) {
      return { processed: 0, failed: 0 };
    }

    this.logger.log({ count: candidates.length }, 'Retention sweep: найдены просроченные записи');

    let processed = 0;
    let failed = 0;

    for (const recording of candidates) {
      try {
        await this.deleteOne(recording);
        processed += 1;
      } catch (err) {
        failed += 1;
        this.logger.error(
          {
            recordingId: recording.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'Retention sweep: ошибка удаления записи',
        );
      }
    }

    this.logger.log({ processed, failed }, 'Retention sweep: завершён');
    return { processed, failed };
  }

  private async deleteOne(recording: {
    id: string;
    mainVideoUrl: string | null;
    audioTracks: Array<{ audioUrl: string }>;
  }): Promise<void> {
    const keys: string[] = [];
    if (recording.mainVideoUrl) {
      const k = extractKeyFromUrl(recording.mainVideoUrl, this.cfg.s3.bucket);
      if (k) keys.push(k);
    }
    for (const t of recording.audioTracks) {
      if (!t.audioUrl) continue;
      const k = extractKeyFromUrl(t.audioUrl, this.cfg.s3.bucket);
      if (k) keys.push(k);
    }

    if (keys.length > 0) {
      await this.s3.delete(keys);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.recording.update({
        where: { id: recording.id },
        data: { status: 'deleted', deletedAt: new Date() },
      });
      await tx.recordingAction.create({
        data: {
          recordingId: recording.id,
          action: 'deleted',
          actor: 'cron',
          reason: 'tariff_expired',
        },
      });
    });

    this.metrics.incRecordingsDeleted({ reason: 'tariff_expired' });
  }
}
