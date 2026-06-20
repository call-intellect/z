import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { S3Service } from '../../recordings/s3.service';

const DEFAULT_RETENTION_DAYS = 90;
const BATCH_SIZE = 100;

@Injectable()
export class VoiceNoteAudioRetentionCron {
  private readonly logger = new Logger(VoiceNoteAudioRetentionCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('30 4 * * *')
  async run(): Promise<{ deleted: number }> {
    try {
      return await this.sweep();
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'voice-note-audio-retention.cron: непойманная ошибка',
      );
      return { deleted: 0 };
    }
  }

  async sweep(): Promise<{ deleted: number }> {
    const retentionDays =
      (await this.cfg.getDynamic<number>(
        'provenance.voiceNoteAudioRetentionDays',
        undefined,
        DEFAULT_RETENTION_DAYS,
      )) ?? DEFAULT_RETENTION_DAYS;

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const candidates = await this.prisma.rawEvent.findMany({
      where: {
        sourceType: 'conversational',
        occurredAt: { lt: cutoff },
        payload: { path: ['metadata', 'audioS3Key'], not: Prisma.DbNull },
      },
      select: { id: true, payload: true },
      take: BATCH_SIZE,
    });

    let deleted = 0;
    for (const event of candidates) {
      const audioS3Key = this.extractAudioS3Key(event.payload);
      if (!audioS3Key) continue;
      try {
        await this.s3.delete([audioS3Key]);
        await this.prisma.rawEvent.update({
          where: { id: event.id },
          data: { payload: this.clearAudioS3Key(event.payload) },
        });
        deleted += 1;
      } catch (err) {
        this.logger.warn(
          {
            rawEventId: event.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'voice-note-audio-retention.cron: удаление аудио не удалось — пропускаю',
        );
      }
    }

    if (deleted > 0) {
      this.logger.log(
        { deleted, retentionDays },
        'voice-note-audio-retention.cron: оригиналы аудио вычищены',
      );
    }
    return { deleted };
  }

  private extractAudioS3Key(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const metadata = (payload as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== 'object') return null;
    const key = (metadata as { audioS3Key?: unknown }).audioS3Key;
    return typeof key === 'string' && key.length > 0 ? key : null;
  }

  private clearAudioS3Key(payload: unknown): Prisma.InputJsonValue {
    const base =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : {};
    const metadata =
      base.metadata && typeof base.metadata === 'object'
        ? (base.metadata as Record<string, unknown>)
        : {};
    const nextMetadata = { ...metadata, audioS3Key: null };
    return { ...base, metadata: nextMetadata } as Prisma.InputJsonValue;
  }
}
