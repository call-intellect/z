import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT } from '../audit/audit.types';
import { S3Service } from '../recordings/s3.service';

export interface EraseReport {
  erasedRawEvents: number;
  deletedEvidences: number;
  archivedBlocks: number;
  deletedEntityLinks: number;
  alreadyErased?: boolean;
}

const ERASED_NAME = '[удалено по запросу]';

interface EraseInput {
  entityId: string;
  tenantId: string;
  requestedBy: string;
  reason: string;
}

@Injectable()
export class PersonalDataDeletionService {
  private readonly logger = new Logger(PersonalDataDeletionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  async eraseEntity(input: EraseInput): Promise<EraseReport> {
    const entity = await this.prisma.entity.findUnique({
      where: { id: input.entityId },
    });
    if (!entity) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'entity_not_found', message: 'Сущность не найдена' },
      });
    }
    if (entity.tenantId !== input.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'entity_not_found', message: 'Сущность не найдена' },
      });
    }
    if (entity.type !== 'person') {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'entity_not_person',
          message: 'Удаление личных данных применимо только к Entity(type=person)',
        },
      });
    }

    if (entity.canonicalName === ERASED_NAME) {
      return {
        erasedRawEvents: 0,
        deletedEvidences: 0,
        archivedBlocks: 0,
        deletedEntityLinks: 0,
        alreadyErased: true,
      };
    }

    const blockMentions = await this.prisma.ideaBlockEntity.findMany({
      where: { entityId: entity.id },
      select: { blockId: true },
    });
    const blockIds = Array.from(new Set(blockMentions.map((m) => m.blockId)));

    const rawEventIds = blockIds.length ? await this.collectRawEventIds(blockIds) : [];

    const s3Keys = rawEventIds.length ? await this.collectS3Keys(rawEventIds) : [];

    const deletedEvidences = rawEventIds.length
      ? await this.prisma.ideaBlockEvidence.count({
          where: { rawEventId: { in: rawEventIds } },
        })
      : 0;

    const txResult = await this.prisma.$transaction(async (tx) => {
      let erasedRawEvents = 0;
      if (rawEventIds.length > 0) {
        const r = await tx.rawEvent.deleteMany({
          where: { id: { in: rawEventIds } },
        });
        erasedRawEvents = r.count;
      }

      await tx.ideaBlockEntity.deleteMany({ where: { entityId: entity.id } });

      let archivedCount = 0;
      for (const blockId of blockIds) {
        const evCount = await tx.ideaBlockEvidence.count({
          where: { blockId },
        });
        if (evCount === 0) {
          const block = await tx.ideaBlock.findUnique({
            where: { id: blockId },
            select: { status: true },
          });
          if (block && block.status !== 'archived' && block.status !== 'merged_into') {
            await tx.ideaBlock.update({
              where: { id: blockId },
              data: { status: 'archived', evidenceCount: 0 },
            });
            archivedCount += 1;
          }
        } else {
          await tx.ideaBlock.update({
            where: { id: blockId },
            data: { evidenceCount: evCount },
          });
        }
      }

      const linkRes = await tx.entityLink.deleteMany({
        where: {
          OR: [{ fromEntityId: entity.id }, { toEntityId: entity.id }],
        },
      });

      const erasedMeta: Prisma.InputJsonValue = {
        erasedAt: new Date().toISOString(),
        requestedBy: input.requestedBy,
        reason: input.reason,
      };
      await tx.entity.update({
        where: { id: entity.id },
        data: {
          canonicalName: ERASED_NAME,
          aliases: [],
          metadata: erasedMeta,
        },
      });

      return {
        erasedRawEvents,
        archivedCount,
        deletedEntityLinks: linkRes.count,
      };
    });

    void this.audit.log({
      userId: input.requestedBy,
      action: AUDIT.PERSON_DATA_ERASED,
      resourceId: entity.id,
      metadata: {
        tenantId: entity.tenantId,
        reason: input.reason,
        erasedRawEvents: txResult.erasedRawEvents,
        deletedEvidences,
        archivedBlocks: txResult.archivedCount,
        deletedEntityLinks: txResult.deletedEntityLinks,
      },
    });

    this.metrics.incCorePersonalDataErasure();

    if (s3Keys.length > 0) {
      void this.s3.delete(s3Keys).catch((err) => {
        this.logger.warn(
          {
            entityId: entity.id,
            keys: s3Keys.length,
            err: err instanceof Error ? err.message : String(err),
          },
          'eraseEntity: S3 delete failed (БД-удаление выполнено, payload остался — потребуется ручная очистка)',
        );
      });
    }

    return {
      erasedRawEvents: txResult.erasedRawEvents,
      deletedEvidences,
      archivedBlocks: txResult.archivedCount,
      deletedEntityLinks: txResult.deletedEntityLinks,
    };
  }

  private async collectRawEventIds(blockIds: string[]): Promise<string[]> {
    const evidence = await this.prisma.ideaBlockEvidence.findMany({
      where: { blockId: { in: blockIds } },
      select: { rawEventId: true },
    });
    return Array.from(new Set(evidence.map((e) => e.rawEventId)));
  }

  private async collectS3Keys(rawEventIds: string[]): Promise<string[]> {
    const events = await this.prisma.rawEvent.findMany({
      where: {
        id: { in: rawEventIds },
        payloadStorage: 's3',
        payloadS3Key: { not: null },
      },
      select: { payloadS3Key: true },
    });
    return events
      .map((e) => e.payloadS3Key)
      .filter((k): k is string => typeof k === 'string' && k.length > 0);
  }
}
