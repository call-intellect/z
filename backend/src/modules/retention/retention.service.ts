import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RawEvent } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT } from '../audit/audit.types';
import { extractKeyFromUrl } from '../recordings/s3-keys';
import { S3Service } from '../recordings/s3.service';

import { RetentionPolicyService } from './retention-policy.service';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  private static readonly BATCH_SIZE = 100;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(RetentionPolicyService)
    private readonly policySvc: RetentionPolicyService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
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
    this.metrics.incCoreRetentionDeleted({ kind: 'recording' });
  }

  async processAll(): Promise<{
    recordings: { processed: number; failed: number };
    rawEvents: { processed: number; failed: number };
    blocks: { processed: number; failed: number };
    chat: { processed: number; failed: number };
    audit: { processed: number; failed: number };
  }> {
    const recordings = await this.processExpired();

    const rawEvents = this.cfg.retention.rawEventsEnabled
      ? await this.processExpiredRawEvents()
      : { processed: 0, failed: 0 };
    const blocks = this.cfg.retention.blocksEnabled
      ? await this.processExpiredArchivedBlocks()
      : { processed: 0, failed: 0 };
    const chat = this.cfg.retention.chatEnabled
      ? await this.processExpiredChatMessages()
      : { processed: 0, failed: 0 };
    const audit = this.cfg.retention.auditEnabled
      ? await this.processExpiredAuditLogs()
      : { processed: 0, failed: 0 };

    await this.markAllSwept();

    return { recordings, rawEvents, blocks, chat, audit };
  }

  private async processExpiredRawEvents(): Promise<{ processed: number; failed: number }> {
    const policies = await this.prisma.orgRetentionPolicy.findMany();
    const batch = this.cfg.retention.sweepBatchSize;
    let processed = 0;
    let failed = 0;

    for (const policy of policies) {
      const cutoff = this.daysAgo(policy.rawEventDays);
      try {
        const candidates = await this.prisma.rawEvent.findMany({
          where: { tenantId: policy.tenantId, receivedAt: { lt: cutoff } },
          select: {
            id: true,
            tenantId: true,
            payloadStorage: true,
            payloadS3Key: true,
          },
          take: batch,
        });
        if (candidates.length === 0) continue;

        const { processedHere, failedHere, affectedBlockTenantIds } =
          await this.deleteRawEventBatch(candidates);
        processed += processedHere;
        failed += failedHere;

        if (policy.archivedBlockAction === 'archive_then_delete') {
          await this.autoArchiveOrphanBlocks(policy.tenantId);
        }
        for (const tid of affectedBlockTenantIds) {
          if (tid !== policy.tenantId) {
            await this.autoArchiveOrphanBlocks(tid);
          }
        }
      } catch (err) {
        failed += 1;
        this.logger.error(
          {
            tenantId: policy.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'processExpiredRawEvents: ошибка по Org',
        );
      }
    }

    if (processed > 0 || failed > 0) {
      this.logger.log({ processed, failed }, 'processExpiredRawEvents: завершён');
    }
    return { processed, failed };
  }

  private async deleteRawEventBatch(
    candidates: Pick<RawEvent, 'id' | 'tenantId' | 'payloadStorage' | 'payloadS3Key'>[],
  ): Promise<{
    processedHere: number;
    failedHere: number;
    affectedBlockTenantIds: Set<string>;
  }> {
    let processedHere = 0;
    let failedHere = 0;
    const affectedBlockTenantIds = new Set<string>();

    for (const event of candidates) {
      try {
        if (event.payloadStorage === 's3' && event.payloadS3Key) {
          await this.s3.delete([event.payloadS3Key]).catch((err) => {
            this.logger.warn(
              {
                rawEventId: event.id,
                key: event.payloadS3Key,
                err: err instanceof Error ? err.message : String(err),
              },
              'processExpiredRawEvents: S3 delete failed (не блокируем БД-удаление)',
            );
          });
        }
        await this.prisma.rawEvent.delete({ where: { id: event.id } });
        affectedBlockTenantIds.add(event.tenantId);
        processedHere += 1;
        this.metrics.incCoreRetentionDeleted({ kind: 'raw_event' });
      } catch (err) {
        failedHere += 1;
        this.logger.warn(
          {
            rawEventId: event.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'processExpiredRawEvents: ошибка удаления RawEvent',
        );
      }
    }

    return { processedHere, failedHere, affectedBlockTenantIds };
  }

  private async autoArchiveOrphanBlocks(tenantId: string): Promise<void> {
    const candidates = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        status: { in: ['canonical', 'draft'] },
        evidenceCount: { gt: 0 },
      },
      select: { id: true },
      take: 1000,
    });
    for (const block of candidates) {
      const actualCount = await this.prisma.ideaBlockEvidence.count({
        where: { blockId: block.id },
      });
      if (actualCount === 0) {
        await this.prisma.ideaBlock.update({
          where: { id: block.id },
          data: { status: 'archived', evidenceCount: 0 },
        });
      } else if (actualCount !== undefined) {
        await this.prisma.ideaBlock.update({
          where: { id: block.id },
          data: { evidenceCount: actualCount },
        });
      }
    }
  }

  private async processExpiredArchivedBlocks(): Promise<{ processed: number; failed: number }> {
    const policies = await this.prisma.orgRetentionPolicy.findMany();
    const batch = this.cfg.retention.sweepBatchSize;
    let processed = 0;
    let failed = 0;

    for (const policy of policies) {
      if (policy.archivedBlockAction === 'keep_forever') continue;
      const cutoff = this.daysAgo(policy.archivedBlockDays);
      try {
        const candidates = await this.prisma.ideaBlock.findMany({
          where: {
            tenantId: policy.tenantId,
            status: 'archived',
            updatedAt: { lt: cutoff },
          },
          select: {
            id: true,
            tenantId: true,
            name: true,
            updatedAt: true,
          },
          take: batch,
        });
        if (candidates.length === 0) continue;

        for (const block of candidates) {
          try {
            await this.prisma.ideaBlock.delete({ where: { id: block.id } });
            processed += 1;
            this.metrics.incCoreRetentionDeleted({ kind: 'block' });
            void this.audit.log({
              action: AUDIT.BLOCK_DELETED_BY_RETENTION,
              resourceId: block.id,
              metadata: {
                tenantId: block.tenantId,
                name: block.name,
                archivedAt: block.updatedAt.toISOString(),
              },
            });
          } catch (err) {
            failed += 1;
            this.logger.warn(
              {
                blockId: block.id,
                err: err instanceof Error ? err.message : String(err),
              },
              'processExpiredArchivedBlocks: ошибка удаления блока',
            );
          }
        }
      } catch (err) {
        failed += 1;
        this.logger.error(
          {
            tenantId: policy.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'processExpiredArchivedBlocks: ошибка по Org',
        );
      }
    }

    if (processed > 0 || failed > 0) {
      this.logger.log({ processed, failed }, 'processExpiredArchivedBlocks: завершён');
    }
    return { processed, failed };
  }

  private async processExpiredChatMessages(): Promise<{ processed: number; failed: number }> {
    const policies = await this.prisma.orgRetentionPolicy.findMany();
    let processed = 0;
    let failed = 0;

    for (const policy of policies) {
      const cutoff = this.daysAgo(policy.chatMessageDays);
      try {
        const r = await this.prisma.meetingChatMessage.deleteMany({
          where: { tenantId: policy.tenantId, createdAt: { lt: cutoff } },
        });
        processed += r.count;
        this.metrics.incCoreRetentionDeleted({ kind: 'chat', count: r.count });
      } catch (err) {
        failed += 1;
        this.logger.warn(
          {
            tenantId: policy.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'processExpiredChatMessages: ошибка по Org',
        );
      }
    }

    if (processed > 0 || failed > 0) {
      this.logger.log({ processed, failed }, 'processExpiredChatMessages: завершён');
    }
    return { processed, failed };
  }

  private async processExpiredAuditLogs(): Promise<{ processed: number; failed: number }> {
    const policies = await this.prisma.orgRetentionPolicy.findMany();
    let processed = 0;
    let failed = 0;

    for (const policy of policies) {
      const cutoff = this.daysAgo(policy.auditLogDays);
      try {
        const r = await this.prisma.auditLog.deleteMany({
          where: { tenantId: policy.tenantId, createdAt: { lt: cutoff } },
        });
        processed += r.count;
        this.metrics.incCoreRetentionDeleted({ kind: 'audit', count: r.count });
      } catch (err) {
        failed += 1;
        this.logger.warn(
          {
            tenantId: policy.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'processExpiredAuditLogs: ошибка по Org',
        );
      }
    }

    if (processed > 0 || failed > 0) {
      this.logger.log({ processed, failed }, 'processExpiredAuditLogs: завершён');
    }
    return { processed, failed };
  }

  async markAllSwept(): Promise<void> {
    try {
      await this.prisma.orgRetentionPolicy.updateMany({
        data: { lastSweepAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'markAllSwept: ошибка обновления lastSweepAt',
      );
    }
    void this.policySvc;
  }

  private daysAgo(days: number): Date {
    return new Date(Date.now() - days * 86_400_000);
  }
}
